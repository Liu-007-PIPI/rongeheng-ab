/**
 * 后台指标计算。纯函数，不碰存储也不碰界面，便于单测和后续移植到分析脚本。
 *
 * 口径来自《融e衡项目Claude交接文档》：
 *   10.1 分析总体与排除规则
 *   10.3 主要指标（参与者层面的高风险比例）
 *   10.4 次要指标
 *   8    管理员后台要展示的字段
 *
 * 两条硬规则：
 * 1. 主要指标在**参与者层面**计算。40 人 × 3 情境是 120 条决策，但只有 40 个独立单位，
 *    绝不能把 120 条当成 120 个人。
 * 2. 分母为 0 时返回 null，不返回 0。未完成会话、撤回记录、缺失值都必须能与"真的是 0"
 *    区分开（交接文档 9.3）。
 *
 * 本模块只做描述统计。置换检验、Mann-Whitney U、bootstrap 置信区间属于采集结束后
 * 一次性运行的分析脚本（交接文档 10.3），不放进采集期间可随时刷新的后台，
 * 以免边采边看、提前停止或挑口径。
 */
import type {
  CodeType,
  DecisionRecord,
  ParticipantRecord,
  SessionRecord,
  Variant,
  WithdrawalRecord,
} from './types';

export interface DataSnapshot {
  participants: ParticipantRecord[];
  sessions: SessionRecord[];
  decisions: DecisionRecord[];
  withdrawals: WithdrawalRecord[];
}

/** 一个情境数固定为 3，主要指标的分母。 */
export const SCENARIOS_PER_PARTICIPANT = 3;

/* ────────────────── 基础统计 ────────────────── */

/** 分位数，线性插值（与 numpy / R type 7 一致，便于和分析脚本对齐）。 */
export function quantile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (pos - lo) * (sorted[hi] - sorted[lo]);
}

export function median(values: number[]): number | null {
  return quantile(values, 0.5);
}

export function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** 比率。分母为 0 时返回 null，避免把"没有样本"显示成 0%。 */
export function rate(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;
  return numerator / denominator;
}

/* ────────────────── 分析集 ────────────────── */

export interface AnalysisFilter {
  /** 默认只看正式样本；预试数据不进入主要效果估计（交接文档 10.1） */
  codeType: CodeType | 'all';
  /** 只保留完整做完三个情境的会话 */
  completedOnly: boolean;
}

export const DEFAULT_FILTER: AnalysisFilter = { codeType: 'formal', completedOnly: true };

/** 一名参与者在分析中的完整视图。 */
export interface ParticipantView {
  participant: ParticipantRecord;
  session: SessionRecord | null;
  decisions: DecisionRecord[];
  withdrawn: boolean;
  completed: boolean;
}

export function buildViews(snapshot: DataSnapshot): ParticipantView[] {
  const withdrawnCodes = new Set(snapshot.withdrawals.map((w) => w.access_code_label));
  return snapshot.participants.map((participant) => {
    const session =
      snapshot.sessions.find((s) => s.participant_id === participant.participant_id) ?? null;
    const decisions = snapshot.decisions.filter(
      (d) => d.participant_id === participant.participant_id,
    );
    return {
      participant,
      session,
      decisions,
      withdrawn: withdrawnCodes.has(participant.access_code_label),
      completed:
        session?.completion_status === 'completed' &&
        decisions.length === SCENARIOS_PER_PARTICIPANT,
    };
  });
}

/**
 * 应用分析总体规则。撤回记录一律排除，与筛选条件无关。
 * 注意：不能因为某人的选择"不符合预期"而排除（交接文档 10.1）。
 */
export function applyFilter(views: ParticipantView[], filter: AnalysisFilter): ParticipantView[] {
  return views.filter((v) => {
    if (v.withdrawn) return false;
    if (filter.codeType !== 'all' && v.participant.code_type !== filter.codeType) return false;
    if (filter.completedOnly && !v.completed) return false;
    return true;
  });
}

/* ────────────────── 总览 ────────────────── */

export interface Overview {
  issued_codes: number;
  started: number;
  completed: number;
  in_progress: number;
  withdrawn: number;
  completed_a: number;
  completed_b: number;
  pilot_started: number;
  pilot_completed: number;
  formal_started: number;
  formal_completed: number;
}

export function computeOverview(snapshot: DataSnapshot, issuedCodes: number): Overview {
  const views = buildViews(snapshot);
  const active = views.filter((v) => !v.withdrawn);
  const completed = active.filter((v) => v.completed);
  const byType = (t: CodeType, list: ParticipantView[]) =>
    list.filter((v) => v.participant.code_type === t).length;

  return {
    issued_codes: issuedCodes,
    started: active.length,
    completed: completed.length,
    in_progress: active.length - completed.length,
    withdrawn: views.filter((v) => v.withdrawn).length,
    completed_a: completed.filter((v) => v.participant.variant === 'A').length,
    completed_b: completed.filter((v) => v.participant.variant === 'B').length,
    pilot_started: byType('pilot', active),
    pilot_completed: byType('pilot', completed),
    formal_started: byType('formal', active),
    formal_completed: byType('formal', completed),
  };
}

/* ────────────────── 分组指标 ────────────────── */

export interface CohortMetrics {
  variant: Variant;
  /** 进入分析集的参与者数。所有参与者层面指标的分母 */
  n_participants: number;
  /** 这些参与者贡献的决策条数。所有决策层面指标的分母 */
  n_decisions: number;

  /* 主要指标：参与者层面的高风险比例 = 该人高风险情境数 / 3 */
  mean_high_risk_ratio: number | null;
  median_high_risk_ratio: number | null;
  q1_high_risk_ratio: number | null;
  q3_high_risk_ratio: number | null;
  /** 平均高风险情境数，0 到 3 */
  mean_high_risk_count: number | null;
  /** 至少出现一次高风险选择的人数与比例 */
  any_high_risk_n: number;
  any_high_risk_ratio: number | null;

  /* 次要指标，决策层面 */
  installment_rate: number | null;
  defer_rate: number | null;
  alternative_choice_rate: number | null;
  alternative_click_rate: number | null;
  changed_choice_rate: number | null;
  median_decision_time_ms: number | null;

  /* B 版信息模块使用率。A 版这两项恒为 null，不参与比较 */
  viewed_cashflow_rate: number | null;
  viewed_total_cost_rate: number | null;
}

/** 单个参与者的高风险比例，主要指标的计算单位。 */
export function highRiskRatio(view: ParticipantView): number | null {
  if (view.decisions.length === 0) return null;
  const risky = view.decisions.filter((d) => d.high_risk_choice).length;
  return risky / view.decisions.length;
}

export function computeCohort(views: ParticipantView[], variant: Variant): CohortMetrics {
  const cohort = views.filter((v) => v.participant.variant === variant);
  const decisions = cohort.flatMap((v) => v.decisions);

  const ratios = cohort
    .map(highRiskRatio)
    .filter((r): r is number => r !== null);

  const counts = cohort.map((v) => v.decisions.filter((d) => d.high_risk_choice).length);
  const anyHighRisk = cohort.filter((v) => v.decisions.some((d) => d.high_risk_choice)).length;

  const n = cohort.length;
  const m = decisions.length;
  const isB = variant === 'B';

  return {
    variant,
    n_participants: n,
    n_decisions: m,

    mean_high_risk_ratio: mean(ratios),
    median_high_risk_ratio: median(ratios),
    q1_high_risk_ratio: quantile(ratios, 0.25),
    q3_high_risk_ratio: quantile(ratios, 0.75),
    mean_high_risk_count: mean(counts),
    any_high_risk_n: anyHighRisk,
    any_high_risk_ratio: rate(anyHighRisk, n),

    installment_rate: rate(
      decisions.filter((d) => d.final_choice === 'installment').length,
      m,
    ),
    // 暂缓购买 = 先储蓄后购买 或 暂不购买（交接文档 10.4 把这两类合并报告）
    defer_rate: rate(
      decisions.filter((d) => d.final_choice === 'save_then_buy' || d.final_choice === 'not_now')
        .length,
      m,
    ),
    alternative_choice_rate: rate(
      decisions.filter((d) => d.final_choice === 'alternative').length,
      m,
    ),
    alternative_click_rate: rate(decisions.filter((d) => d.clicked_lower_price).length, m),
    changed_choice_rate: rate(decisions.filter((d) => d.changed_choice).length, m),
    median_decision_time_ms: median(decisions.map((d) => d.decision_time_ms)),

    viewed_cashflow_rate: isB ? rate(decisions.filter((d) => d.viewed_cashflow).length, m) : null,
    viewed_total_cost_rate: isB
      ? rate(decisions.filter((d) => d.viewed_total_cost).length, m)
      : null,
  };
}

export interface AbGroups {
  a: CohortMetrics;
  b: CohortMetrics;
  /**
   * 绝对差 = B 组平均高风险比例 − A 组平均高风险比例。
   * 负值代表 B 版观察到更少的高风险选择。
   * 这只是点估计，不确定性区间由采集结束后的分析脚本给出。
   */
  absolute_difference: number | null;
}

export function computeAb(views: ParticipantView[]): AbGroups {
  const a = computeCohort(views, 'A');
  const b = computeCohort(views, 'B');
  const diff =
    a.mean_high_risk_ratio === null || b.mean_high_risk_ratio === null
      ? null
      : b.mean_high_risk_ratio - a.mean_high_risk_ratio;
  return { a, b, absolute_difference: diff };
}

/* ────────────────── 分情境 ────────────────── */

export interface ScenarioBreakdown {
  scenario_id: string;
  n_decisions: number;
  high_risk_rate: number | null;
  median_decision_time_ms: number | null;
}

export function computeByScenario(views: ParticipantView[]): ScenarioBreakdown[] {
  const decisions = views.flatMap((v) => v.decisions);
  const ids = [...new Set(decisions.map((d) => d.scenario_id))].sort();
  return ids.map((scenario_id) => {
    const rows = decisions.filter((d) => d.scenario_id === scenario_id);
    return {
      scenario_id,
      n_decisions: rows.length,
      high_risk_rate: rate(rows.filter((d) => d.high_risk_choice).length, rows.length),
      median_decision_time_ms: median(rows.map((d) => d.decision_time_ms)),
    };
  });
}
