/**
 * 计算引擎单元测试。覆盖三个情境 × 每一个支付选项的期望值与风险标签。
 * 期望值由交接文档 4.3 的冻结参数手工推算得出，正式采集前必须全部通过。
 */
import { describe, expect, it } from 'vitest';
import { SCENARIOS } from '../config/scenarios';
import { evaluateOption, monthlySurplus } from './calc';
import type { FinalChoice, PaymentPath, ScenarioId } from './types';

interface Expectation {
  scenario: ScenarioId;
  choice: FinalChoice;
  path?: PaymentPath;
  due_now: number;
  projected_min_balance: number;
  high_risk_choice: boolean;
}

// 最低可用余额 = 可自由使用资金 - 未来30天必要支出 - 当期需支付金额
// 低于最低应急储备即标记为高风险
const CASES: Expectation[] = [
  // 电脑：资金 5000，必要支出 3200，应急储备 1000，售价 6000，12×550，替代 4999
  { scenario: 'laptop', choice: 'full_payment', due_now: 6000, projected_min_balance: -4200, high_risk_choice: true },
  { scenario: 'laptop', choice: 'installment', due_now: 550, projected_min_balance: 1250, high_risk_choice: false },
  { scenario: 'laptop', choice: 'save_then_buy', due_now: 0, projected_min_balance: 1800, high_risk_choice: false },
  { scenario: 'laptop', choice: 'alternative', path: 'full_payment', due_now: 4999, projected_min_balance: -3199, high_risk_choice: true },
  { scenario: 'laptop', choice: 'alternative', path: 'installment', due_now: 458.24, projected_min_balance: 1341.76, high_risk_choice: false },
  { scenario: 'laptop', choice: 'not_now', due_now: 0, projected_min_balance: 1800, high_risk_choice: false },

  // 手机：资金 6200，必要支出 2800，应急储备 1200，售价 4999，12×467，替代 3999
  { scenario: 'phone', choice: 'full_payment', due_now: 4999, projected_min_balance: -1599, high_risk_choice: true },
  { scenario: 'phone', choice: 'installment', due_now: 467, projected_min_balance: 2933, high_risk_choice: false },
  { scenario: 'phone', choice: 'save_then_buy', due_now: 0, projected_min_balance: 3400, high_risk_choice: false },
  { scenario: 'phone', choice: 'alternative', path: 'full_payment', due_now: 3999, projected_min_balance: -599, high_risk_choice: true },
  { scenario: 'phone', choice: 'alternative', path: 'installment', due_now: 373.58, projected_min_balance: 3026.42, high_risk_choice: false },
  { scenario: 'phone', choice: 'not_now', due_now: 0, projected_min_balance: 3400, high_risk_choice: false },

  // 培训课程：资金 3800，必要支出 2600，应急储备 800，售价 2999，6×520，替代 1999
  { scenario: 'course', choice: 'full_payment', due_now: 2999, projected_min_balance: -1799, high_risk_choice: true },
  // 分期首期后余额 680，低于 800 的应急储备，因此同样是高风险
  { scenario: 'course', choice: 'installment', due_now: 520, projected_min_balance: 680, high_risk_choice: true },
  { scenario: 'course', choice: 'save_then_buy', due_now: 0, projected_min_balance: 1200, high_risk_choice: false },
  { scenario: 'course', choice: 'alternative', path: 'full_payment', due_now: 1999, projected_min_balance: -799, high_risk_choice: true },
  { scenario: 'course', choice: 'alternative', path: 'installment', due_now: 346.61, projected_min_balance: 853.39, high_risk_choice: false },
  { scenario: 'course', choice: 'not_now', due_now: 0, projected_min_balance: 1200, high_risk_choice: false },
];

describe('三个情境的每个支付路径', () => {
  for (const c of CASES) {
    const name = `${c.scenario} / ${c.choice}${c.path ? ` / ${c.path}` : ''}`;
    it(name, () => {
      const outcome = evaluateOption(SCENARIOS[c.scenario], c.choice, c.path ?? 'full_payment');
      expect(outcome.due_now).toBe(c.due_now);
      expect(outcome.projected_min_balance).toBe(c.projected_min_balance);
      expect(outcome.high_risk_choice).toBe(c.high_risk_choice);
    });
  }
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
  it('按每月可结余推算', () => {
    expect(monthlySurplus(SCENARIOS.laptop)).toBe(800);
    expect(evaluateOption(SCENARIOS.laptop, 'save_then_buy').months_to_save).toBe(8);

    expect(monthlySurplus(SCENARIOS.phone)).toBe(2200);
    expect(evaluateOption(SCENARIOS.phone, 'save_then_buy').months_to_save).toBe(3);

    expect(monthlySurplus(SCENARIOS.course)).toBe(400);
    expect(evaluateOption(SCENARIOS.course, 'save_then_buy').months_to_save).toBe(8);
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
});
