/**
 * 数据层。
 *
 * 页面只依赖 DataBackend 这个接口，不直接碰存储实现。有两个实现：
 *
 *   LocalBackend     写浏览器 localStorage。开发、跑测试、离线走查用。
 *                    数据留在各自设备上，**不能用于正式采集**。
 *   SupabaseBackend  写集中数据库，见 supabaseBackend.ts。
 *
 * 接口按"服务端能安全实现"的形状设计：
 * - peekCode 只回状态，不回分组。分组由服务端分配，前端拿不到也改不了。
 * - startSession 把"绑定匿名码 + 建参与者 + 建会话 + 随机情境顺序"合成一次原子操作，
 *   对应数据库里的 start_experiment 函数。
 * - saveDecision 对 session_id + scenario_id 幂等，断网重试不会写出第二条。
 */
import type {
  BaselineAnswers,
  CodeStatus,
  DecisionRecord,
  EventName,
  EventRecord,
  FinalChoice,
  ParticipantRecord,
  PaymentPath,
  ScenarioId,
  SessionRecord,
  Variant,
  WithdrawalRecord,
} from './types';
import { ACCESS_CODES, lookupCode } from '../config/accessCodes';
import { REQUIRE_ACCESS_CODE } from '../config/experiment';
import { isSupabaseConfigured } from './supabaseClient';
import { SupabaseBackend } from './supabaseBackend';
import { ALL_SCENARIO_IDS } from '../config/scenarios';
import { shuffle, uuid } from './random';

export interface StoredData {
  participants: ParticipantRecord[];
  sessions: SessionRecord[];
  decisions: DecisionRecord[];
  events: EventRecord[];
  withdrawals: WithdrawalRecord[];
  code_status: Record<string, CodeStatus>;
}

/** 一名参与者当前的完整进度。 */
export interface Progress {
  participant: ParticipantRecord;
  session: SessionRecord;
  decisions: DecisionRecord[];
}

/** 提交一个情境决策时前端给出的原始输入。 */
export interface DecisionInput {
  scenario_id: ScenarioId;
  scenario_position: number;
  final_choice: FinalChoice;
  selected_payment_path: PaymentPath | null;
  installment_term: number | null;
  /** 当期需支付金额。服务端用它重算余额与风险标签，不直接信任前端算好的结果 */
  due_now: number;
  /** 30 天口径，与第一轮同定义，仅作对照 */
  projected_min_balance: number;
  high_risk_choice: boolean;
  /** 完整还款期口径，第二轮主要风险判定 */
  worst_balance_term: number;
  high_risk_term: boolean;
  /** 本版本核心信息区块是否获得有效曝光（视口内累计停留 ≥ 2 秒） */
  key_info_exposed: boolean;
  key_info_exposed_ms: number;
  changed_choice: boolean;
  decision_time_ms: number;
}

/** 撤回删除的执行结果，用于在后台回显"到底删掉了什么"。 */
export interface WithdrawalResult {
  participants: number;
  sessions: number;
  decisions: number;
  events: number;
}

export interface DataBackend {
  readonly kind: 'local' | 'supabase';

  /** 匿名码状态。只回状态，不回分组，也不回是预试还是正式。 */
  peekCode(codeLabel: string): Promise<CodeStatus>;

  /** 当前这台浏览器（或当前登录身份）正在进行的作答。用于刷新后恢复。 */
  findMyProgress(): Promise<Progress | null>;

  /** 指定匿名码的进度；若这个码不属于当前身份则返回 null。 */
  findProgress(codeLabel: string): Promise<Progress | null>;

  /** 绑定匿名码、建参与者与会话、随机情境顺序。分组由这一步的返回值给出。 */
  startSession(
    codeLabel: string,
    baseline: BaselineAnswers,
    consentVersion: string,
    appVersion: string,
  ): Promise<Progress>;

  /**
   * 开放模式：不需要预先发放的匿名码，直接开始。
   * 分组由服务端按两组当前人数自动平衡分配，撤回码自动生成后随参与者记录返回。
   */
  startOpenSession(
    baseline: BaselineAnswers,
    consentVersion: string,
    appVersion: string,
  ): Promise<Progress>;

  /**
   * 为"在同一台设备上再作答一次"准备一个干净的身份。
   * 本地实现只是忘掉当前作答；Supabase 实现会换一个新的匿名登录身份，
   * 否则 participants 表上的 auth_user_id 唯一约束会挡住第二份作答。
   */
  beginNewSubmission(): Promise<void>;

  /** 对 session_id + scenario_id 幂等。三个情境齐了会自动把会话标记为完成。 */
  saveDecision(input: DecisionInput): Promise<DecisionRecord>;

  /** 记录注意力检查结果。通过与否都照常继续，排除发生在分析阶段。 */
  saveAttentionCheck(passed: boolean): Promise<void>;

  logEvent(
    name: EventName,
    scenarioId: ScenarioId | null,
    metadata: Record<string, string | number | boolean | null>,
  ): Promise<void>;

  /* ── 管理端 ── */

  /** 读取全部数据，用于后台指标与 CSV 导出。 */
  dump(): Promise<StoredData>;

  /**
   * 按匿名码撤回：物理删除该参与者及其会话、决策、事件，把匿名码标记为 withdrawn，
   * 并在 withdrawal_log 里留下一条只含匿名码与处理时间的记录。
   * 管理员不能改答案，只能整体删除。
   */
  withdrawByCode(codeLabel: string, operator: string, note: string): Promise<WithdrawalResult>;

  reset(): Promise<void>;
}

/* ══════════════════ 本地实现 ══════════════════ */

const STORAGE_KEY = 'rongeheng_ab_data_v1';
const CURRENT_CODE_KEY = 'rongeheng_ab_current_code_v1';

const EMPTY: StoredData = {
  participants: [],
  sessions: [],
  decisions: [],
  events: [],
  withdrawals: [],
  code_status: {},
};

function read(): StoredData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(EMPTY);
    return { ...structuredClone(EMPTY), ...(JSON.parse(raw) as Partial<StoredData>) };
  } catch {
    return structuredClone(EMPTY);
  }
}

function write(data: StoredData): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

/** 已登记的匿名码，用于判断一个没人用过的码是否合法。 */
const ACCESS_CODE_LABELS = new Set(ACCESS_CODES.map((c) => c.code_label));

/** 撤回日志只留匿名码与处理时间，不保留任何实验答案（交接文档 7.7）。 */
function buildLog(label: string, operator: string, note: string): WithdrawalRecord {
  const now = new Date().toISOString();
  return {
    id: uuid(),
    access_code_label: label,
    requested_at: now,
    processed_at: now,
    processed_by: operator,
    note,
  };
}

export function rememberCurrentCode(codeLabel: string): void {
  try {
    localStorage.setItem(CURRENT_CODE_KEY, codeLabel);
  } catch {
    /* 隐私模式下写入失败时，仅影响刷新恢复，不影响本次作答 */
  }
}

export function recallCurrentCode(): string | null {
  try {
    return localStorage.getItem(CURRENT_CODE_KEY);
  } catch {
    return null;
  }
}

export function forgetCurrentCode(): void {
  try {
    localStorage.removeItem(CURRENT_CODE_KEY);
  } catch {
    /* 同上 */
  }
}

/* ── 开放模式辅助 ── */

const BROWSER_SEQ_KEY = 'rongeheng_ab_browser_seq_v1';

/**
 * 这台浏览器提交的第几份作答。
 *
 * 开放模式取消了"一码一人"，同一台设备可以连续作答多次。这既是刻意放开的
 * （课堂上传递同一台手机时必须如此），也带来了同一个人重复作答的风险。
 * 记一个本地计数，让分析阶段至少能看见"有多少份来自重复作答的设备"。
 *
 * 这只是一个序号，不是设备指纹，也不跨站点、不跨浏览器，
 * 清掉站点数据即归零。不记录 IP、设备型号或任何可识别个人的信息。
 */
export function bumpBrowserSubmissionSeq(): number {
  try {
    const next = Number(localStorage.getItem(BROWSER_SEQ_KEY) ?? '0') + 1;
    localStorage.setItem(BROWSER_SEQ_KEY, String(next));
    return next;
  } catch {
    return 1;
  }
}

/**
 * 按两组当前人数做平衡分配（biased-coin）：少的那组优先，相等时随机。
 *
 * 定向模式下 A/B 平衡由码表保证（各 80 个）；开放模式没有码表，
 * 纯随机在小样本下容易漂到 60/40，故改为每次都往人少的一组补。
 */
function assignBalancedVariant(participants: ParticipantRecord[]): Variant {
  let a = 0;
  let b = 0;
  for (const p of participants) {
    if (p.variant === 'A') a += 1;
    else b += 1;
  }
  if (a < b) return 'A';
  if (b < a) return 'B';
  return Math.random() < 0.5 ? 'A' : 'B';
}

/** 撤回码字符集：去掉 0/O/1/I/L 这些抄写时容易混淆的字符。 */
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

/** 开放模式下自动生成的撤回码，形如 R-7K2M9Q。与已有码不重复。 */
function generateWithdrawalCode(data: StoredData): string {
  const used = new Set([
    ...data.participants.map((p) => p.access_code_label),
    ...ACCESS_CODE_LABELS,
  ]);
  for (let attempt = 0; attempt < 200; attempt += 1) {
    let body = '';
    for (let i = 0; i < 6; i += 1) {
      body += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    }
    const label = `R-${body}`;
    if (!used.has(label)) return label;
  }
  // 极低概率走到这里；退回带时间戳的写法，保证唯一
  return `R-${Date.now().toString(36).toUpperCase()}`;
}

class LocalBackend implements DataBackend {
  readonly kind = 'local' as const;

  async peekCode(codeLabel: string): Promise<CodeStatus> {
    const row = lookupCode(codeLabel);
    if (!row) throw new Error('invalid_code');
    return read().code_status[row.code_label] ?? 'unused';
  }

  async findMyProgress(): Promise<Progress | null> {
    const code = recallCurrentCode();
    return code ? this.findProgress(code) : null;
  }

  async findProgress(codeLabel: string): Promise<Progress | null> {
    const label = codeLabel.trim().toUpperCase();
    const data = read();
    const participant = data.participants.find((p) => p.access_code_label === label);
    if (!participant) return null;
    const session = data.sessions.find((s) => s.participant_id === participant.participant_id);
    if (!session) return null;
    const decisions = data.decisions.filter((d) => d.session_id === session.session_id);
    return { participant, session, decisions };
  }

  async startSession(
    codeLabel: string,
    baseline: BaselineAnswers,
    consentVersion: string,
    appVersion: string,
  ): Promise<Progress> {
    const row = lookupCode(codeLabel);
    if (!row) throw new Error('invalid_code');

    const existing = await this.findProgress(row.code_label);
    if (existing) return existing;

    const data = read();
    const now = new Date().toISOString();

    const participant: ParticipantRecord = {
      participant_id: uuid(),
      access_code_label: row.code_label,
      // 分组来自匿名码登记表，页面不解析编号字符串
      variant: row.assigned_variant,
      code_type: row.code_type,
      consent_version: consentVersion,
      consent_at: now,
      created_at: now,
      baseline,
      attention_check_passed: null,
    };

    const session: SessionRecord = {
      session_id: uuid(),
      participant_id: participant.participant_id,
      variant: participant.variant,
      scenario_order: shuffle(ALL_SCENARIO_IDS),
      started_at: now,
      completed_at: null,
      total_duration_ms: null,
      completion_status: 'in_progress',
      app_version: appVersion,
      browser_submission_seq: 1,
    };

    data.participants.push(participant);
    data.sessions.push(session);
    data.code_status[row.code_label] = 'started';
    write(data);
    rememberCurrentCode(row.code_label);

    return { participant, session, decisions: [] };
  }

  async startOpenSession(
    baseline: BaselineAnswers,
    consentVersion: string,
    appVersion: string,
  ): Promise<Progress> {
    const data = read();
    const now = new Date().toISOString();

    const participant: ParticipantRecord = {
      participant_id: uuid(),
      access_code_label: generateWithdrawalCode(data),
      variant: assignBalancedVariant(data.participants),
      code_type: 'formal',
      consent_version: consentVersion,
      consent_at: now,
      created_at: now,
      baseline,
      attention_check_passed: null,
    };

    const session: SessionRecord = {
      session_id: uuid(),
      participant_id: participant.participant_id,
      variant: participant.variant,
      scenario_order: shuffle(ALL_SCENARIO_IDS),
      started_at: now,
      completed_at: null,
      total_duration_ms: null,
      completion_status: 'in_progress',
      app_version: appVersion,
      browser_submission_seq: bumpBrowserSubmissionSeq(),
    };

    data.participants.push(participant);
    data.sessions.push(session);
    data.code_status[participant.access_code_label] = 'started';
    write(data);
    rememberCurrentCode(participant.access_code_label);

    return { participant, session, decisions: [] };
  }

  async beginNewSubmission(): Promise<void> {
    forgetCurrentCode();
  }

  async saveAttentionCheck(passed: boolean): Promise<void> {
    const progress = await this.findMyProgress();
    if (!progress) throw new Error('no_session');
    const data = read();
    const p = data.participants.find(
      (x) => x.participant_id === progress.participant.participant_id,
    );
    if (!p) throw new Error('no_participant');
    // 只写一次，防止刷新后覆盖首答
    if (p.attention_check_passed === null || p.attention_check_passed === undefined) {
      p.attention_check_passed = passed;
      write(data);
    }
  }

  async saveDecision(input: DecisionInput): Promise<DecisionRecord> {
    const progress = await this.findMyProgress();
    if (!progress) throw new Error('no_session');

    const data = read();
    const existing = data.decisions.find(
      (d) => d.session_id === progress.session.session_id && d.scenario_id === input.scenario_id,
    );
    // 唯一约束：每个情境只能最终提交一次，重复提交返回原记录
    if (existing) return existing;

    const record: DecisionRecord = {
      decision_id: uuid(),
      session_id: progress.session.session_id,
      participant_id: progress.participant.participant_id,
      scenario_id: input.scenario_id,
      scenario_position: input.scenario_position,
      final_choice: input.final_choice,
      selected_payment_path: input.selected_payment_path,
      installment_term: input.installment_term,
      projected_min_balance: input.projected_min_balance,
      high_risk_choice: input.high_risk_choice,
      worst_balance_term: input.worst_balance_term,
      high_risk_term: input.high_risk_term,
      key_info_exposed: input.key_info_exposed,
      key_info_exposed_ms: input.key_info_exposed_ms,
      changed_choice: input.changed_choice,
      decision_time_ms: input.decision_time_ms,
      submitted_at: new Date().toISOString(),
    };
    data.decisions.push(record);

    // 三个情境齐了就收尾
    const done = data.decisions.filter((d) => d.session_id === progress.session.session_id).length;
    if (done >= ALL_SCENARIO_IDS.length) {
      const session = data.sessions.find((s) => s.session_id === progress.session.session_id);
      if (session) {
        session.completed_at = new Date().toISOString();
        session.total_duration_ms = Date.now() - new Date(session.started_at).getTime();
        session.completion_status = 'completed';
      }
      data.code_status[progress.participant.access_code_label] = 'completed';
    }

    write(data);
    /*
     * 定向模式下作答完成即忘掉这个码，共用设备时下一位可以直接输入自己的码。
     * 开放模式相反：撤回码只在完成页出现这一次，忘掉就等于参与者再也无法要求删除自己的数据。
     * 因此这里保留，改由「换一个人，再填一份」显式清除。
     */
    if (done >= ALL_SCENARIO_IDS.length && REQUIRE_ACCESS_CODE) forgetCurrentCode();
    return record;
  }

  async logEvent(
    name: EventName,
    scenarioId: ScenarioId | null,
    metadata: Record<string, string | number | boolean | null>,
  ): Promise<void> {
    const progress = await this.findMyProgress();
    if (!progress) return;
    const data = read();
    data.events.push({
      event_id: uuid(),
      session_id: progress.session.session_id,
      participant_id: progress.participant.participant_id,
      scenario_id: scenarioId,
      event_name: name,
      event_ts: new Date().toISOString(),
      metadata,
    });
    write(data);
  }

  async dump(): Promise<StoredData> {
    return read();
  }

  async withdrawByCode(
    codeLabel: string,
    operator: string,
    note: string,
  ): Promise<WithdrawalResult> {
    const data = read();
    const label = codeLabel.trim().toUpperCase();
    const participant = data.participants.find((p) => p.access_code_label === label);

    if (!participant) {
      if (data.code_status[label] === undefined && !ACCESS_CODE_LABELS.has(label)) {
        throw new Error('匿名码不存在');
      }
      data.code_status[label] = 'withdrawn';
      data.withdrawals.push(buildLog(label, operator, note || '该匿名码尚无作答记录，仅标记为撤回'));
      write(data);
      return { participants: 0, sessions: 0, decisions: 0, events: 0 };
    }

    const pid = participant.participant_id;
    const sessionIds = data.sessions
      .filter((s) => s.participant_id === pid)
      .map((s) => s.session_id);

    const before = {
      sessions: data.sessions.length,
      decisions: data.decisions.length,
      events: data.events.length,
    };

    data.participants = data.participants.filter((p) => p.participant_id !== pid);
    data.sessions = data.sessions.filter((s) => s.participant_id !== pid);
    data.decisions = data.decisions.filter(
      (d) => d.participant_id !== pid && !sessionIds.includes(d.session_id),
    );
    data.events = data.events.filter(
      (e) => e.participant_id !== pid && !sessionIds.includes(e.session_id),
    );

    data.code_status[label] = 'withdrawn';
    data.withdrawals.push(buildLog(label, operator, note || '按参与者请求删除全部关联记录'));
    write(data);

    return {
      participants: 1,
      sessions: before.sessions - data.sessions.length,
      decisions: before.decisions - data.decisions.length,
      events: before.events - data.events.length,
    };
  }

  async reset(): Promise<void> {
    localStorage.removeItem(STORAGE_KEY);
    forgetCurrentCode();
  }
}

/* ══════════════════ 选择实现 ══════════════════ */

let cached: DataBackend | null = null;

/**
 * 选后端。规则很直白，避免"以为连上了其实没连上"：
 *   VITE_DATA_BACKEND=local  → 一律本地（测试固定走这条）
 *   URL 与 KEY 都配齐        → Supabase
 *   否则                      → 本地
 */
export function createBackend(): DataBackend {
  if (cached) return cached;

  if (import.meta.env.VITE_DATA_BACKEND !== 'local' && isSupabaseConfigured()) {
    cached = new SupabaseBackend();
  } else if (import.meta.env.VITE_DATA_BACKEND === 'supabase') {
    throw new Error(
      'VITE_DATA_BACKEND=supabase 但未配置 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY',
    );
  } else {
    cached = new LocalBackend();
  }
  return cached;
}

/** 当前实际在用的是哪个后端，界面上要如实显示。 */
export function backendKind(): 'local' | 'supabase' {
  return createBackend().kind;
}

/** 仅测试用：切换环境变量后需要重新选一次后端。 */
export function resetBackendCache(): void {
  cached = null;
}
