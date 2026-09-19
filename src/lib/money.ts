/** 金额工具。所有金额统一保留两位小数，界面按元展示。 */

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** 展示用格式：整数不带小数位，非整数保留两位。 */
export function formatMoney(value: number): string {
  const v = round2(value);
  const abs = Math.abs(v);
  const text = Number.isInteger(v)
    ? abs.toLocaleString('zh-CN')
    : abs.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${v < 0 ? '-' : ''}${text} 元`;
}
