/**
 * CSV 导出。对应交接文档 8.6 与 9.2：
 *
 * - 四张核心表 participants / experiment_sessions / decisions / events 字段名固定，
 *   导出后可通过 participant_id 与 session_id 互相关联；
 * - UTF-8 带 BOM，Excel 直接双击打开中文不乱码；
 * - 时间统一 ISO 8601 UTC，界面上才显示本地时间；
 * - 布尔统一 TRUE / FALSE；
 * - 缺失值导出为空字符串，**不写 0**，避免把"没有数据"和"数值是 0"混为一谈。
 */
import type { StoredData } from './storage';

export type CsvCell = string | number | boolean | null | undefined;

/** RFC 4180 转义：含逗号、引号、换行时加引号，内部引号翻倍。 */
export function escapeCell(value: CsvCell): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  const text = String(value);
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function toCsv(headers: string[], rows: CsvCell[][]): string {
  const lines = [headers.join(','), ...rows.map((r) => r.map(escapeCell).join(','))];
  // 用 CRLF，Excel 与 pandas 都能正确解析
  return lines.join('\r\n');
}

/** UTF-8 BOM，缺了它 Excel 会把中文按本地代码页解码成乱码。 */
export const BOM = '﻿';

export interface CsvTable {
  name: string;
  headers: string[];
  rows: CsvCell[][];
}

/** 时间统一导出为 UTC ISO 8601。 */
function iso(value: string | null | undefined): string {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

export function buildTables(data: StoredData): CsvTable[] {
  const codeStatus = (label: string) => data.code_status[label] ?? 'unused';

  const participants: CsvTable = {
    name: 'participants',
    headers: [
      'participant_id',
      'access_code_label',
      'variant',
      'code_type',
      'code_status',
      'age_group',
      'role_status',
      'disposable_funds_band',
      'installment_experience',
      'recent_large_purchase',
      'consent_version',
      'consent_at',
      'created_at',
    ],
    rows: data.participants.map((p) => [
      p.participant_id,
      p.access_code_label,
      p.variant,
      p.code_type,
      codeStatus(p.access_code_label),
      p.baseline.age_group,
      p.baseline.role_status,
      p.baseline.disposable_funds_band,
      p.baseline.installment_experience,
      p.baseline.recent_large_purchase, // null 会导出为空字符串，不是 FALSE
      p.consent_version,
      iso(p.consent_at),
      iso(p.created_at),
    ]),
  };

  const sessions: CsvTable = {
    name: 'experiment_sessions',
    headers: [
      'session_id',
      'participant_id',
      'variant',
      'scenario_order',
      'started_at',
      'completed_at',
      'total_duration_ms',
      'completion_status',
      'app_version',
    ],
    rows: data.sessions.map((s) => [
      s.session_id,
      s.participant_id,
      s.variant,
      s.scenario_order.join('|'), // 用竖线分隔，避免与 CSV 逗号冲突
      iso(s.started_at),
      iso(s.completed_at),
      s.total_duration_ms, // 未完成时为 null → 空字符串
      s.completion_status,
      s.app_version,
    ]),
  };

  const decisions: CsvTable = {
    name: 'decisions',
    headers: [
      'decision_id',
      'session_id',
      'participant_id',
      'scenario_id',
      'scenario_position',
      'final_choice',
      'selected_payment_path',
      'installment_term',
      'projected_min_balance',
      'high_risk_choice',
      'viewed_cashflow',
      'viewed_total_cost',
      'clicked_lower_price',
      'changed_choice',
      'decision_time_ms',
      'submitted_at',
    ],
    rows: data.decisions.map((d) => [
      d.decision_id,
      d.session_id,
      d.participant_id,
      d.scenario_id,
      d.scenario_position,
      d.final_choice,
      d.selected_payment_path,
      d.installment_term,
      d.projected_min_balance,
      d.high_risk_choice,
      d.viewed_cashflow,
      d.viewed_total_cost,
      d.clicked_lower_price,
      d.changed_choice,
      d.decision_time_ms,
      iso(d.submitted_at),
    ]),
  };

  const events: CsvTable = {
    name: 'events',
    headers: [
      'event_id',
      'session_id',
      'participant_id',
      'scenario_id',
      'event_name',
      'event_ts',
      'metadata_json',
    ],
    rows: data.events.map((e) => [
      e.event_id,
      e.session_id,
      e.participant_id,
      e.scenario_id,
      e.event_name,
      iso(e.event_ts),
      JSON.stringify(e.metadata),
    ]),
  };

  const withdrawals: CsvTable = {
    name: 'withdrawal_log',
    headers: ['id', 'access_code_label', 'requested_at', 'processed_at', 'processed_by', 'note'],
    rows: data.withdrawals.map((w) => [
      w.id,
      w.access_code_label,
      iso(w.requested_at),
      iso(w.processed_at),
      w.processed_by,
      w.note,
    ]),
  };

  return [participants, sessions, decisions, events, withdrawals];
}

export function renderTable(table: CsvTable): string {
  return BOM + toCsv(table.headers, table.rows);
}

/** 在浏览器里触发一次下载。文件名带日期，便于按交接文档 15 记录导出批次。 */
export function downloadCsv(table: CsvTable, stamp = new Date()): string {
  const date = stamp.toISOString().slice(0, 10);
  const filename = `rongeheng_${table.name}_${date}.csv`;
  const blob = new Blob([renderTable(table)], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return filename;
}
