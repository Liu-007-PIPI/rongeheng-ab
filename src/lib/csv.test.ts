/**
 * CSV 导出测试，对应交接文档 9.2 / 9.3 的几条验收：
 * UTF-8 中文不乱码、布尔格式一致、缺失值不被误算为 0、四张表能互相关联。
 */
import { describe, expect, it } from 'vitest';
import { BOM, buildTables, escapeCell, renderTable, toCsv } from './csv';
import type { StoredData } from './storage';

const SAMPLE: StoredData = {
  participants: [
    {
      participant_id: 'p1',
      access_code_label: 'A001',
      variant: 'A',
      code_type: 'formal',
      consent_version: 'v1.0',
      consent_at: '2026-09-20T02:00:00.000Z',
      created_at: '2026-09-20T02:00:00.000Z',
      attention_check_passed: true,
      baseline: {
        age_group: '18_22',
        role_status: 'undergraduate',
        disposable_funds_band: '1000_2000',
        installment_experience: 'never',
        // 故意留空：导出应为空字符串，而不是 FALSE
        recent_large_purchase: null,
      },
    },
  ],
  sessions: [
    {
      session_id: 's1',
      participant_id: 'p1',
      variant: 'A',
      scenario_order: ['phone', 'laptop', 'course'],
      started_at: '2026-09-20T02:00:00.000Z',
      completed_at: null, // 未完成：耗时应为空，不是 0
      total_duration_ms: null,
      completion_status: 'in_progress',
      app_version: '0.2.0-dev',
      browser_submission_seq: 1,
    },
  ],
  decisions: [
    {
      decision_id: 'd1',
      session_id: 's1',
      participant_id: 'p1',
      scenario_id: 'phone',
      scenario_position: 1,
      final_choice: 'installment',
      selected_payment_path: 'installment',
      installment_term: 12,
      projected_min_balance: 2933,
      high_risk_choice: false,
      worst_balance_term: 0,
      high_risk_term: false,
      key_info_exposed: false,
      key_info_exposed_ms: 0,
      changed_choice: false,
      decision_time_ms: 18400,
      submitted_at: '2026-09-20T02:03:00.000Z',
    },
  ],
  events: [
    {
      event_id: 'e1',
      session_id: 's1',
      participant_id: 'p1',
      scenario_id: 'phone',
      event_name: 'select_option',
      event_ts: '2026-09-20T02:02:00.000Z',
      metadata: { option: 'installment', path: 'installment' },
    },
  ],
  withdrawals: [],
  code_status: { A001: 'started' },
};

describe('单元格转义', () => {
  it('布尔统一为 TRUE / FALSE', () => {
    expect(escapeCell(true)).toBe('TRUE');
    expect(escapeCell(false)).toBe('FALSE');
  });

  it('null 与 undefined 导出为空字符串，不是 0 也不是 FALSE', () => {
    expect(escapeCell(null)).toBe('');
    expect(escapeCell(undefined)).toBe('');
    expect(escapeCell(0)).toBe('0'); // 真的是 0 时照常输出
  });

  it('含逗号、引号、换行的值会被正确包裹', () => {
    expect(escapeCell('同需求上一代机型, 16G')).toBe('"同需求上一代机型, 16G"');
    expect(escapeCell('他说"好"')).toBe('"他说""好"""');
    expect(escapeCell('第一行\n第二行')).toBe('"第一行\n第二行"');
  });
});

describe('表结构', () => {
  const tables = buildTables(SAMPLE);
  const byName = Object.fromEntries(tables.map((t) => [t.name, t]));

  it('导出交接文档要求的四张核心表', () => {
    for (const name of ['participants', 'experiment_sessions', 'decisions', 'events']) {
      expect(byName[name]).toBeDefined();
    }
  });

  it('四张表可通过 participant_id 与 session_id 关联', () => {
    for (const name of ['participants', 'experiment_sessions', 'decisions', 'events']) {
      expect(byName[name].headers).toContain('participant_id');
    }
    for (const name of ['experiment_sessions', 'decisions', 'events']) {
      expect(byName[name].headers).toContain('session_id');
    }
  });

  it('每行列数与表头一致', () => {
    for (const t of tables) {
      for (const row of t.rows) {
        expect(row).toHaveLength(t.headers.length);
      }
    }
  });
});

describe('缺失值与未完成状态', () => {
  const csv = renderTable(buildTables(SAMPLE).find((t) => t.name === 'experiment_sessions')!);
  const cells = csv.replace(BOM, '').split('\r\n')[1].split(',');
  const headers = csv.replace(BOM, '').split('\r\n')[0].split(',');

  it('未完成会话的完成时间与总耗时为空，不是 0', () => {
    expect(cells[headers.indexOf('completed_at')]).toBe('');
    expect(cells[headers.indexOf('total_duration_ms')]).toBe('');
  });

  it('完成状态字段明确写出 in_progress', () => {
    expect(cells[headers.indexOf('completion_status')]).toBe('in_progress');
  });

  it('基线里没作答的布尔字段导出为空，不是 FALSE', () => {
    const p = renderTable(buildTables(SAMPLE).find((t) => t.name === 'participants')!);
    const ph = p.replace(BOM, '').split('\r\n')[0].split(',');
    const pc = p.replace(BOM, '').split('\r\n')[1].split(',');
    expect(pc[ph.indexOf('recent_large_purchase')]).toBe('');
  });
});

describe('编码与格式', () => {
  it('带 UTF-8 BOM，Excel 打开中文不乱码', () => {
    const csv = renderTable(buildTables(SAMPLE)[0]);
    expect(csv.startsWith('﻿')).toBe(true);
  });

  it('时间统一为 UTC ISO 8601', () => {
    const csv = renderTable(buildTables(SAMPLE).find((t) => t.name === 'decisions')!);
    expect(csv).toContain('2026-09-20T02:03:00.000Z');
  });

  it('情境顺序用竖线分隔，不会撞上 CSV 的逗号', () => {
    const csv = renderTable(buildTables(SAMPLE).find((t) => t.name === 'experiment_sessions')!);
    expect(csv).toContain('phone|laptop|course');
  });

  it('使用 CRLF 换行', () => {
    expect(toCsv(['a', 'b'], [[1, 2]])).toBe('a,b\r\n1,2');
  });
});
