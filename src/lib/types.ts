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
  necessary_expense_30d: number;
  emergency_reserve: number;
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
  /** 最低可用余额 = 可自由使用资金 - 未来30天必要支出 - 当期需支付金额 */
  projected_min_balance: number;
  /** 最低可用余额是否低于最低应急储备 */
  high_risk_choice: boolean;
  /** 该路径的总支付金额（分期为总还款额，其余为一次性金额） */
  total_payment: number;
  /** 总息费 = 总支付 - 商品价格 */
  total_interest: number;
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
  projected_min_balance: number;
  high_risk_choice: boolean;
  viewed_cashflow: boolean;
  viewed_total_cost: boolean;
  clicked_lower_price: boolean;
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
  | 'expand_cashflow'
  | 'view_total_cost'
  | 'open_alternative'
  | 'select_option'
  | 'submit_decision'
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
}
