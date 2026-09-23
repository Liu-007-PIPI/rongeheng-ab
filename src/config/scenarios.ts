import type { ScenarioConfig, ScenarioId } from '../lib/types';
import { round2 } from '../lib/money';

/**
 * 情境配置层。数值来自《融e衡项目Claude交接文档》4.3 的第一版建议参数。
 *
 * 规则：预试后可修正文案与难度，正式实验开始后必须冻结，且不得只改某一情境或只改 B 版。
 * 每次改动请同时提升 SCENARIO_VERSION 并在 README 的版本记录中写明日期与原因。
 *
 * 全部为实验模拟数据，不代表任何真实报价或真实金融产品。
 */
/**
 * 第二轮参数。相对第一轮（2026-09-19-v1）的变动与理由：
 *
 * 1. 新增 monthly_income 与 horizon_months。第一轮没有收入字段，无法做多月模拟——
 *    余额只会单调下降，所有路径最终都会破产，完整还款期指标无从谈起。
 * 2. 重新标定三个情境的风险结构。第一轮培训课程情境里分期本身就是高风险选项
 *    （月供 520 元后最低余额 680 元 < 应急储备 800 元），而另两个情境不是，
 *    导致情境之间难度不可比，也是该情境结果方向相反的结构性原因。
 * 3. 手机情境被刻意设计成"30 天口径安全、完整还款期跌破"——这是新指标存在的理由，
 *    如果没有任何情境能让两个口径给出不同结论，加这个指标就没有意义。
 *
 * 第一轮与第二轮的情境参数不同，两轮数据不可合并分析。
 */
/**
 * v3（2026-09-23）：只改文字，不改数字。
 * 情境标题、商品名、替代项名都换成口语说法，界面上的专业词（应急储备、净结余、
 * 折合年化利率）另在 ScenarioScreen 里配了解释行。所有金额、期数、储备线、
 * 时间跨度与 v2 逐字段相同，两个版本的数据在数值上可直接合并；
 * 仍然分版本号，是因为参与者读到的字面确实变了，需要可追溯。
 */
export const SCENARIO_VERSION = '2026-09-23-v3';

/**
 * 替代项分期参数的推导规则：沿用原商品的分期费率 installment_total / base_price。
 * 交接文档未给出替代项分期数值，这里用确定性公式推导，并在配置中标记 derived=true。
 * 预试阶段需由项目负责人确认是否保留该规则。
 */
function deriveAlternativeInstallment(
  base_price: number,
  installment_total: number,
  alternative_price: number,
  periods: number,
) {
  const rate = installment_total / base_price;
  const payment = round2((alternative_price * rate) / periods);
  return {
    alternative_installment_periods: periods,
    alternative_installment_payment: payment,
    alternative_installment_total: round2(payment * periods),
    alternative_installment_derived: true,
  };
}

export const SCENARIOS: Record<ScenarioId, ScenarioConfig> = {
  /**
   * 风险结构：仅"全款"为高风险，两个口径结论一致。
   * 月供 550 低于月净结余 800，分期在整个还款期内余额递增。
   */
  laptop: {
    scenario_id: 'laptop',
    scenario_version: SCENARIO_VERSION,
    title: '想换一台笔记本电脑',
    product_name: '轻薄笔记本电脑',
    product_model: '16G 内存 / 512G 硬盘',
    base_price: 6000,
    available_funds: 6000,
    necessary_expense_30d: 2200,
    monthly_income: 3000,
    emergency_reserve: 1500,
    horizon_months: 12,
    installment_periods: 12,
    installment_payment: 550,
    installment_total: 6600,
    alternative_name: '上一代机型，配置一样（16G / 512G）',
    alternative_price: 4999,
    ...deriveAlternativeInstallment(6000, 6600, 4999, 12),
    is_active: true,
  },

  /**
   * 关键情境：分期在 30 天口径下安全（2800 − 1200 − 467 = 1133 ≥ 1000），
   * 但月供 467 高于月净结余 300，余额每月侵蚀 167，第 12 个月末跌到 796 < 1000。
   * 两个口径在这里给出相反结论——这正是完整还款期指标要抓的情况。
   */
  phone: {
    scenario_id: 'phone',
    scenario_version: SCENARIO_VERSION,
    title: '想换一部手机',
    product_name: '智能手机',
    product_model: '256G 内存版',
    base_price: 4999,
    available_funds: 2800,
    necessary_expense_30d: 1200,
    monthly_income: 1500,
    emergency_reserve: 1000,
    horizon_months: 12,
    installment_periods: 12,
    installment_payment: 467,
    installment_total: 5604,
    alternative_name: '一模一样的型号，在别家买',
    alternative_price: 3999,
    ...deriveAlternativeInstallment(4999, 5604, 3999, 12),
    is_active: true,
  },

  /**
   * 风险结构与 laptop 一致：仅"全款"高风险。
   * 月供 520 高于月净结余 400，但 6 期累计侵蚀仅 720，不足以跌破 800 的储备线。
   */
  course: {
    scenario_id: 'course',
    scenario_version: SCENARIO_VERSION,
    title: '想报一门培训课',
    product_name: '技能培训课',
    product_model: '线上看录播，能提问，6 个月内有效',
    base_price: 2999,
    available_funds: 3200,
    necessary_expense_30d: 1500,
    monthly_income: 1900,
    emergency_reserve: 800,
    horizon_months: 6,
    installment_periods: 6,
    installment_payment: 520,
    installment_total: 3120,
    alternative_name: '差不多的课，换一家机构',
    alternative_price: 1999,
    ...deriveAlternativeInstallment(2999, 3120, 1999, 6),
    is_active: true,
  },
};

/** 情境池。参与者每次进入实验时，顺序在客户端随机后写入会话记录。 */
export const ALL_SCENARIO_IDS: ScenarioId[] = ['laptop', 'phone', 'course'];

/** 所有页面必须展示的模拟数据声明，文案统一从这里取，避免各页不一致。 */
export const SIMULATION_NOTICE =
  '这里的钱、商品、价格和分期都是为研究编出来的，不是真实报价，也不会真的扣你一分钱。';
