/**
 * 后台指标计算测试。
 * 重点锁三件事：参与者层面而非决策层面、预试默认排除、分母为 0 时给 null 不给 0。
 */
import { describe, expect, it } from 'vitest';
import {
  applyFilter,
  buildViews,
  computeAb,
  computeByScenario,
  computeCohort,
  computeOverview,
  DEFAULT_FILTER,
  highRiskRatio,
  median,
  quantile,
  rate,
} from './metrics';
import type { DataSnapshot } from './metrics';
import type {
  CodeType,
  DecisionRecord,
  FinalChoice,
  ParticipantRecord,
  ScenarioId,
  SessionRecord,
  Variant,
} from './types';

const SCENARIOS: ScenarioId[] = ['laptop', 'phone', 'course'];

/** 造一个参与者：riskFlags 决定三个情境各自是否高风险。 */
function makeParticipant(
  id: string,
  variant: Variant,
  riskFlags: boolean[],
  opts: { codeType?: CodeType; completed?: boolean; choice?: FinalChoice } = {},
) {
  const codeType = opts.codeType ?? 'formal';
  const completed = opts.completed ?? true;

  const participant: ParticipantRecord = {
    participant_id: id,
    access_code_label: id,
    variant,
    code_type: codeType,
    consent_version: 'v1.0',
    consent_at: '2026-09-20T00:00:00.000Z',
    created_at: '2026-09-20T00:00:00.000Z',
    baseline: {
      age_group: '18_22',
      role_status: 'undergraduate',
      disposable_funds_band: '1000_2000',
      installment_experience: 'never',
      recent_large_purchase: false,
    },
  };

  const session: SessionRecord = {
    session_id: `s-${id}`,
    participant_id: id,
    variant,
    scenario_order: SCENARIOS,
    started_at: '2026-09-20T00:00:00.000Z',
    completed_at: completed ? '2026-09-20T00:10:00.000Z' : null,
    total_duration_ms: completed ? 600000 : null,
    completion_status: completed ? 'completed' : 'in_progress',
    app_version: 'test',
  };

  const decisions: DecisionRecord[] = riskFlags.map((risky, i) => ({
    decision_id: `d-${id}-${i}`,
    session_id: session.session_id,
    participant_id: id,
    scenario_id: SCENARIOS[i],
    scenario_position: i + 1,
    final_choice: opts.choice ?? 'installment',
    selected_payment_path: 'installment',
    installment_term: 12,
    projected_min_balance: risky ? -100 : 2000,
    high_risk_choice: risky,
    viewed_cashflow: variant === 'B',
    viewed_total_cost: variant === 'B',
    clicked_lower_price: false,
    changed_choice: false,
    decision_time_ms: (i + 1) * 10000,
    submitted_at: '2026-09-20T00:05:00.000Z',
  }));

  return { participant, session, decisions };
}

function makeSnapshot(
  people: ReturnType<typeof makeParticipant>[],
  withdrawnLabels: string[] = [],
): DataSnapshot {
  return {
    participants: people.map((p) => p.participant),
    sessions: people.map((p) => p.session),
    decisions: people.flatMap((p) => p.decisions),
    withdrawals: withdrawnLabels.map((label, i) => ({
      id: `w-${i}`,
      access_code_label: label,
      requested_at: '2026-09-20T01:00:00.000Z',
      processed_at: '2026-09-20T01:00:00.000Z',
      processed_by: 'test',
      note: '测试撤回',
    })),
  };
}

describe('基础统计', () => {
  it('分位数用线性插值，与 numpy 默认一致', () => {
    const v = [1, 2, 3, 4];
    expect(quantile(v, 0.25)).toBeCloseTo(1.75, 10);
    expect(quantile(v, 0.5)).toBeCloseTo(2.5, 10);
    expect(quantile(v, 0.75)).toBeCloseTo(3.25, 10);
  });

  it('空数组返回 null，不返回 0', () => {
    expect(quantile([], 0.5)).toBeNull();
    expect(median([])).toBeNull();
    expect(rate(0, 0)).toBeNull();
  });

  it('分子为 0 但分母不为 0 时返回 0，和"没有样本"区分得开', () => {
    expect(rate(0, 10)).toBe(0);
  });
});

describe('主要指标按参与者层面计算', () => {
  it('个人高风险比例 = 高风险情境数 / 3', () => {
    const p = makeParticipant('A001', 'A', [true, true, false]);
    const view = buildViews(makeSnapshot([p]))[0];
    expect(highRiskRatio(view)).toBeCloseTo(2 / 3, 10);
  });

  it('两人各 3 条决策，分母是 2 不是 6', () => {
    const snapshot = makeSnapshot([
      makeParticipant('A001', 'A', [true, true, true]), // 比例 1.0
      makeParticipant('A002', 'A', [false, false, false]), // 比例 0.0
    ]);
    const views = applyFilter(buildViews(snapshot), DEFAULT_FILTER);
    const a = computeCohort(views, 'A');

    expect(a.n_participants).toBe(2);
    expect(a.n_decisions).toBe(6);
    // 参与者层面平均 = (1.0 + 0.0) / 2 = 0.5
    expect(a.mean_high_risk_ratio).toBeCloseTo(0.5, 10);
    // 若误按决策层面算也是 0.5，所以再用一组不对称的验证
    expect(a.mean_high_risk_count).toBeCloseTo(1.5, 10);
  });

  it('参与者层面与决策层面在不均衡数据上结果不同', () => {
    const snapshot = makeSnapshot([
      makeParticipant('A001', 'A', [true, true, true]), // 3/3
      makeParticipant('A002', 'A', [true, false, false]), // 1/3
      makeParticipant('A003', 'A', [false, false, false]), // 0/3
    ]);
    const views = applyFilter(buildViews(snapshot), DEFAULT_FILTER);
    const a = computeCohort(views, 'A');

    // 参与者层面：(1 + 1/3 + 0) / 3 = 4/9 ≈ 0.4444
    expect(a.mean_high_risk_ratio).toBeCloseTo(4 / 9, 10);
    // 决策层面会是 4/9 也相同（因为每人都是 3 条），这里再核一次中位数区分
    expect(a.median_high_risk_ratio).toBeCloseTo(1 / 3, 10);
    expect(a.any_high_risk_n).toBe(2);
    expect(a.any_high_risk_ratio).toBeCloseTo(2 / 3, 10);
  });

  it('绝对差 = B 平均 − A 平均，负值代表 B 版高风险更少', () => {
    const snapshot = makeSnapshot([
      makeParticipant('A001', 'A', [true, true, true]),
      makeParticipant('A002', 'A', [true, true, true]),
      makeParticipant('B001', 'B', [true, false, false]),
      makeParticipant('B002', 'B', [false, false, false]),
    ]);
    const views = applyFilter(buildViews(snapshot), DEFAULT_FILTER);
    const ab = computeAb(views);

    expect(ab.a.mean_high_risk_ratio).toBeCloseTo(1, 10);
    expect(ab.b.mean_high_risk_ratio).toBeCloseTo(1 / 6, 10);
    expect(ab.absolute_difference).toBeCloseTo(1 / 6 - 1, 10);
    expect(ab.absolute_difference! < 0).toBe(true);
  });
});

describe('分析总体与排除规则', () => {
  it('默认只保留正式样本，预试不进入', () => {
    const snapshot = makeSnapshot([
      makeParticipant('A001', 'A', [true, true, true]),
      makeParticipant('PILOT01', 'A', [false, false, false], { codeType: 'pilot' }),
    ]);
    const views = applyFilter(buildViews(snapshot), DEFAULT_FILTER);
    expect(views).toHaveLength(1);
    expect(views[0].participant.access_code_label).toBe('A001');
  });

  it('未完成三个情境的会话默认排除', () => {
    const partial = makeParticipant('A002', 'A', [true], { completed: false });
    const snapshot = makeSnapshot([makeParticipant('A001', 'A', [true, true, true]), partial]);
    expect(applyFilter(buildViews(snapshot), DEFAULT_FILTER)).toHaveLength(1);
    // 放开完成要求后两人都在
    expect(
      applyFilter(buildViews(snapshot), { codeType: 'formal', completedOnly: false }),
    ).toHaveLength(2);
  });

  it('撤回记录一律排除，与筛选条件无关', () => {
    const snapshot = makeSnapshot(
      [makeParticipant('A001', 'A', [true, true, true]), makeParticipant('A002', 'A', [false, false, false])],
      ['A002'],
    );
    const all = applyFilter(buildViews(snapshot), { codeType: 'all', completedOnly: false });
    expect(all).toHaveLength(1);
    expect(all[0].participant.access_code_label).toBe('A001');
  });
});

describe('总览', () => {
  it('开始、完成、撤回、A/B 与预试分别统计', () => {
    const snapshot = makeSnapshot(
      [
        makeParticipant('A001', 'A', [true, true, true]),
        makeParticipant('B001', 'B', [false, false, false]),
        makeParticipant('B002', 'B', [false], { completed: false }),
        makeParticipant('PILOT01', 'A', [true, true, true], { codeType: 'pilot' }),
        makeParticipant('A002', 'A', [true, true, true]),
      ],
      ['A002'],
    );
    const o = computeOverview(snapshot, 50);

    expect(o.issued_codes).toBe(50);
    expect(o.started).toBe(4); // 排除撤回的 A002
    expect(o.completed).toBe(3);
    expect(o.in_progress).toBe(1);
    expect(o.withdrawn).toBe(1);
    expect(o.completed_a).toBe(2); // A001 + PILOT01
    expect(o.completed_b).toBe(1);
    expect(o.formal_started).toBe(3);
    expect(o.pilot_completed).toBe(1);
  });
});

describe('空数据不会显示成 0', () => {
  it('没有参与者时所有比率为 null', () => {
    const views = applyFilter(buildViews(makeSnapshot([])), DEFAULT_FILTER);
    const a = computeCohort(views, 'A');

    expect(a.n_participants).toBe(0);
    expect(a.mean_high_risk_ratio).toBeNull();
    expect(a.median_high_risk_ratio).toBeNull();
    expect(a.installment_rate).toBeNull();
    expect(a.median_decision_time_ms).toBeNull();
    expect(computeAb(views).absolute_difference).toBeNull();
  });

  it('A 组的 B 版专属指标恒为 null，不参与比较', () => {
    const snapshot = makeSnapshot([makeParticipant('A001', 'A', [true, true, true])]);
    const views = applyFilter(buildViews(snapshot), DEFAULT_FILTER);
    const a = computeCohort(views, 'A');
    expect(a.viewed_cashflow_rate).toBeNull();
    expect(a.viewed_total_cost_rate).toBeNull();
  });
});

describe('分情境拆分', () => {
  it('三个情境各自统计高风险率', () => {
    const snapshot = makeSnapshot([
      makeParticipant('A001', 'A', [true, false, false]),
      makeParticipant('A002', 'A', [true, false, true]),
    ]);
    const views = applyFilter(buildViews(snapshot), DEFAULT_FILTER);
    const rows = computeByScenario(views);

    expect(rows).toHaveLength(3);
    expect(rows.find((r) => r.scenario_id === 'laptop')!.high_risk_rate).toBe(1);
    expect(rows.find((r) => r.scenario_id === 'phone')!.high_risk_rate).toBe(0);
    expect(rows.find((r) => r.scenario_id === 'course')!.high_risk_rate).toBe(0.5);
  });
});

describe('次要指标', () => {
  it('暂缓购买率合并"先储蓄"与"暂不购买"', () => {
    const snapshot = makeSnapshot([
      makeParticipant('A001', 'A', [false, false, false], { choice: 'save_then_buy' }),
      makeParticipant('A002', 'A', [false, false, false], { choice: 'not_now' }),
      makeParticipant('A003', 'A', [false, false, false], { choice: 'full_payment' }),
    ]);
    const views = applyFilter(buildViews(snapshot), DEFAULT_FILTER);
    const a = computeCohort(views, 'A');
    expect(a.defer_rate).toBeCloseTo(6 / 9, 10);
    expect(a.installment_rate).toBe(0);
  });
});
