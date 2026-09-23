import type { CodeType, Variant } from '../lib/types';

/**
 * 一次性匿名码登记表。
 *
 * 当前阶段（参与者端）尚未接入 Supabase，因此这张表在前端充当 access_codes 表的替身：
 * 页面通过**查表**得到分组，不解析编号字符串，接入数据库后只需把 lookupCode 换成
 * 后端安全函数，页面逻辑不用改。
 *
 * 分组含义不向参与者展示。字母只是编号，参与者界面任何位置都不出现 A 版 / B 版字样。
 * 正式码在分发前应打乱顺序，按招募先后依次发放，避免研究人员主观挑选分组。
 */
export interface AccessCodeRow {
  code_label: string;
  assigned_variant: Variant;
  code_type: CodeType;
}

function buildRows(
  prefix: string,
  numbers: number[],
  variant: Variant,
  code_type: CodeType,
  pad: number,
): AccessCodeRow[] {
  return numbers.map((n) => ({
    code_label: `${prefix}${String(n).padStart(pad, '0')}`,
    assigned_variant: variant,
    code_type,
  }));
}

const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i);

/** 预试 10 个：PILOT01–PILOT10，A/B 各 5 个，数据不进入正式效果估计。 */
const PILOT_ROWS: AccessCodeRow[] = [
  ...buildRows('PILOT', range(1, 5), 'A', 'pilot', 2),
  ...buildRows('PILOT', range(6, 10), 'B', 'pilot', 2),
];

/**
 * 正式 160 个：A001–A080 与 B001–B080。
 *
 * 第二轮目标完成量 80—120 人。第一轮 50 个码换来 38 人完成（76%），
 * 按同样的完成率，120 人需要约 158 个码，故两组各备 80 个。
 * 备得多不会影响分析——未启用的码不进入任何分母，第一轮 12 个未启用码即如此处理。
 */
const FORMAL_ROWS: AccessCodeRow[] = [
  ...buildRows('A', range(1, 80), 'A', 'formal', 3),
  ...buildRows('B', range(1, 80), 'B', 'formal', 3),
];

export const ACCESS_CODES: AccessCodeRow[] = [...PILOT_ROWS, ...FORMAL_ROWS];

const CODE_INDEX = new Map(ACCESS_CODES.map((row) => [row.code_label.toUpperCase(), row]));

export function lookupCode(input: string): AccessCodeRow | null {
  return CODE_INDEX.get(input.trim().toUpperCase()) ?? null;
}
