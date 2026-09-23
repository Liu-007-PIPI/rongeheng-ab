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

/**
 * 选项文字。第二轮改用口语说法："先储蓄后购买""低价替代项"这类词
 * 在预试里被参与者问到过，而看不懂选项本身会变成一种与分组无关的噪声。
 * 五个选项的含义、顺序和落库的枚举值都没有变，只换了说法。
 */
export const CHOICE_LABELS: Record<FinalChoice, string> = {
  full_payment: '一次付清',
  installment: '分期付',
  save_then_buy: '先攒钱，攒够了再买',
  alternative: '买便宜一点的',
  not_now: '不买了',
};

/**
 * 先储蓄后购买所需月数。
 *
 * 第二轮修正：第一轮用的是"可自由使用资金 − 月必要支出 − 应急储备"，
 * 那是一个存量，被当成月流量使用，口径不自洽。有了月收入之后，攒钱速度
 * 就是月净结余，且必须攒到"买完之后仍不低于应急储备"才算攒够——
 * 否则这条路径自己会被判成高风险，而它按定义不该如此。
 *
 *   需要补足的缺口 = 应急储备 + 商品价格 − 期初可自由使用资金
 *   所需月数 = ⌈缺口 ÷ 月净结余⌉
 *
 * 月净结余不为正时返回 null，界面显示"按当前结余无法在可预期时间内攒够"。
 */
export function monthsToSave(s: ScenarioConfig): number | null {
  const net = monthlyNet(s);
  if (net <= 0) return null;
  const gap = s.emergency_reserve + s.base_price - s.available_funds;
  if (gap <= 0) return 1;
  return Math.max(1, Math.ceil(gap / net));
}

/** 每月可结余，同时供储蓄路径与现金流模块使用。 */
export function monthlySurplus(s: ScenarioConfig): number {
  return round2(s.available_funds - s.necessary_expense_30d - s.emergency_reserve);
}

/**
 * 月净结余 = 月可支配收入 − 月必要支出。
 * 这是多月现金流模拟里唯一的流量来源；没有它，余额只会单调下降。
 */
export function monthlyNet(s: ScenarioConfig): number {
  return round2(s.monthly_income - s.necessary_expense_30d);
}

/**
 * 截至第 k 个月末的累计支付额（k 从 1 到 horizon）。
 * 约定：全款与低价替代的一次性支付发生在第 1 个月；分期从第 1 个月起每月一期；
 * 先储蓄后购买在攒够的那个月一次付清；暂不购买全程为 0。
 */
function cumulativePaid(s: ScenarioConfig, choice: FinalChoice, path: PaymentPath): number[] {
  const horizon = s.horizon_months;
  const out = new Array<number>(horizon).fill(0);

  const oneOff = (amount: number, atMonth: number) => {
    for (let k = atMonth; k <= horizon; k += 1) out[k - 1] = amount;
  };
  const perPeriod = (amount: number, periods: number) => {
    for (let k = 1; k <= horizon; k += 1) out[k - 1] = round2(Math.min(k, periods) * amount);
  };

  switch (choice) {
    case 'full_payment':
      oneOff(s.base_price, 1);
      break;
    case 'installment':
      perPeriod(s.installment_payment, s.installment_periods);
      break;
    case 'save_then_buy': {
      const months = monthsToSave(s);
      // 攒不够或攒够的时点超出模拟窗口时，窗口内不发生支付
      if (months !== null && months <= horizon) oneOff(s.base_price, months);
      break;
    }
    case 'alternative':
      if (path === 'installment') {
        perPeriod(s.alternative_installment_payment, s.alternative_installment_periods);
      } else {
        oneOff(s.alternative_price, 1);
      }
      break;
    case 'not_now':
      break;
  }
  return out;
}

/**
 * 完整还款期内每个月末的可用余额轨迹。
 *   第 k 个月末余额 = 期初可自由使用资金 + k × 月净结余 − 截至该月末的累计支付
 *
 * 与 30 天口径的区别只有一条：这里计入月收入。30 天口径假设期间没有任何进账，
 * 是更保守的瞬时快照；本函数反映按正常收支节奏走下去的轨迹。两者口径不同，不可混用。
 */
export function balancePath(
  s: ScenarioConfig,
  choice: FinalChoice,
  path: PaymentPath = 'full_payment',
): number[] {
  const net = monthlyNet(s);
  const paid = cumulativePaid(s, choice, path);
  const out: number[] = [];
  for (let k = 1; k <= s.horizon_months; k += 1) {
    out.push(round2(s.available_funds + k * net - paid[k - 1]));
  }
  return out;
}

/**
 * 等额本息分期的实际月利率。
 *
 * 情境参数里的"每期金额"和"分期总支付"本身就含利息（例如电脑 6000 元分 12 期共还 6600 元），
 * 但"总息费 600 元"这个说法会让人低估成本——分期是逐月还本的，真实资金占用远小于本金全额。
 * 这里用二分法反解下面这个等额本息方程，得到每月实际利率：
 *
 *   本金 = 每期金额 × (1 - (1 + i)^-期数) / i
 *
 * 再按名义年化口径换算 APR = i × 12，与消费金融产品的披露口径一致。
 * 无解或参数不合法（总还款不大于本金）时返回 null。
 */
export function monthlyRate(principal: number, payment: number, periods: number): number | null {
  if (principal <= 0 || payment <= 0 || periods <= 0) return null;
  if (payment * periods <= principal) return null; // 无息或参数异常

  const pv = (i: number) => (payment * (1 - Math.pow(1 + i, -periods))) / i;

  let lo = 1e-9;
  let hi = 1; // 月息 100%，足以覆盖任何真实消费分期
  for (let k = 0; k < 200; k += 1) {
    const mid = (lo + hi) / 2;
    if (pv(mid) > principal) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** 名义年化利率（APR）。返回小数，例如 0.1832 表示 18.32%。 */
export function annualRate(principal: number, payment: number, periods: number): number | null {
  const i = monthlyRate(principal, payment, periods);
  return i === null ? null : i * 12;
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
      months_to_save = monthsToSave(s);
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

  // 完整还款期轨迹。第二轮的主要风险判定基于它。
  const path_balances = balancePath(s, choice, path);
  let worst_balance_term = path_balances[0];
  let worst_balance_month = 1;
  for (let i = 1; i < path_balances.length; i += 1) {
    if (path_balances[i] < worst_balance_term) {
      worst_balance_term = path_balances[i];
      worst_balance_month = i + 1;
    }
  }

  // 付款后手里还剩多少钱（尚未扣除未来 30 天的必要支出）
  const remaining_funds = round2(s.available_funds - due_now);

  // 只有分期路径才有利率可言
  const apr =
    payment_path === 'installment' && monthly_burden !== null && installment_term !== null
      ? annualRate(price_of_item, monthly_burden, installment_term)
      : null;

  return {
    choice,
    payment_path,
    due_now: round2(due_now),
    remaining_funds,
    projected_min_balance: projected,
    high_risk_choice: isHighRisk(s, projected),
    balance_path: path_balances,
    worst_balance_term,
    worst_balance_month,
    high_risk_term: worst_balance_term < s.emergency_reserve,
    monthly_net: monthlyNet(s),
    total_payment: round2(total_payment),
    total_interest: round2(total_payment - price_of_item),
    annual_rate: apr,
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
