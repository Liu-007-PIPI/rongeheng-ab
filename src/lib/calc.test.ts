/**
 * 计算引擎单元测试。覆盖三个情境 × 每一个支付选项的期望值与两套风险标签。
 * 期望值由第二轮冻结参数（scenario_version = 2026-09-22-v2）手工推算得出，
 * 正式采集前必须全部通过。
 *
 * 两套口径务必分清：
 *   projected_min_balance / high_risk_choice —— 30 天快照，不计收入，与第一轮同口径
 *   worst_balance_term / high_risk_term      —— 完整还款期，计入月收入，第二轮主要口径
 */
import { describe, expect, it } from 'vitest';
import { SCENARIOS } from '../config/scenarios';
import { balancePath, evaluateOption, monthlyNet, monthlySurplus, monthsToSave } from './calc';
import { round2 } from './money';
import type { FinalChoice, PaymentPath, ScenarioId } from './types';

interface Expectation {
  scenario: ScenarioId;
  choice: FinalChoice;
  path?: PaymentPath;
  due_now: number;
  /** 30 天口径 */
  projected_min_balance: number;
  high_risk_choice: boolean;
  /** 完整还款期口径 */
  worst_balance_term: number;
  worst_balance_month: number;
  high_risk_term: boolean;
}

const CASES: Expectation[] = [
  // 电脑：期初 6000，月支 2200，月收 3000（净 800），储备 1500，售价 6000，12×550，替代 4999
  { scenario: 'laptop', choice: 'full_payment', due_now: 6000, projected_min_balance: -2200, high_risk_choice: true, worst_balance_term: 800, worst_balance_month: 1, high_risk_term: true },
  { scenario: 'laptop', choice: 'installment', due_now: 550, projected_min_balance: 3250, high_risk_choice: false, worst_balance_term: 6250, worst_balance_month: 1, high_risk_term: false },
  { scenario: 'laptop', choice: 'save_then_buy', due_now: 0, projected_min_balance: 3800, high_risk_choice: false, worst_balance_term: 1600, worst_balance_month: 2, high_risk_term: false },
  { scenario: 'laptop', choice: 'alternative', path: 'full_payment', due_now: 4999, projected_min_balance: -1199, high_risk_choice: true, worst_balance_term: 1801, worst_balance_month: 1, high_risk_term: false },
  { scenario: 'laptop', choice: 'alternative', path: 'installment', due_now: 458.24, projected_min_balance: 3341.76, high_risk_choice: false, worst_balance_term: 6341.76, worst_balance_month: 1, high_risk_term: false },
  { scenario: 'laptop', choice: 'not_now', due_now: 0, projected_min_balance: 3800, high_risk_choice: false, worst_balance_term: 6800, worst_balance_month: 1, high_risk_term: false },

  // 手机：期初 2800，月支 1200，月收 1500（净 300），储备 1000，售价 4999，12×467，替代 3999
  { scenario: 'phone', choice: 'full_payment', due_now: 4999, projected_min_balance: -3399, high_risk_choice: true, worst_balance_term: -1899, worst_balance_month: 1, high_risk_term: true },
  // 关键用例：30 天口径 1133 ≥ 1000 判安全，但月供 467 高于月净结余 300，
  // 余额每月侵蚀 167，第 12 个月末跌到 796 < 1000。两个口径结论相反。
  { scenario: 'phone', choice: 'installment', due_now: 467, projected_min_balance: 1133, high_risk_choice: false, worst_balance_term: 796, worst_balance_month: 12, high_risk_term: true },
  { scenario: 'phone', choice: 'save_then_buy', due_now: 0, projected_min_balance: 1600, high_risk_choice: false, worst_balance_term: 1101, worst_balance_month: 11, high_risk_term: false },
  { scenario: 'phone', choice: 'alternative', path: 'full_payment', due_now: 3999, projected_min_balance: -2399, high_risk_choice: true, worst_balance_term: -899, worst_balance_month: 1, high_risk_term: true },
  { scenario: 'phone', choice: 'alternative', path: 'installment', due_now: 373.58, projected_min_balance: 1226.42, high_risk_choice: false, worst_balance_term: 1917.04, worst_balance_month: 12, high_risk_term: false },
  { scenario: 'phone', choice: 'not_now', due_now: 0, projected_min_balance: 1600, high_risk_choice: false, worst_balance_term: 3100, worst_balance_month: 1, high_risk_term: false },

  // 培训课程：期初 3200，月支 1500，月收 1900（净 400），储备 800，售价 2999，6×520，替代 1999
  { scenario: 'course', choice: 'full_payment', due_now: 2999, projected_min_balance: -1299, high_risk_choice: true, worst_balance_term: 601, worst_balance_month: 1, high_risk_term: true },
  // 第一轮这里是高风险（680 < 800），是情境之间难度不可比的根源，第二轮已重新标定
  { scenario: 'course', choice: 'installment', due_now: 520, projected_min_balance: 1180, high_risk_choice: false, worst_balance_term: 2480, worst_balance_month: 6, high_risk_term: false },
  { scenario: 'course', choice: 'save_then_buy', due_now: 0, projected_min_balance: 1700, high_risk_choice: false, worst_balance_term: 1001, worst_balance_month: 2, high_risk_term: false },
  { scenario: 'course', choice: 'alternative', path: 'full_payment', due_now: 1999, projected_min_balance: -299, high_risk_choice: true, worst_balance_term: 1601, worst_balance_month: 1, high_risk_term: false },
  { scenario: 'course', choice: 'alternative', path: 'installment', due_now: 346.61, projected_min_balance: 1353.39, high_risk_choice: false, worst_balance_term: 3253.39, worst_balance_month: 1, high_risk_term: false },
  { scenario: 'course', choice: 'not_now', due_now: 0, projected_min_balance: 1700, high_risk_choice: false, worst_balance_term: 3600, worst_balance_month: 1, high_risk_term: false },
];

describe('三个情境的每个支付路径', () => {
  for (const c of CASES) {
    const name = `${c.scenario} / ${c.choice}${c.path ? ` / ${c.path}` : ''}`;
    it(name, () => {
      const o = evaluateOption(SCENARIOS[c.scenario], c.choice, c.path ?? 'full_payment');
      expect(o.due_now).toBe(c.due_now);
      expect(o.projected_min_balance).toBe(c.projected_min_balance);
      expect(o.high_risk_choice).toBe(c.high_risk_choice);
      expect(o.worst_balance_term).toBe(c.worst_balance_term);
      expect(o.worst_balance_month).toBe(c.worst_balance_month);
      expect(o.high_risk_term).toBe(c.high_risk_term);
    });
  }
});

describe('完整还款期模拟', () => {
  it('轨迹长度等于该情境的模拟月数', () => {
    for (const id of ['laptop', 'phone', 'course'] as ScenarioId[]) {
      const s = SCENARIOS[id];
      for (const c of ['full_payment', 'installment', 'save_then_buy', 'not_now'] as FinalChoice[]) {
        expect(balancePath(s, c)).toHaveLength(s.horizon_months);
      }
    }
  });

  it('第 k 个月末余额 = 期初 + k × 月净结余 − 累计支付', () => {
    const s = SCENARIOS.phone;
    const net = monthlyNet(s);
    const path = balancePath(s, 'installment');
    // 分期从第 1 个月起每月一期，第 k 个月末已付 k 期
    for (let k = 1; k <= s.horizon_months; k += 1) {
      expect(path[k - 1]).toBe(round2(s.available_funds + k * net - k * s.installment_payment));
    }
  });

  it('暂不购买时余额按月净结余单调增长', () => {
    const s = SCENARIOS.laptop;
    const path = balancePath(s, 'not_now');
    for (let i = 1; i < path.length; i += 1) {
      expect(path[i]).toBeGreaterThan(path[i - 1]);
    }
    expect(path[0]).toBe(s.available_funds + monthlyNet(s));
  });

  it('月供高于月净结余时余额逐月侵蚀，最低点落在最后一期', () => {
    const s = SCENARIOS.phone;
    expect(s.installment_payment).toBeGreaterThan(monthlyNet(s));
    const o = evaluateOption(s, 'installment');
    expect(o.worst_balance_month).toBe(s.installment_periods);
  });

  it('月供低于月净结余时余额逐月回升，最低点落在第一期', () => {
    const s = SCENARIOS.laptop;
    expect(s.installment_payment).toBeLessThan(monthlyNet(s));
    const o = evaluateOption(s, 'installment');
    expect(o.worst_balance_month).toBe(1);
  });
});

describe('两套风险口径的关系', () => {
  it('手机情境的分期是两个口径给出相反结论的用例', () => {
    const o = evaluateOption(SCENARIOS.phone, 'installment');
    expect(o.high_risk_choice).toBe(false); // 30 天口径：安全
    expect(o.high_risk_term).toBe(true); // 完整还款期：跌破储备
  });

  it('先储蓄后购买在任何情境下都不是完整期高风险', () => {
    // 攒够的定义就是"买完之后仍不低于应急储备"，这条路径按定义不该被判高风险
    for (const id of ['laptop', 'phone', 'course'] as ScenarioId[]) {
      expect(evaluateOption(SCENARIOS[id], 'save_then_buy').high_risk_term).toBe(false);
    }
  });

  it('暂不购买在任何情境下都不是高风险', () => {
    for (const id of ['laptop', 'phone', 'course'] as ScenarioId[]) {
      const o = evaluateOption(SCENARIOS[id], 'not_now');
      expect(o.high_risk_choice).toBe(false);
      expect(o.high_risk_term).toBe(false);
    }
  });
});

describe('第二轮情境风险结构', () => {
  const termRiskCount = (id: ScenarioId) => {
    const combos: [FinalChoice, PaymentPath][] = [
      ['full_payment', 'full_payment'],
      ['installment', 'full_payment'],
      ['save_then_buy', 'full_payment'],
      ['alternative', 'full_payment'],
      ['alternative', 'installment'],
      ['not_now', 'full_payment'],
    ];
    return combos.filter(([c, p]) => evaluateOption(SCENARIOS[id], c, p).high_risk_term).length;
  };

  it('电脑与课程情境只有全款是完整期高风险', () => {
    expect(termRiskCount('laptop')).toBe(1);
    expect(termRiskCount('course')).toBe(1);
    expect(evaluateOption(SCENARIOS.laptop, 'full_payment').high_risk_term).toBe(true);
    expect(evaluateOption(SCENARIOS.course, 'full_payment').high_risk_term).toBe(true);
  });

  it('手机情境是资金明显不足的情境，三个选项为完整期高风险', () => {
    expect(termRiskCount('phone')).toBe(3);
  });

  it('每个情境都至少有一个安全选项，也至少有一个高风险选项', () => {
    for (const id of ['laptop', 'phone', 'course'] as ScenarioId[]) {
      const n = termRiskCount(id);
      expect(n).toBeGreaterThan(0);
      expect(n).toBeLessThan(6);
    }
  });
});

describe('总支付与总息费', () => {
  it('分期总支付与总息费与配置一致', () => {
    const laptop = evaluateOption(SCENARIOS.laptop, 'installment');
    expect(laptop.total_payment).toBe(6600);
    expect(laptop.total_interest).toBe(600);
    expect(laptop.monthly_burden).toBe(550);
    expect(laptop.installment_term).toBe(12);

    const course = evaluateOption(SCENARIOS.course, 'installment');
    expect(course.total_payment).toBe(3120);
    expect(course.total_interest).toBe(121);
  });

  it('全款无息费，暂不购买不产生支付', () => {
    expect(evaluateOption(SCENARIOS.phone, 'full_payment').total_interest).toBe(0);
    const notNow = evaluateOption(SCENARIOS.phone, 'not_now');
    expect(notNow.total_payment).toBe(0);
    expect(notNow.total_interest).toBe(0);
  });
});

describe('先储蓄后购买所需月数', () => {
  it('按月净结余与"买完仍不低于储备"的条件推算', () => {
    // 缺口 = 储备 + 售价 − 期初资金，再除以月净结余向上取整
    expect(monthlyNet(SCENARIOS.laptop)).toBe(800);
    expect(monthsToSave(SCENARIOS.laptop)).toBe(2); // ⌈(1500+6000−6000)/800⌉

    expect(monthlyNet(SCENARIOS.phone)).toBe(300);
    expect(monthsToSave(SCENARIOS.phone)).toBe(11); // ⌈(1000+4999−2800)/300⌉

    expect(monthlyNet(SCENARIOS.course)).toBe(400);
    expect(monthsToSave(SCENARIOS.course)).toBe(2); // ⌈(800+2999−3200)/400⌉
  });

  it('攒够的那个月买完之后仍不低于应急储备', () => {
    for (const id of ['laptop', 'phone', 'course'] as ScenarioId[]) {
      const s = SCENARIOS[id];
      const m = monthsToSave(s)!;
      const balanceAfterBuy = s.available_funds + m * monthlyNet(s) - s.base_price;
      expect(balanceAfterBuy).toBeGreaterThanOrEqual(s.emergency_reserve);
    }
  });

  it('攒够的时点落在模拟窗口内', () => {
    for (const id of ['laptop', 'phone', 'course'] as ScenarioId[]) {
      expect(monthsToSave(SCENARIOS[id])!).toBeLessThanOrEqual(SCENARIOS[id].horizon_months);
    }
  });
});

describe('替代项分期为推导参数', () => {
  it('三个情境都标记 derived，提醒预试后确认', () => {
    for (const id of ['laptop', 'phone', 'course'] as ScenarioId[]) {
      expect(SCENARIOS[id].alternative_installment_derived).toBe(true);
    }
  });
});

describe('A/B 共用同一份情境参数', () => {
  it('配置里不存在按版本区分的字段', () => {
    const keys = Object.keys(SCENARIOS.laptop);
    expect(keys.some((k) => /variant|version_a|version_b/i.test(k))).toBe(false);
  });

  it('第二轮所有情境都带月收入与模拟月数', () => {
    for (const id of ['laptop', 'phone', 'course'] as ScenarioId[]) {
      const s = SCENARIOS[id];
      expect(s.monthly_income).toBeGreaterThan(0);
      expect(s.horizon_months).toBeGreaterThanOrEqual(s.installment_periods);
      expect(s.scenario_version).toBe('2026-09-23-v3');
    }
  });
});

describe('分期的实际年化利率', () => {
  // 期望值由等额本息方程 本金 = 每期 × (1-(1+i)^-n)/i 反解得到，保留两位百分数
  const EXPECTED: Record<ScenarioId, number> = {
    laptop: 17.97,
    phone: 21.63,
    course: 13.70,
  };

  for (const id of ['laptop', 'phone', 'course'] as ScenarioId[]) {
    it(`${id} 的年化利率`, () => {
      const apr = evaluateOption(SCENARIOS[id], 'installment').annual_rate;
      expect(apr).not.toBeNull();
      expect(Number((apr! * 100).toFixed(2))).toBeCloseTo(EXPECTED[id], 2);
    });
  }

  it('替代项分期沿用同一费率，年化与原商品一致', () => {
    for (const id of ['laptop', 'phone', 'course'] as ScenarioId[]) {
      const main = evaluateOption(SCENARIOS[id], 'installment').annual_rate!;
      const alt = evaluateOption(SCENARIOS[id], 'alternative', 'installment').annual_rate!;
      expect(alt * 100).toBeCloseTo(main * 100, 1);
    }
  });

  it('非分期路径没有利率', () => {
    expect(evaluateOption(SCENARIOS.laptop, 'full_payment').annual_rate).toBeNull();
    expect(evaluateOption(SCENARIOS.laptop, 'save_then_buy').annual_rate).toBeNull();
    expect(evaluateOption(SCENARIOS.laptop, 'not_now').annual_rate).toBeNull();
    expect(evaluateOption(SCENARIOS.laptop, 'alternative', 'full_payment').annual_rate).toBeNull();
  });

  it('年化利率明显高于"总息费÷本金"给人的印象', () => {
    // 电脑：总息费 600 / 本金 6000 = 10%，但逐月还本后真实年化接近 18%
    const o = evaluateOption(SCENARIOS.laptop, 'installment');
    const naive = o.total_interest / SCENARIOS.laptop.base_price;
    expect(naive).toBeCloseTo(0.1, 4);
    expect(o.annual_rate!).toBeGreaterThan(naive * 1.7);
  });
});

describe('付款后剩余可用资金', () => {
  // 剩余可用资金 = 当前可自由使用资金 - 当期需支付金额（尚未扣除必要支出）
  it('三个情境的各路径', () => {
    expect(evaluateOption(SCENARIOS.laptop, 'full_payment').remaining_funds).toBe(0);
    expect(evaluateOption(SCENARIOS.laptop, 'installment').remaining_funds).toBe(5450);
    expect(evaluateOption(SCENARIOS.laptop, 'not_now').remaining_funds).toBe(6000);

    expect(evaluateOption(SCENARIOS.phone, 'full_payment').remaining_funds).toBe(-2199);
    expect(evaluateOption(SCENARIOS.phone, 'installment').remaining_funds).toBe(2333);

    expect(evaluateOption(SCENARIOS.course, 'full_payment').remaining_funds).toBe(201);
    expect(evaluateOption(SCENARIOS.course, 'installment').remaining_funds).toBe(2680);
    expect(evaluateOption(SCENARIOS.course, 'alternative', 'installment').remaining_funds).toBe(2853.39);
  });

  it('剩余可用资金减去必要支出就是 30 天口径最低可用余额', () => {
    for (const id of ['laptop', 'phone', 'course'] as ScenarioId[]) {
      const s = SCENARIOS[id];
      const o = evaluateOption(s, 'installment');
      expect(round2(o.remaining_funds - s.necessary_expense_30d)).toBe(o.projected_min_balance);
    }
  });
});

describe('当前可动用金额（界面展示用）', () => {
  it('仍按原口径：期初资金 − 月必要支出 − 应急储备', () => {
    expect(monthlySurplus(SCENARIOS.laptop)).toBe(2300);
    expect(monthlySurplus(SCENARIOS.phone)).toBe(600);
    expect(monthlySurplus(SCENARIOS.course)).toBe(900);
  });
});
