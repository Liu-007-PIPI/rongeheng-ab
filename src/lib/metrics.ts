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
import { CURRENT_ROUND, roundOfAppVersion } from '../config/experiment';
import type { RoundKey } from '../config/experiment';
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
  /**
   * 采集轮次。默认只看当前轮。
   * 两轮的情境参数不同，混在一起算出来的比例没有任何意义，
   * 所以这一项不是"方便看看"，而是防止误读的默认防线。
   */
  round: RoundKey | 'all';
}

export const DEFAULT_FILTER: AnalysisFilter = {
  codeType: 'formal',
  completedOnly: true,
  round: CURRENT_ROUND,
};

/** 一名参与者在分析中的完整视图。 */
export interface ParticipantView {
  participant: ParticipantRecord;
  session: SessionRecord | null;
  decisions: DecisionRecord[];
  withdrawn: boolean;
  completed: boolean;
  /** 该会话属于哪一轮。没有会话记录时归入 other。 */
  round: RoundKey;
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
      round: roundOfAppVersion(session?.app_version),
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
    if (filter.round !== 'all' && v.round !== filter.round) return false;
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
  /** 被轮次条件挡在总览之外的人数，单独显示，避免"库里的人凭空消失" */
  other_rounds: number;
}

/**
 * 总览。round 默认只统计当前轮——
 * 招募期间最常看的就是这一屏，把上一轮的人数混进来会直接把进度看错。
 */
export function computeOverview(
  snapshot: DataSnapshot,
  issuedCodes: number,
  round: RoundKey | 'all' = CURRENT_ROUND,
): Overview {
  const all = buildViews(snapshot);
  const views = round === 'all' ? all : all.filter((v) => v.round === round);
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
    other_rounds: all.length - views.length,
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

  /* 第二轮：完整还款期口径的同一组指标。两套口径并列报告，不可互相替代 */
  mean_high_risk_term_ratio: number | null;
  any_high_risk_term_n: number;
  any_high_risk_term_ratio: number | null;

  /* 次要指标，决策层面 */
  installment_rate: number | null;
  defer_rate: number | null;
  alternative_choice_rate: number | null;
  changed_choice_rate: number | null;
  median_decision_time_ms: number | null;

  /**
   * 第二轮主要指标：本版本核心信息区块的有效曝光率。
   * 两版都统计——A 版观测事实区、B 版观测分析区，内容不同但结构对等。
   * 第一轮的 viewed_cashflow_rate / viewed_total_cost_rate 依赖折叠点击，
   * 默认展开之后已无意义，故移除。
   */
  key_info_exposure_rate: number | null;
  median_key_info_exposed_ms: number | null;

  /** 注意力检查通过率。主分析排除未通过者，此处只作数据质量描述 */
  attention_pass_n: number;
  attention_pass_rate: number | null;
}

/** 单个参与者的高风险比例（30 天口径），与第一轮同定义。 */
export function highRiskRatio(view: ParticipantView): number | null {
  if (view.decisions.length === 0) return null;
  const risky = view.decisions.filter((d) => d.high_risk_choice).length;
  return risky / view.decisions.length;
}

/** 单个参与者的高风险比例（完整还款期口径），第二轮的效果指标计算单位。 */
export function highRiskTermRatio(view: ParticipantView): number | null {
  if (view.decisions.length === 0) return null;
  const risky = view.decisions.filter((d) => d.high_risk_term).length;
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

  const termRatios = cohort
    .map(highRiskTermRatio)
    .filter((r): r is number => r !== null);
  const anyHighRiskTerm = cohort.filter((v) => v.decisions.some((d) => d.high_risk_term)).length;
  const attentionPassed = cohort.filter((v) => v.participant.attention_check_passed === true).length;

  const n = cohort.length;
  const m = decisions.length;

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

    mean_high_risk_term_ratio: mean(termRatios),
    any_high_risk_term_n: anyHighRiskTerm,
    any_high_risk_term_ratio: rate(anyHighRiskTerm, n),

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
    changed_choice_rate: rate(decisions.filter((d) => d.changed_choice).length, m),
    median_decision_time_ms: median(decisions.map((d) => d.decision_time_ms)),

    key_info_exposure_rate: rate(decisions.filter((d) => d.key_info_exposed).length, m),
    median_key_info_exposed_ms: median(decisions.map((d) => d.key_info_exposed_ms)),

    attention_pass_n: attentionPassed,
    attention_pass_rate: rate(attentionPassed, n),
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
