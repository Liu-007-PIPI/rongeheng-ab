/** 融e衡 A/B 实验 —— 共享类型定义。字段名与《融e衡项目Claude交接文档》第七章保持一致。 */

export type Variant = 'A' | 'B';
export type CodeType = 'pilot' | 'formal';
export type CodeStatus = 'unused' | 'started' | 'completed' | 'withdrawn';
export type ScenarioId = 'laptop' | 'phone' | 'course';

/** 最终选择集合。A 版与 B 版必须完全一致，顺序也一致。 */
export type FinalChoice =
  | 'full_payment'
  | 'installment'
  | 'save_then_buy'
  | 'alternative'
  | 'not_now';

/** 低价替代项内部采用的支付路径。 */
export type PaymentPath = 'full_payment' | 'installment';

/** 情境配置。所有数值来自交接文档 4.3，正式实验开始后冻结。 */
export interface ScenarioConfig {
  scenario_id: ScenarioId;
  scenario_version: string;
  title: string;
  product_name: string;
  product_model: string;
  base_price: number;
  available_funds: number;
  /** 月必要支出。30 天口径与多月模拟共用同一个数。 */
  necessary_expense_30d: number;
  /**
   * 月可支配收入。第二轮新增。
   * 没有这个字段就无法做多月现金流模拟——余额只会单调下降，所有人都会破产。
   * 第一轮没有该字段，故第一轮数据无法重算完整还款期指标。
   */
  monthly_income: number;
  emergency_reserve: number;
  /** 完整还款期指标的模拟月数。取该情境最长的分期期数。 */
  horizon_months: number;
  installment_periods: number;
  installment_payment: number;
  installment_total: number;
  alternative_name: string;
  alternative_price: number;
  /**
   * 替代项的分期参数。交接文档 4.3 未给出，此处按"与原商品相同的分期费率"确定性推导，
   * 标记 derived=true，预试后需由项目负责人确认或改为实测值，确认后随版本冻结。
   */
  alternative_installment_periods: number;
  alternative_installment_payment: number;
  alternative_installment_total: number;
  alternative_installment_derived: boolean;
  is_active: boolean;
}

/** 单个选项的确定性计算结果。 */
export interface OptionOutcome {
  choice: FinalChoice;
  payment_path: PaymentPath | null;
  /** 当期（未来 30 天内）需要支付的金额 */
  due_now: number;
  /** 付款后账户里还剩多少可自由使用资金（尚未扣除未来 30 天必要支出） */
  remaining_funds: number;
  /**
   * 30 天口径最低可用余额 = 可自由使用资金 − 未来30天必要支出 − 当期需支付金额。
   * 不计入月收入，是"这个月没有任何进账"的保守快照。第一轮的主要指标基于它。
   */
  projected_min_balance: number;
  /** 30 天口径的高风险判定。保留原义不变，第二轮仅作与第一轮对照之用。 */
  high_risk_choice: boolean;
  /**
   * 完整还款期内每个月末的可用余额序列（第 1 个月末到第 horizon_months 个月末）。
   * 计入月收入，反映"按正常收支节奏"下的真实轨迹。
   */
  balance_path: number[];
  /** 完整还款期内的最低余额 */
  worst_balance_term: number;
  /** 最低余额出现在第几个月末（从 1 开始） */
  worst_balance_month: number;
  /**
   * 完整还款期口径的高风险判定：还款期内任何一个月末跌破应急储备即为高风险。
   * 第二轮的主要风险判定基于它。与 high_risk_choice 口径不同，两者不可混用。
   */
  high_risk_term: boolean;
  /** 月净结余 = 月可支配收入 − 月必要支出 */
  monthly_net: number;
  /** 该路径的总支付金额（分期为总还款额，其余为一次性金额） */
  total_payment: number;
  /** 总息费 = 总支付 - 商品价格 */
  total_interest: number;
  /** 分期的名义年化利率（小数，0.1832 表示 18.32%）。非分期路径为 null */
  annual_rate: number | null;
  /** 后续每月固定负担，仅分期路径有值 */
  monthly_burden: number | null;
  /** 分期期数，仅分期路径有值 */
  installment_term: number | null;
  /** 先储蓄后买所需月数，仅该路径有值 */
  months_to_save: number | null;
}

export interface BaselineAnswers {
  age_group: string;
  role_status: string;
  disposable_funds_band: string;
  installment_experience: string;
  recent_large_purchase: boolean | null;
}

/** 与 decisions 表对应的一条决策记录。 */
export interface DecisionRecord {
  decision_id: string;
  session_id: string;
  participant_id: string;
  scenario_id: ScenarioId;
  scenario_position: number;
  final_choice: FinalChoice;
  selected_payment_path: PaymentPath | null;
  installment_term: number | null;
  /** 30 天口径，与第一轮同定义，仅作跨轮对照 */
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
  submitted_at: string;
}

export type EventName =
  | 'page_view'
  | 'consent_agreed'
  | 'code_verified'
  | 'baseline_submitted'
  | 'scenario_shown'
  // 第一轮的折叠交互事件。第二轮默认展开后不再产生，保留定义以便读取第一轮存档。
  | 'expand_cashflow'
  | 'view_total_cost'
  | 'open_alternative'
  | 'switch_alt_path'
  | 'select_option'
  | 'submit_decision'
  | 'attention_check_shown'
  | 'attention_check_answered'
  | 'session_completed';

export interface EventRecord {
  event_id: string;
  session_id: string;
  participant_id: string;
  scenario_id: ScenarioId | null;
  event_name: EventName;
  event_ts: string;
  /** 只存界面状态，禁止写入任何个人身份信息 */
  metadata: Record<string, string | number | boolean | null>;
}

export interface ParticipantRecord {
  participant_id: string;
  access_code_label: string;
  variant: Variant;
  code_type: CodeType;
  consent_version: string;
  consent_at: string;
  created_at: string;
  baseline: BaselineAnswers;
  /**
   * 注意力检查结果。null 表示尚未作答。
   * 预注册的处理方式：主分析排除未通过者，另做一次含全部参与者的敏感性分析，两套结果都报告。
   * 不得在看到结果之后再决定用哪一套。
   */
  attention_check_passed: boolean | null;
}

export interface SessionRecord {
  session_id: string;
  participant_id: string;
  variant: Variant;
  scenario_order: ScenarioId[];
  started_at: string;
  completed_at: string | null;
  total_duration_ms: number | null;
  completion_status: 'in_progress' | 'completed' | 'withdrawn';
  app_version: string;
  /**
   * 这台浏览器提交的第几份作答。开放模式取消一码一人后用于数据质量审计：
   * 大于 1 表示该设备此前已提交过，分析时需检查是否为同一人重复作答。
   * 定向模式恒为 1。这只是序号，不是设备指纹。
   */
  browser_submission_seq: number;
}

/**
 * 撤回处理记录（交接文档 7.7）。
 * 参与者及其答案会被物理删除，这里只保留匿名码与处理时间，不保留任何实验答案。
 */
export interface WithdrawalRecord {
  id: string;
  access_code_label: string;
  requested_at: string;
  processed_at: string;
  processed_by: string;
  /** 只写处理状态，不写参与者身份 */
  note: string;
}
