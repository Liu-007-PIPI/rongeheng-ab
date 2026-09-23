import type { BaselineAnswers } from '../lib/types';

/**
 * 知情同意版本号。文案有任何实质改动都必须提升版本，并记录日期。
 *
 * v1.1（2026-09-23）：全文改写为大白话。告知的事项一条没减也一条没加，
 * 只是把"实验模拟""识别""权益"这类词换成参与者一眼能懂的说法——
 * 看不懂的告知等于没有告知，所以这也是知情同意本身的要求，不只是可读性。
 */
export const CONSENT_VERSION = 'v1.1';

/** 冻结版本号，写入每条会话记录，便于追溯正式实验使用的网页版本。 */
export const APP_VERSION = import.meta.env.VITE_APP_VERSION ?? '0.1.0-dev';

/**
 * 轮次归属。按会话记录里的 app_version 前缀判定。
 *
 * 两轮的情境参数不同（第一轮没有月收入字段，风险结构也不一样），
 * 数据不可合并分析，但它们共用同一套表。后台把两轮混在一个列表里显示，
 * 很容易把"总人数"看成本轮进度，所以默认只看当前轮。
 *
 * 第一轮 = 0.4.x（含 0.4.0-dev），第二轮 = 0.5.x（0.5.0-round2）。
 * 更早的开发版本（0.1—0.3）归入 other，不属于任何一轮正式采集。
 */
export const ROUND_LABELS = {
  round1: '第一轮',
  round2: '第二轮（本轮）',
  other: '其他版本',
} as const;

export type RoundKey = keyof typeof ROUND_LABELS;

export function roundOfAppVersion(appVersion: string | null | undefined): RoundKey {
  const v = (appVersion ?? '').trim();
  if (v.startsWith('0.5.')) return 'round2';
  if (v.startsWith('0.4.')) return 'round1';
  return 'other';
}

/** 后台默认只展示这一轮。换轮时连同 APP_VERSION 一起改。 */
export const CURRENT_ROUND: RoundKey = 'round2';

/**
 * 是否要求参与者先输入预先发放的匿名码。
 *
 * false（默认，开放模式）：打开链接即可作答，不需要匿名码。
 *   分组由服务端按两组人数自动平衡分配，撤回码在完成后生成并展示给参与者。
 *   同一台设备可以连续作答多次——适合课堂上传递同一台手机、或链接公开投放的场景。
 *   代价是失去了"一码一人"这道去重保护，独立性只能靠招募方式和事后审计保证，
 *   详见预注册第 7 节与完成页的说明。
 *
 * true（定向模式）：沿用第一轮的一码一人，适合需要严格控制样本来源的场合。
 */
export const REQUIRE_ACCESS_CODE =
  (import.meta.env.VITE_REQUIRE_ACCESS_CODE ?? 'false').trim() === 'true';

/** 知情同意要点。不提及 A/B 分组，不暗示研究假设。 */
export const CONSENT_POINTS = [
  '页面上的钱、商品、价格和分期全是编出来的，不会真的买东西，也不会真的扣钱。',
  '我们不会问你的姓名、手机号、身份证号、银行卡号，也不会记这些。',
  '我们只记你在这个页面上选了什么、看了多久，用来研究"把信息怎么摆出来，会不会影响买东西的决定"。',
  '一共三道题，每道题都是一个"这东西要不要买"的场景，大概花你 8 到 12 分钟。',
  '参不参加都随你。做到一半不想做了，直接关掉页面就行，不会有任何影响。',
  REQUIRE_ACCESS_CODE
    ? '想反悔、不让我们用你的答案，把你的匿名码发给负责人，我们就把对应的记录全部删掉。'
    : '做完会给你一串"撤回码"。以后不想让我们用你这份答案了，把这串码发给负责人，我们就把对应的记录全部删掉。',
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
    label: '每个月能由你自己说了算的钱，大概有多少',
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
    label: '你用过分期付款吗',
    options: [
      { value: 'never', label: '从未使用过' },
      { value: '1_2_times', label: '用过 1 至 2 次' },
      { value: 'occasional', label: '偶尔使用' },
      { value: 'frequent', label: '经常使用' },
    ],
  },
  {
    key: 'recent_large_purchase',
    label: '最近一年，你有没有花过一笔钱，花完之后手头明显变紧',
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
