import type { BaselineAnswers } from '../lib/types';

/** 知情同意版本号。文案有任何实质改动都必须提升版本，并记录日期。 */
export const CONSENT_VERSION = 'v1.0';

/** 冻结版本号，写入每条会话记录，便于追溯正式实验使用的网页版本。 */
export const APP_VERSION = import.meta.env.VITE_APP_VERSION ?? '0.1.0-dev';

/** 知情同意要点。不提及 A/B 分组，不暗示研究假设。 */
export const CONSENT_POINTS = [
  '本页面中的账户余额、商品、价格和分期信息全部为实验模拟，不会发生任何真实交易。',
  '本实验不会收集你的姓名、手机号、身份证号、银行卡号或任何真实账户信息。',
  '我们只记录你在页面上的匿名选择、点击和用时，用于研究信息呈现方式对消费决策的影响。',
  '你将完成三个模拟购买情境，整个过程大约需要 8 到 12 分钟。',
  '参与完全自愿。你可以随时关闭页面退出，已提交的部分不会影响你的任何权益。',
  '如需在数据截止前撤回，请把你的匿名码发给项目负责人，我们会删除该匿名码对应的全部记录。',
];

/** 最小基线字段。选项文案与第一份问卷保持一致，便于后续对照。 */
export interface BaselineField {
  key: keyof BaselineAnswers;
  label: string;
  options: { value: string; label: string }[];
}

export const BASELINE_FIELDS: BaselineField[] = [
  {
    key: 'age_group',
    label: '你的年龄段',
    options: [
      { value: 'under_18', label: '18 岁以下' },
      { value: '18_22', label: '18 至 22 岁' },
      { value: '23_25', label: '23 至 25 岁' },
      { value: '26_30', label: '26 至 30 岁' },
      { value: 'over_30', label: '30 岁以上' },
    ],
  },
  {
    key: 'role_status',
    label: '你目前的身份',
    options: [
      { value: 'undergraduate', label: '本科生' },
      { value: 'postgraduate', label: '研究生' },
      { value: 'work_under_1y', label: '参加工作 1 年内' },
      { value: 'work_1_3y', label: '工作 1 至 3 年' },
      { value: 'other', label: '其他' },
    ],
  },
  {
    key: 'disposable_funds_band',
    label: '你每月可自由支配的金额大致是',
    options: [
      { value: 'lt_1000', label: '1000 元以下' },
      { value: '1000_2000', label: '1000 至 2000 元' },
      { value: '2000_3500', label: '2000 至 3500 元' },
      { value: '3500_5000', label: '3500 至 5000 元' },
      { value: 'gt_5000', label: '5000 元以上' },
    ],
  },
  {
    key: 'installment_experience',
    label: '你使用分期付款的经历',
    options: [
      { value: 'never', label: '从未使用过' },
      { value: '1_2_times', label: '用过 1 至 2 次' },
      { value: 'occasional', label: '偶尔使用' },
      { value: 'frequent', label: '经常使用' },
    ],
  },
  {
    key: 'recent_large_purchase',
    label: '过去 12 个月，你是否有过明显影响现金流的大额消费',
    options: [
      { value: 'true', label: '有' },
      { value: 'false', label: '没有' },
    ],
  },
];

export const EMPTY_BASELINE: BaselineAnswers = {
  age_group: '',
  role_status: '',
  disposable_funds_band: '',
  installment_experience: '',
  recent_large_purchase: null,
};
