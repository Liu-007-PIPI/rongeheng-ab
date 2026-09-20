/**
 * Supabase 数据通道。实现 storage.ts 里的 DataBackend 接口。
 *
 * 写入一律走数据库函数（见 supabase/schema.sql）：
 *   peek_access_code   只回状态，不回分组
 *   start_experiment   绑定匿名码 + 建参与者 + 建会话 + 服务端随机情境顺序
 *   submit_decision    服务端按 4.4 的公式重算余额与风险标签，并对同一情境幂等
 *   log_event          写事件
 *   admin_withdraw_code 管理员撤回
 *
 * 读取走 RLS：参与者只能 select 到自己那几行，管理员能 select 全部但没有 update 策略。
 * 前端没有任何一条直接 insert / update 业务表的代码。
 */
import type {
  BaselineAnswers,
  CodeStatus,
  DecisionRecord,
  EventName,
  EventRecord,
  ParticipantRecord,
  ScenarioId,
  SessionRecord,
  WithdrawalRecord,
} from './types';
import type {
  DataBackend,
  DecisionInput,
  Progress,
  StoredData,
  WithdrawalResult,
} from './storage';
import { ensureAnonymousSession, getSupabase } from './supabaseClient';

/* ── 数据库行 → 前端类型 ── */

interface ParticipantRow {
  participant_id: string;
  variant: 'A' | 'B';
  age_group: string | null;
  role_status: string | null;
  disposable_funds_band: string | null;
  installment_experience: string | null;
  recent_large_purchase: boolean | null;
  consent_version: string;
  consent_at: string;
  created_at: string;
  access_codes?: { code_label: string; code_type: 'pilot' | 'formal' } | null;
}

function toParticipant(row: ParticipantRow): ParticipantRecord {
  return {
    participant_id: row.participant_id,
    access_code_label: row.access_codes?.code_label ?? '',
    variant: row.variant,
    code_type: row.access_codes?.code_type ?? 'formal',
    consent_version: row.consent_version,
    consent_at: row.consent_at,
    created_at: row.created_at,
    baseline: {
      age_group: row.age_group ?? '',
      role_status: row.role_status ?? '',
      disposable_funds_band: row.disposable_funds_band ?? '',
      installment_experience: row.installment_experience ?? '',
      recent_large_purchase: row.recent_large_purchase,
    },
  };
}

const PARTICIPANT_SELECT =
  'participant_id, variant, age_group, role_status, disposable_funds_band,' +
  ' installment_experience, recent_large_purchase, consent_version, consent_at, created_at,' +
  ' access_codes ( code_label, code_type )';

export class SupabaseBackend implements DataBackend {
  readonly kind = 'supabase' as const;

  /* ── 参与者端 ── */

  async peekCode(codeLabel: string): Promise<CodeStatus> {
    const supabase = getSupabase();
    const { data, error } = await supabase.rpc('peek_access_code', { p_code: codeLabel });
    if (error) throw new Error(error.message);
    return data as CodeStatus;
  }

  async findMyProgress(): Promise<Progress | null> {
    const supabase = getSupabase();
    const { data: sessionData } = await supabase.auth.getSession();
    // 还没有匿名身份就说明这台浏览器没开始过，不要在这里凭空创建一个
    if (!sessionData.session) return null;

    const { data: participantRow, error } = await supabase
      .from('participants')
      .select(PARTICIPANT_SELECT)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!participantRow) return null;

    const participant = toParticipant(participantRow as unknown as ParticipantRow);

    const { data: session } = await supabase
      .from('experiment_sessions')
      .select('*')
      .eq('participant_id', participant.participant_id)
      .maybeSingle();
    if (!session) return null;

    const { data: decisions } = await supabase
      .from('decisions')
      .select('*')
      .eq('session_id', (session as SessionRecord).session_id)
      .order('scenario_position', { ascending: true });

    return {
      participant,
      session: session as SessionRecord,
      decisions: (decisions ?? []) as DecisionRecord[],
    };
  }

  async findProgress(codeLabel: string): Promise<Progress | null> {
    const mine = await this.findMyProgress();
    if (!mine) return null;
    // 这个码不是当前身份绑定的那个 → 当作查不到，由页面提示"正在另一台设备上作答"
    return mine.participant.access_code_label === codeLabel.trim().toUpperCase() ? mine : null;
  }

  async startSession(
    codeLabel: string,
    baseline: BaselineAnswers,
    consentVersion: string,
    appVersion: string,
  ): Promise<Progress> {
    await ensureAnonymousSession();
    const supabase = getSupabase();

    const { error } = await supabase.rpc('start_experiment', {
      p_code: codeLabel,
      p_baseline: {
        age_group: baseline.age_group,
        role_status: baseline.role_status,
        disposable_funds_band: baseline.disposable_funds_band,
        installment_experience: baseline.installment_experience,
        recent_large_purchase: baseline.recent_large_purchase,
      },
      p_consent_version: consentVersion,
      p_app_version: appVersion,
    });
    if (error) throw new Error(error.message);

    // 函数只回了几个字段，这里统一按读路径取回完整进度，保证前后端形状一致
    const progress = await this.findMyProgress();
    if (!progress) throw new Error('start_experiment 执行后仍未读到参与者记录');
    return progress;
  }

  async saveDecision(input: DecisionInput): Promise<DecisionRecord> {
    const supabase = getSupabase();
    const { error } = await supabase.rpc('submit_decision', {
      p_scenario_id: input.scenario_id,
      p_scenario_position: input.scenario_position,
      p_final_choice: input.final_choice,
      p_payment_path: input.selected_payment_path,
      p_installment_term: input.installment_term,
      p_due_now: input.due_now,
      p_viewed_cashflow: input.viewed_cashflow,
      p_viewed_total_cost: input.viewed_total_cost,
      p_clicked_lower_price: input.clicked_lower_price,
      p_changed_choice: input.changed_choice,
      p_decision_time_ms: input.decision_time_ms,
    });
    if (error) throw new Error(error.message);

    // 回读服务端那条记录：projected_min_balance 与 high_risk_choice 以服务端为准
    const { data, error: readError } = await supabase
      .from('decisions')
      .select('*')
      .eq('scenario_id', input.scenario_id)
      .order('submitted_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (readError) throw new Error(readError.message);
    if (!data) throw new Error('决策已提交但未能读回，请刷新页面确认');
    return data as DecisionRecord;
  }

  async logEvent(
    name: EventName,
    scenarioId: ScenarioId | null,
    metadata: Record<string, string | number | boolean | null>,
  ): Promise<void> {
    const supabase = getSupabase();
    // 事件日志失败不应阻断作答，主结果以 decisions 表为准
    await supabase.rpc('log_event', {
      p_scenario_id: scenarioId,
      p_event_name: name,
      p_metadata: metadata,
    });
  }

  /* ── 管理端 ── */

  async dump(): Promise<StoredData> {
    const supabase = getSupabase();

    const [codes, participants, sessions, decisions, events, withdrawals] = await Promise.all([
      supabase.from('access_codes').select('code_label, status'),
      supabase.from('participants').select(PARTICIPANT_SELECT),
      supabase.from('experiment_sessions').select('*'),
      supabase.from('decisions').select('*'),
      supabase.from('events').select('*'),
      supabase.from('withdrawal_log').select('*, access_codes ( code_label )'),
    ]);

    const firstError =
      codes.error ??
      participants.error ??
      sessions.error ??
      decisions.error ??
      events.error ??
      withdrawals.error;
    if (firstError) {
      throw new Error(
        `${firstError.message}（如果提示权限不足，请确认当前账号已写入 admin_users 表）`,
      );
    }

    const code_status: Record<string, CodeStatus> = {};
    for (const row of codes.data ?? []) {
      code_status[(row as { code_label: string }).code_label] = (row as { status: CodeStatus })
        .status;
    }

    return {
      participants: ((participants.data ?? []) as unknown as ParticipantRow[]).map(toParticipant),
      sessions: (sessions.data ?? []) as SessionRecord[],
      decisions: (decisions.data ?? []) as DecisionRecord[],
      events: (events.data ?? []) as EventRecord[],
      withdrawals: ((withdrawals.data ?? []) as unknown as (WithdrawalRecord & {
        access_codes?: { code_label: string } | null;
      })[]).map((w) => ({
        id: w.id,
        access_code_label: w.access_codes?.code_label ?? '',
        requested_at: w.requested_at,
        processed_at: w.processed_at,
        processed_by: w.processed_by ?? '',
        note: w.note ?? '',
      })),
      code_status,
    };
  }

  async withdrawByCode(
    codeLabel: string,
    _operator: string,
    note: string,
  ): Promise<WithdrawalResult> {
    const supabase = getSupabase();
    // operator 由数据库函数从 auth.uid() 取，前端传什么都不算数
    const { data, error } = await supabase.rpc('admin_withdraw_code', {
      p_code_label: codeLabel,
      p_note: note,
    });
    if (error) throw new Error(error.message);

    const deleted = (data as { participants_deleted?: number } | null)?.participants_deleted ?? 0;
    // 会话、决策、事件由外键级联删除，数据库函数只回参与者条数
    return { participants: deleted, sessions: deleted, decisions: 0, events: 0 };
  }

  async reset(): Promise<void> {
    throw new Error('连接 Supabase 时不提供一键清空。要清数据请在 SQL Editor 里手动处理。');
  }
}
