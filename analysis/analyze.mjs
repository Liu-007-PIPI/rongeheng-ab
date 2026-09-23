/**
 * 融e衡 A/B 实验 —— 正式分析脚本。
 *
 * 严格按《融e衡项目Claude交接文档》第十章的预定方案执行，不因为看到结果而改口径。
 *
 *   10.1 分析总体：只要正式码、已同意、完成三个情境、未撤回
 *   10.2 分组可比性：先报基线分布
 *   10.3 主要指标：参与者层面的高风险比例；置换检验 + Mann-Whitney U；bootstrap 置信区间
 *   10.4 次要指标：仅用于解释机制，不取代主要指标
 *   10.5 报告顺序：样本流转 → A/B 人数 → 基线分布 → 主要指标 → 置信区间 → 次要指标 → 限制
 *
 * 用法：
 *   node analysis/analyze.mjs <CSV 所在目录>
 *
 * 输出：终端可读报告 + 同目录下的 analysis_result.json（供生成文档使用）
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  bootstrapDiffCI,
  bootstrapMeanCI,
  fisherExact,
  mannWhitneyU,
  mean,
  median,
  permutationTest,
  quantile,
  sd,
  wilsonInterval,
} from './stats.mjs';

/* ────────────────── CSV 解析 ────────────────── */

/** 按 RFC 4180 解析，处理引号包裹与转义。 */
function parseCsv(text) {
  const clean = text.replace(/^﻿/, '');
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < clean.length; i += 1) {
    const ch = clean[i];
    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i += 1;
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\r') {
      /* 跳过，等 \n */
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const [headers, ...body] = rows.filter((r) => r.some((c) => c !== ''));
  return body.map((r) => Object.fromEntries(headers.map((h, i) => [h.trim(), r[i] ?? ''])));
}

const bool = (v) => v === 'TRUE';
const numOrNull = (v) => (v === '' ? null : Number(v));

/* ────────────────── 载入 ────────────────── */

const dir = process.argv[2] ?? '.';
const DATE = '2026-09-20';
const load = (name) => parseCsv(readFileSync(join(dir, `rongeheng_${name}_${DATE}.csv`), 'utf8'));

const participants = load('participants');
const sessions = load('experiment_sessions');
const decisions = load('decisions');
const events = load('events');
const withdrawals = load('withdrawal_log');

/* ────────────────── 10.1 分析总体与样本流转 ────────────────── */

const sessionByParticipant = new Map(sessions.map((s) => [s.participant_id, s]));
const decisionsByParticipant = new Map();
for (const d of decisions) {
  if (!decisionsByParticipant.has(d.participant_id)) decisionsByParticipant.set(d.participant_id, []);
  decisionsByParticipant.get(d.participant_id).push(d);
}
const withdrawnLabels = new Set(withdrawals.map((w) => w.access_code_label));

const SCENARIOS_PER_PARTICIPANT = 3;

const views = participants.map((p) => {
  const session = sessionByParticipant.get(p.participant_id) ?? null;
  const ds = decisionsByParticipant.get(p.participant_id) ?? [];
  return {
    code: p.access_code_label,
    variant: p.variant,
    code_type: p.code_type,
    baseline: {
      age_group: p.age_group,
      role_status: p.role_status,
      disposable_funds_band: p.disposable_funds_band,
      installment_experience: p.installment_experience,
      recent_large_purchase: p.recent_large_purchase,
    },
    session,
    decisions: ds,
    withdrawn: withdrawnLabels.has(p.access_code_label),
    completed: session?.completion_status === 'completed' && ds.length === SCENARIOS_PER_PARTICIPANT,
  };
});

// 样本流转，逐条记录排除原因（交接文档 15：任何排除都保留原因与前后样本数）
const flow = {
  registered_codes: 50,
  participants_total: views.length,
  pilot: views.filter((v) => v.code_type === 'pilot').length,
  formal: views.filter((v) => v.code_type === 'formal').length,
  withdrawn: views.filter((v) => v.withdrawn).length,
  incomplete: views.filter((v) => v.code_type === 'formal' && !v.withdrawn && !v.completed).length,
};

const analysisSet = views.filter(
  (v) => v.code_type === 'formal' && !v.withdrawn && v.completed,
);
flow.analysis_set = analysisSet.length;

const groupA = analysisSet.filter((v) => v.variant === 'A');
const groupB = analysisSet.filter((v) => v.variant === 'B');

/* ────────────────── 10.2 基线分布 ────────────────── */

const BASELINE_LABELS = {
  age_group: {
    under_18: '18 岁以下',
    '18_22': '18 至 22 岁',
    '23_25': '23 至 25 岁',
    '26_30': '26 至 30 岁',
    over_30: '30 岁以上',
  },
  role_status: {
    undergraduate: '本科生',
    postgraduate: '研究生',
    work_under_1y: '参加工作 1 年内',
    work_1_3y: '工作 1 至 3 年',
    other: '其他',
  },
  disposable_funds_band: {
    lt_1000: '1000 元以下',
    '1000_2000': '1000 至 2000 元',
    '2000_3500': '2000 至 3500 元',
    '3500_5000': '3500 至 5000 元',
    gt_5000: '5000 元以上',
  },
  installment_experience: {
    never: '从未使用过',
    '1_2_times': '用过 1 至 2 次',
    occasional: '偶尔使用',
    frequent: '经常使用',
  },
  recent_large_purchase: { TRUE: '有', FALSE: '没有', '': '未作答' },
};

function baselineTable(field) {
  const keys = Object.keys(BASELINE_LABELS[field]);
  const present = [...new Set(analysisSet.map((v) => v.baseline[field]))];
  const ordered = keys.filter((k) => present.includes(k));
  for (const p of present) if (!ordered.includes(p)) ordered.push(p);

  return ordered.map((key) => {
    const a = groupA.filter((v) => v.baseline[field] === key).length;
    const b = groupB.filter((v) => v.baseline[field] === key).length;
    return {
      key,
      label: BASELINE_LABELS[field][key] ?? key,
      a_n: a,
      a_pct: groupA.length ? a / groupA.length : null,
      b_n: b,
      b_pct: groupB.length ? b / groupB.length : null,
    };
  });
}

const baseline = {
  age_group: baselineTable('age_group'),
  role_status: baselineTable('role_status'),
  disposable_funds_band: baselineTable('disposable_funds_band'),
  installment_experience: baselineTable('installment_experience'),
  recent_large_purchase: baselineTable('recent_large_purchase'),
};

/* ────────────────── 10.3 主要指标 ────────────────── */

/** 个人高风险比例 = 三个情境中高风险选择数 ÷ 3 */
const ratioOf = (v) =>
  v.decisions.filter((d) => bool(d.high_risk_choice)).length / v.decisions.length;
const countOf = (v) => v.decisions.filter((d) => bool(d.high_risk_choice)).length;

const ratiosA = groupA.map(ratioOf);
const ratiosB = groupB.map(ratioOf);

function describe(ratios, group) {
  return {
    n: group.length,
    n_decisions: group.reduce((acc, v) => acc + v.decisions.length, 0),
    mean: mean(ratios),
    sd: sd(ratios),
    median: median(ratios),
    q1: quantile(ratios, 0.25),
    q3: quantile(ratios, 0.75),
    mean_count: mean(group.map(countOf)),
    mean_ci: bootstrapMeanCI(ratios),
    distribution: [0, 1, 2, 3].map((k) => ({
      high_risk_count: k,
      n: group.filter((v) => countOf(v) === k).length,
    })),
  };
}

let primaryMde;
const primary = {
  a: describe(ratiosA, groupA),
  b: describe(ratiosB, groupB),
  absolute_difference: mean(ratiosB) - mean(ratiosA),
  bootstrap_ci: bootstrapDiffCI(ratiosA, ratiosB),
  permutation: permutationTest(ratiosA, ratiosB),
  mann_whitney: mannWhitneyU(ratiosA, ratiosB),
};

/**
 * 最小可检测效应（MDE）。
 *
 * 这个数字回答的是："以本轮的人数，多大的差异才有八成把握被检测出来？"
 * 公式：MDE = (z_{α/2} + z_{power}) × 合并标准差 × √(2/每组人数)
 * 它不是事后功效分析（那种做法有争议），而是设计层面的敏感度说明，
 * 用来讲清楚"没测出差异"与"不存在差异"是两件事。
 */
const pooledSd = Math.sqrt((sd(ratiosA) ** 2 + sd(ratiosB) ** 2) / 2);
const nPerGroup = Math.min(groupA.length, groupB.length);
primaryMde = {
  pooled_sd: pooledSd,
  n_per_group: nPerGroup,
  mde_80_power: (1.959963985 + 0.8416212336) * pooledSd * Math.sqrt(2 / nPerGroup),
  note: '双侧 α=0.05、检验效能 80% 下，本轮人数能可靠检出的最小组间差异',
};

// 补充：至少出现一次高风险选择
const anyA = groupA.filter((v) => countOf(v) > 0).length;
const anyB = groupB.filter((v) => countOf(v) > 0).length;
const anyHighRisk = {
  a_n: anyA,
  a_total: groupA.length,
  a_rate: anyA / groupA.length,
  a_ci: wilsonInterval(anyA, groupA.length),
  b_n: anyB,
  b_total: groupB.length,
  b_rate: anyB / groupB.length,
  b_ci: wilsonInterval(anyB, groupB.length),
  fisher: fisherExact(anyA, groupA.length - anyA, anyB, groupB.length - anyB),
};

/* ────────────────── 10.4 次要指标 ────────────────── */

const CHOICE_LABELS = {
  full_payment: '全款购买',
  installment: '分期购买',
  save_then_buy: '先储蓄后购买',
  alternative: '购买低价替代项',
  not_now: '暂不购买',
};

function secondaryFor(group) {
  const ds = group.flatMap((v) => v.decisions);
  const n = ds.length;
  const rate = (pred) => (n ? ds.filter(pred).length / n : null);
  return {
    n_decisions: n,
    choice_distribution: Object.keys(CHOICE_LABELS).map((key) => ({
      key,
      label: CHOICE_LABELS[key],
      n: ds.filter((d) => d.final_choice === key).length,
      rate: n ? ds.filter((d) => d.final_choice === key).length / n : null,
    })),
    installment_rate: rate((d) => d.final_choice === 'installment'),
    defer_rate: rate((d) => d.final_choice === 'save_then_buy' || d.final_choice === 'not_now'),
    alternative_choice_rate: rate((d) => d.final_choice === 'alternative'),
    alternative_click_rate: rate((d) => bool(d.clicked_lower_price)),
    changed_choice_rate: rate((d) => bool(d.changed_choice)),
    viewed_cashflow_rate: rate((d) => bool(d.viewed_cashflow)),
    viewed_total_cost_rate: rate((d) => bool(d.viewed_total_cost)),
    median_decision_time_ms: median(ds.map((d) => Number(d.decision_time_ms))),
    q1_decision_time_ms: quantile(ds.map((d) => Number(d.decision_time_ms)), 0.25),
    q3_decision_time_ms: quantile(ds.map((d) => Number(d.decision_time_ms)), 0.75),
  };
}

const secondary = { a: secondaryFor(groupA), b: secondaryFor(groupB) };

// 决策时间也在参与者层面比一次，避免把 114 条当独立样本
const medianTimeA = groupA.map((v) => median(v.decisions.map((d) => Number(d.decision_time_ms))));
const medianTimeB = groupB.map((v) => median(v.decisions.map((d) => Number(d.decision_time_ms))));
secondary.decision_time_participant_level = {
  a_median_of_medians: median(medianTimeA),
  b_median_of_medians: median(medianTimeB),
  mann_whitney: mannWhitneyU(medianTimeA, medianTimeB),
};

/* ────────────────── 分情境 ────────────────── */

const SCENARIO_TITLES = { laptop: '笔记本电脑', phone: '手机', course: '培训课程' };

const byScenario = ['laptop', 'phone', 'course'].map((sid) => {
  const forGroup = (group) => {
    const ds = group.flatMap((v) => v.decisions).filter((d) => d.scenario_id === sid);
    return {
      n: ds.length,
      high_risk_n: ds.filter((d) => bool(d.high_risk_choice)).length,
      high_risk_rate: ds.length ? ds.filter((d) => bool(d.high_risk_choice)).length / ds.length : null,
      median_time_ms: median(ds.map((d) => Number(d.decision_time_ms))),
      choices: Object.keys(CHOICE_LABELS).map((key) => ({
        key,
        label: CHOICE_LABELS[key],
        n: ds.filter((d) => d.final_choice === key).length,
      })),
    };
  };
  const a = forGroup(groupA);
  const b = forGroup(groupB);
  return {
    scenario_id: sid,
    title: SCENARIO_TITLES[sid],
    a,
    b,
    difference: b.high_risk_rate !== null && a.high_risk_rate !== null ? b.high_risk_rate - a.high_risk_rate : null,
    fisher: fisherExact(a.high_risk_n, a.n - a.high_risk_n, b.high_risk_n, b.n - b.high_risk_n),
  };
});

/* ────────────────── 情境顺序核查 ────────────────── */

const orderCounts = {};
for (const v of analysisSet) {
  const order = v.session?.scenario_order ?? '';
  orderCounts[order] = (orderCounts[order] ?? 0) + 1;
}

/* ────────────────── B 版信息模块使用 ────────────────── */

const bDecisions = groupB.flatMap((v) => v.decisions);
const moduleUsage = {
  n_decisions: bDecisions.length,
  viewed_cashflow: bDecisions.filter((d) => bool(d.viewed_cashflow)).length,
  viewed_total_cost: bDecisions.filter((d) => bool(d.viewed_total_cost)).length,
  clicked_lower_price: bDecisions.filter((d) => bool(d.clicked_lower_price)).length,
};

// 在 B 组内部看：查看过现金流的决策与没查看过的，高风险率差多少
const bViewed = bDecisions.filter((d) => bool(d.viewed_cashflow));
const bNotViewed = bDecisions.filter((d) => !bool(d.viewed_cashflow));
moduleUsage.high_risk_when_viewed = bViewed.length
  ? bViewed.filter((d) => bool(d.high_risk_choice)).length / bViewed.length
  : null;
moduleUsage.high_risk_when_not_viewed = bNotViewed.length
  ? bNotViewed.filter((d) => bool(d.high_risk_choice)).length / bNotViewed.length
  : null;

/* ────────────────── 计算引擎自检 ────────────────── */

// 用冻结参数独立复算一遍风险标签，确认数据库写入的结果没有偏差
const SCENARIO_CONFIG = {
  laptop: { funds: 5000, expense: 3200, reserve: 1000 },
  phone: { funds: 6200, expense: 2800, reserve: 1200 },
  course: { funds: 3800, expense: 2600, reserve: 800 },
};
let mismatches = 0;
for (const d of decisions) {
  const cfg = SCENARIO_CONFIG[d.scenario_id];
  if (!cfg) continue;
  const expected = Number(d.projected_min_balance) < cfg.reserve;
  if (expected !== bool(d.high_risk_choice)) mismatches += 1;
}

/* ────────────────── 汇总输出 ────────────────── */

const result = {
  meta: {
    analysis_date: new Date().toISOString().slice(0, 10),
    data_export_date: DATE,
    source_tables: ['participants', 'experiment_sessions', 'decisions', 'events', 'withdrawal_log'],
    n_events: events.length,
    integrity_check: {
      risk_label_mismatches: mismatches,
      note: mismatches === 0 ? '全部决策的风险标签与冻结规则一致' : '存在不一致，需人工核查',
    },
  },
  flow,
  scenario_order_counts: orderCounts,
  baseline,
  primary: { ...primary, mde: primaryMde },
  any_high_risk: anyHighRisk,
  secondary,
  by_scenario: byScenario,
  module_usage: moduleUsage,
};

writeFileSync(join(dir, 'analysis_result.json'), JSON.stringify(result, null, 2), 'utf8');

/* ────────────────── 终端报告 ────────────────── */

const pct = (x) => (x === null || x === undefined ? '—' : `${(x * 100).toFixed(1)}%`);
const f2 = (x) => (x === null || x === undefined ? '—' : x.toFixed(2));
const sec = (ms) => (ms === null || ms === undefined ? '—' : `${(ms / 1000).toFixed(1)}s`);

console.log('\n══════ 一、样本流转 ══════');
console.log(`已登记匿名码            ${flow.registered_codes}`);
console.log(`产生参与者记录          ${flow.participants_total}`);
console.log(`  其中预试             ${flow.pilot}`);
console.log(`  其中正式             ${flow.formal}`);
console.log(`排除：已撤回            ${flow.withdrawn}`);
console.log(`排除：未完成三个情境    ${flow.incomplete}`);
console.log(`进入分析集              ${flow.analysis_set}  (A ${groupA.length} / B ${groupB.length})`);
console.log(`风险标签复算不一致      ${mismatches} 条`);

console.log('\n══════ 二、基线分布 ══════');
for (const [field, rows] of Object.entries(baseline)) {
  console.log(`\n【${field}】            A 组 (n=${groupA.length})      B 组 (n=${groupB.length})`);
  for (const r of rows) {
    console.log(`  ${r.label.padEnd(16)} ${String(r.a_n).padStart(3)} (${pct(r.a_pct).padStart(6)})   ${String(r.b_n).padStart(3)} (${pct(r.b_pct).padStart(6)})`);
  }
}

console.log('\n══════ 三、主要指标：参与者层面高风险选择比例 ══════');
console.log(`                        A 组            B 组`);
console.log(`人数                    ${String(primary.a.n).padStart(6)}          ${String(primary.b.n).padStart(6)}`);
console.log(`均值                    ${pct(primary.a.mean).padStart(6)}          ${pct(primary.b.mean).padStart(6)}`);
console.log(`标准差                  ${f2(primary.a.sd).padStart(6)}          ${f2(primary.b.sd).padStart(6)}`);
console.log(`中位数                  ${pct(primary.a.median).padStart(6)}          ${pct(primary.b.median).padStart(6)}`);
console.log(`Q1 / Q3                 ${pct(primary.a.q1)} / ${pct(primary.a.q3)}   ${pct(primary.b.q1)} / ${pct(primary.b.q3)}`);
console.log(`平均高风险情境数(/3)    ${f2(primary.a.mean_count).padStart(6)}          ${f2(primary.b.mean_count).padStart(6)}`);
console.log(`均值 95% CI             [${pct(primary.a.mean_ci.lower)}, ${pct(primary.a.mean_ci.upper)}]  [${pct(primary.b.mean_ci.lower)}, ${pct(primary.b.mean_ci.upper)}]`);

console.log(`\n绝对差 (B − A)          ${pct(primary.absolute_difference)}`);
console.log(`bootstrap 95% CI        [${pct(primary.bootstrap_ci.lower)}, ${pct(primary.bootstrap_ci.upper)}]  (${primary.bootstrap_ci.iterations} 次重抽)`);
console.log(`置换检验 p              ${primary.permutation.p_value.toFixed(4)}  (${primary.permutation.iterations} 次置换)`);
console.log(`Mann-Whitney U          U=${primary.mann_whitney.u}, z=${primary.mann_whitney.z?.toFixed(3)}, p=${primary.mann_whitney.p_value.toFixed(4)}`);
console.log(`最小可检测效应(80%功效) ${pct(primaryMde.mde_80_power)}  合并SD=${f2(primaryMde.pooled_sd)}, 每组 n=${primaryMde.n_per_group}`);

console.log('\n高风险情境数分布（人数）');
console.log(`  高风险数   A 组   B 组`);
for (let k = 0; k <= 3; k += 1) {
  const a = primary.a.distribution[k].n;
  const b = primary.b.distribution[k].n;
  console.log(`      ${k}       ${String(a).padStart(3)}    ${String(b).padStart(3)}`);
}

console.log('\n══════ 四、补充：至少出现一次高风险选择 ══════');
console.log(`A 组  ${anyHighRisk.a_n}/${anyHighRisk.a_total} = ${pct(anyHighRisk.a_rate)}  95%CI [${pct(anyHighRisk.a_ci.lower)}, ${pct(anyHighRisk.a_ci.upper)}]`);
console.log(`B 组  ${anyHighRisk.b_n}/${anyHighRisk.b_total} = ${pct(anyHighRisk.b_rate)}  95%CI [${pct(anyHighRisk.b_ci.lower)}, ${pct(anyHighRisk.b_ci.upper)}]`);
console.log(`Fisher 精确检验 p = ${anyHighRisk.fisher.p_value.toFixed(4)}`);

console.log('\n══════ 五、次要指标（决策层面） ══════');
console.log(`                        A 组            B 组`);
const sRows = [
  ['分期选择率', 'installment_rate'],
  ['暂缓购买率', 'defer_rate'],
  ['低价替代选择率', 'alternative_choice_rate'],
  ['低价替代点击率', 'alternative_click_rate'],
  ['提交前改过选择', 'changed_choice_rate'],
];
for (const [label, key] of sRows) {
  console.log(`${label.padEnd(20)}    ${pct(secondary.a[key]).padStart(6)}          ${pct(secondary.b[key]).padStart(6)}`);
}
console.log(`决策时间中位数          ${sec(secondary.a.median_decision_time_ms).padStart(6)}          ${sec(secondary.b.median_decision_time_ms).padStart(6)}`);
console.log(`  参与者层面比较        p = ${secondary.decision_time_participant_level.mann_whitney.p_value.toFixed(4)}`);

console.log('\n支付路径分布（决策数）');
console.log(`                        A 组            B 组`);
for (let i = 0; i < secondary.a.choice_distribution.length; i += 1) {
  const a = secondary.a.choice_distribution[i];
  const b = secondary.b.choice_distribution[i];
  console.log(`${a.label.padEnd(20)}  ${String(a.n).padStart(3)} (${pct(a.rate).padStart(6)})  ${String(b.n).padStart(3)} (${pct(b.rate).padStart(6)})`);
}

console.log('\n══════ 六、分情境 ══════');
for (const s of byScenario) {
  console.log(`\n【${s.title}】`);
  console.log(`  A 组高风险  ${s.a.high_risk_n}/${s.a.n} = ${pct(s.a.high_risk_rate)}`);
  console.log(`  B 组高风险  ${s.b.high_risk_n}/${s.b.n} = ${pct(s.b.high_risk_rate)}`);
  console.log(`  差异        ${pct(s.difference)}   Fisher p = ${s.fisher.p_value.toFixed(4)}`);
  console.log(`  决策时间中位数  A ${sec(s.a.median_time_ms)} / B ${sec(s.b.median_time_ms)}`);
}

console.log('\n══════ 七、B 版信息模块使用 ══════');
console.log(`B 组决策总数            ${moduleUsage.n_decisions}`);
console.log(`展开过资金情况          ${moduleUsage.viewed_cashflow} (${pct(moduleUsage.viewed_cashflow / moduleUsage.n_decisions)})`);
console.log(`查看过成本信息          ${moduleUsage.viewed_total_cost} (${pct(moduleUsage.viewed_total_cost / moduleUsage.n_decisions)})`);
console.log(`展开过低价替代          ${moduleUsage.clicked_lower_price} (${pct(moduleUsage.clicked_lower_price / moduleUsage.n_decisions)})`);
console.log(`\nB 组内部对照（非随机分配，仅描述）`);
console.log(`  查看过现金流的决策，高风险率  ${pct(moduleUsage.high_risk_when_viewed)}`);
console.log(`  未查看现金流的决策，高风险率  ${pct(moduleUsage.high_risk_when_not_viewed)}`);

console.log('\n══════ 八、情境顺序随机化核查 ══════');
for (const [order, n] of Object.entries(orderCounts).sort()) {
  console.log(`  ${order.padEnd(24)} ${n} 人`);
}

console.log(`\n结果已写入 ${join(dir, 'analysis_result.json')}\n`);
