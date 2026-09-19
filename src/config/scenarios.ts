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
export const SCENARIO_VERSION = '2026-09-19-v1';

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
  laptop: {
    scenario_id: 'laptop',
    scenario_version: SCENARIO_VERSION,
    title: '换一台笔记本电脑',
    product_name: '轻薄笔记本电脑',
    product_model: '16G 内存 / 512G 固态',
    base_price: 6000,
    available_funds: 5000,
    necessary_expense_30d: 3200,
    emergency_reserve: 1000,
    installment_periods: 12,
    installment_payment: 550,
    installment_total: 6600,
    alternative_name: '同需求上一代机型（16G / 512G）',
    alternative_price: 4999,
    ...deriveAlternativeInstallment(6000, 6600, 4999, 12),
    is_active: true,
  },
  phone: {
    scenario_id: 'phone',
    scenario_version: SCENARIO_VERSION,
    title: '换一部手机',
    product_name: '智能手机',
    product_model: '256G 存储',
    base_price: 4999,
    available_funds: 6200,
    necessary_expense_30d: 2800,
    emergency_reserve: 1200,
    installment_periods: 12,
    installment_payment: 467,
    installment_total: 5604,
    alternative_name: '同型号其他可靠渠道',
    alternative_price: 3999,
    ...deriveAlternativeInstallment(4999, 5604, 3999, 12),
    is_active: true,
  },
  course: {
    scenario_id: 'course',
    scenario_version: SCENARIO_VERSION,
    title: '报一门培训课程',
    product_name: '技能培训课程',
    product_model: '线上录播 + 答疑，6 个月有效期',
    base_price: 2999,
    available_funds: 3800,
    necessary_expense_30d: 2600,
    emergency_reserve: 800,
    installment_periods: 6,
    installment_payment: 520,
    installment_total: 3120,
    alternative_name: '同类课程其他机构',
    alternative_price: 1999,
    ...deriveAlternativeInstallment(2999, 3120, 1999, 6),
    is_active: true,
  },
};

/** 情境池。参与者每次进入实验时，顺序在客户端随机后写入会话记录。 */
export const ALL_SCENARIO_IDS: ScenarioId[] = ['laptop', 'phone', 'course'];

/** 所有页面必须展示的模拟数据声明，文案统一从这里取，避免各页不一致。 */
export const SIMULATION_NOTICE =
  '以下账户、商品、价格和分期信息均为实验模拟，不代表真实报价或金融产品。';
