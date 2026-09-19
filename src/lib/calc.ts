/**
 * 确定性计算引擎。A 版与 B 版共用这一个模块，禁止在页面里另写一份金额计算。
 * 规则来自《融e衡项目Claude交接文档》4.4，正式实验开始前冻结。
 *
 * 最低可用余额 = 当前可自由使用资金 - 未来30天必要支出 - 当期需支付金额
 * 最低可用余额 < 最低应急储备  =>  high_risk_choice = true
 */
import type { FinalChoice, OptionOutcome, PaymentPath, ScenarioConfig } from './types';
import { round2 } from './money';

/** 选项展示顺序。A 版与 B 版必须使用同一个顺序和同一个集合。 */
export const CHOICE_ORDER: FinalChoice[] = [
  'full_payment',
  'installment',
  'save_then_buy',
  'alternative',
  'not_now',
];

export const CHOICE_LABELS: Record<FinalChoice, string> = {
  full_payment: '全款购买',
  installment: '分期购买',
  save_then_buy: '先储蓄后购买',
  alternative: '购买低价替代项',
  not_now: '暂不购买',
};

/**
 * 先储蓄后购买所需月数。
 * 交接文档未给出公式，这里采用确定性规则：
 *   每月可结余 = 可自由使用资金 - 未来30天必要支出 - 最低应急储备
 *   第 1 个月已有该结余，其后每月新增同样金额，直至覆盖商品价格。
 * 结余不为正时返回 null，界面显示"按当前结余无法在可预期时间内攒够"。
 */
export function monthsToSave(price: number, monthlySurplus: number): number | null {
  if (monthlySurplus <= 0) return null;
  return Math.max(1, Math.ceil(price / monthlySurplus));
}

/** 每月可结余，同时供储蓄路径与现金流模块使用。 */
export function monthlySurplus(s: ScenarioConfig): number {
  return round2(s.available_funds - s.necessary_expense_30d - s.emergency_reserve);
}

/** 由"当期需支付金额"得到最低可用余额。 */
export function projectedMinBalance(s: ScenarioConfig, dueNow: number): number {
  return round2(s.available_funds - s.necessary_expense_30d - dueNow);
}

export function isHighRisk(s: ScenarioConfig, projected: number): boolean {
  return projected < s.emergency_reserve;
}

/**
 * 计算某个选项的完整结果。
 * alternative 选项需指定其支付路径；其余选项的 path 参数会被忽略。
 */
export function evaluateOption(
  s: ScenarioConfig,
  choice: FinalChoice,
  path: PaymentPath = 'full_payment',
): OptionOutcome {
  const surplus = monthlySurplus(s);

  let due_now = 0;
  let payment_path: PaymentPath | null = null;
  let total_payment = 0;
  let price_of_item = s.base_price;
  let monthly_burden: number | null = null;
  let installment_term: number | null = null;
  let months_to_save: number | null = null;

  switch (choice) {
    case 'full_payment':
      payment_path = 'full_payment';
      due_now = s.base_price;
      total_payment = s.base_price;
      break;

    case 'installment':
      payment_path = 'installment';
      due_now = s.installment_payment;
      total_payment = s.installment_total;
      monthly_burden = s.installment_payment;
      installment_term = s.installment_periods;
      break;

    case 'save_then_buy':
      // 本 30 天内不发生商品支付
      due_now = 0;
      total_payment = s.base_price;
      months_to_save = monthsToSave(s.base_price, surplus);
      break;

    case 'alternative':
      price_of_item = s.alternative_price;
      payment_path = path;
      if (path === 'installment') {
        due_now = s.alternative_installment_payment;
        total_payment = s.alternative_installment_total;
        monthly_burden = s.alternative_installment_payment;
        installment_term = s.alternative_installment_periods;
      } else {
        due_now = s.alternative_price;
        total_payment = s.alternative_price;
      }
      break;

    case 'not_now':
      due_now = 0;
      total_payment = 0;
      price_of_item = 0;
      break;
  }

  const projected = projectedMinBalance(s, due_now);

  return {
    choice,
    payment_path,
    due_now: round2(due_now),
    projected_min_balance: projected,
    high_risk_choice: isHighRisk(s, projected),
    total_payment: round2(total_payment),
    total_interest: round2(total_payment - price_of_item),
    monthly_burden,
    installment_term,
    months_to_save,
  };
}

/** 一个情境下所有可提交选项的结果，供页面渲染和测试枚举使用。 */
export function evaluateAllOptions(s: ScenarioConfig): OptionOutcome[] {
  return [
    evaluateOption(s, 'full_payment'),
    evaluateOption(s, 'installment'),
    evaluateOption(s, 'save_then_buy'),
    evaluateOption(s, 'alternative', 'full_payment'),
    evaluateOption(s, 'alternative', 'installment'),
    evaluateOption(s, 'not_now'),
  ];
}
