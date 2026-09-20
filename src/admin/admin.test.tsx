/**
 * 管理端流程测试，对应交接文档 9.3 里可以自动验证的几条：
 * 未登录看不到任何数据、总览与完成记录一致、默认只统计正式样本、
 * 表格只读没有编辑入口、撤回删除能清干净关联数据。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App';
import { createBackend } from '../lib/storage';
import type { DecisionRecord, ParticipantRecord, SessionRecord, Variant } from '../lib/types';

const PASSPHRASE = 'rongeheng-dev';

/** 直接往 localStorage 里塞数据，避免每次都点完整个参与者流程。 */
function seed(people: { label: string; variant: Variant; risky: boolean[] }[]) {
  const participants: ParticipantRecord[] = [];
  const sessions: SessionRecord[] = [];
  const decisions: DecisionRecord[] = [];
  const code_status: Record<string, 'started' | 'completed'> = {};
  const scenarios = ['laptop', 'phone', 'course'] as const;

  for (const { label, variant, risky } of people) {
    const pid = `p-${label}`;
    const sid = `s-${label}`;
    participants.push({
      participant_id: pid,
      access_code_label: label,
      variant,
      code_type: label.startsWith('PILOT') ? 'pilot' : 'formal',
      consent_version: 'v1.0',
      consent_at: '2026-09-20T02:00:00.000Z',
      created_at: '2026-09-20T02:00:00.000Z',
      baseline: {
        age_group: '18_22',
        role_status: 'undergraduate',
        disposable_funds_band: '1000_2000',
        installment_experience: 'never',
        recent_large_purchase: false,
      },
    });
    sessions.push({
      session_id: sid,
      participant_id: pid,
      variant,
      scenario_order: [...scenarios],
      started_at: '2026-09-20T02:00:00.000Z',
      completed_at: '2026-09-20T02:10:00.000Z',
      total_duration_ms: 600000,
      completion_status: 'completed',
      app_version: 'test',
    });
    risky.forEach((isRisky, i) => {
      decisions.push({
        decision_id: `d-${label}-${i}`,
        session_id: sid,
        participant_id: pid,
        scenario_id: scenarios[i],
        scenario_position: i + 1,
        final_choice: 'installment',
        selected_payment_path: 'installment',
        installment_term: 12,
        projected_min_balance: isRisky ? -100 : 2000,
        high_risk_choice: isRisky,
        viewed_cashflow: variant === 'B',
        viewed_total_cost: variant === 'B',
        clicked_lower_price: false,
        changed_choice: false,
        decision_time_ms: 12000,
        submitted_at: '2026-09-20T02:05:00.000Z',
      });
    });
    code_status[label] = 'completed';
  }

  localStorage.setItem(
    'rongeheng_ab_data_v1',
    JSON.stringify({ participants, sessions, decisions, events: [], withdrawals: [], code_status }),
  );
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  window.location.hash = '#/admin';
});

async function signInAdmin() {
  const user = userEvent.setup();
  render(<App />);
  await user.type(await screen.findByLabelText('管理员口令'), PASSPHRASE);
  await user.click(screen.getByRole('button', { name: '进入' }));
  await screen.findByRole('tab', { name: '总览' });
  return user;
}

describe('登录闸门', () => {
  it('未登录时看不到任何标签页或数据', async () => {
    seed([{ label: 'A001', variant: 'A', risky: [true, true, true] }]);
    render(<App />);

    await screen.findByLabelText('管理员口令');
    expect(screen.queryByRole('tab', { name: '总览' })).toBeNull();
    expect(screen.queryByText('A001')).toBeNull();
  });

  it('口令错误不放行', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.type(await screen.findByLabelText('管理员口令'), '错误口令');
    await user.click(screen.getByRole('button', { name: '进入' }));

    await screen.findByText('口令不正确。');
    expect(screen.queryByRole('tab', { name: '总览' })).toBeNull();
  });

  it('登录页明确说明这不是访问控制', async () => {
    render(<App />);
    await screen.findByLabelText('管理员口令');
    expect(screen.getByText(/这不是访问控制/)).toBeTruthy();
  });

  it('退出后重新挂载回到登录页，后退也看不到数据', async () => {
    seed([{ label: 'A001', variant: 'A', risky: [true, true, true] }]);
    const user = await signInAdmin();
    await user.click(screen.getByRole('button', { name: '退出' }));
    await screen.findByLabelText('管理员口令');

    cleanup();
    render(<App />);
    await screen.findByLabelText('管理员口令');
    expect(screen.queryByRole('tab', { name: '总览' })).toBeNull();
  });
});

describe('总览', () => {
  it('A/B 完成数与原始完成记录一致', async () => {
    seed([
      { label: 'A001', variant: 'A', risky: [true, true, true] },
      { label: 'A002', variant: 'A', risky: [true, false, false] },
      { label: 'B001', variant: 'B', risky: [false, false, false] },
    ]);
    await signInAdmin();

    const tile = screen.getByText('完成数 A / B').parentElement!;
    expect(within(tile).getByText('2 / 1')).toBeTruthy();
    expect(within(screen.getByText('已完成').parentElement!).getByText('3')).toBeTruthy();
  });
});

describe('主要指标', () => {
  it('默认只统计正式样本，预试不计入', async () => {
    seed([
      { label: 'A001', variant: 'A', risky: [true, true, true] },
      { label: 'PILOT01', variant: 'A', risky: [false, false, false] },
    ]);
    const user = await signInAdmin();
    await user.click(screen.getByRole('tab', { name: '主要指标' }));

    // 只有 A001 进入分析集 → A 组平均高风险比例 100%
    await screen.findByText(/1 人进入当前分析集/);
    const table = screen.getAllByRole('table')[0];
    const row = within(table).getByText('平均高风险比例').closest('tr')!;
    expect(within(row).getAllByRole('cell')[1].textContent).toBe('100.0%');
  });

  it('切到"全部"后预试也计入，平均值随之改变', async () => {
    seed([
      { label: 'A001', variant: 'A', risky: [true, true, true] },
      { label: 'PILOT01', variant: 'A', risky: [false, false, false] },
    ]);
    const user = await signInAdmin();
    await user.click(screen.getByRole('tab', { name: '主要指标' }));
    await user.click(screen.getByRole('radio', { name: '全部' }));

    await screen.findByText(/2 人进入当前分析集/);
    const table = screen.getAllByRole('table')[0];
    const row = within(table).getByText('平均高风险比例').closest('tr')!;
    expect(within(row).getAllByRole('cell')[1].textContent).toBe('50.0%');
  });

  it('没有数据时显示「—」而不是 0%', async () => {
    seed([{ label: 'A001', variant: 'A', risky: [true, true, true] }]);
    const user = await signInAdmin();
    await user.click(screen.getByRole('tab', { name: '主要指标' }));

    // B 组一个人都没有
    const table = screen.getAllByRole('table')[0];
    const row = within(table).getByText('平均高风险比例').closest('tr')!;
    expect(within(row).getAllByRole('cell')[2].textContent).toBe('—');
  });

  it('提示指标按参与者层面计算，并说明推断统计不在这里做', async () => {
    seed([{ label: 'A001', variant: 'A', risky: [true, true, true] }]);
    const user = await signInAdmin();
    await user.click(screen.getByRole('tab', { name: '主要指标' }));

    expect(screen.getByText(/参与者层面/)).toBeTruthy();
    expect(screen.getByText(/bootstrap 置信区间/)).toBeTruthy();
  });
});

describe('原始记录只读', () => {
  it('表格里没有任何输入框或编辑按钮', async () => {
    seed([{ label: 'A001', variant: 'A', risky: [true, false, true] }]);
    const user = await signInAdmin();
    await user.click(screen.getByRole('tab', { name: '原始记录' }));

    const table = await screen.findByRole('table');
    expect(within(table).queryAllByRole('textbox')).toHaveLength(0);
    expect(within(table).queryAllByRole('button')).toHaveLength(0);
    expect(within(table).queryAllByRole('combobox')).toHaveLength(0);
  });

  it('按情境筛选能缩小结果', async () => {
    seed([{ label: 'A001', variant: 'A', risky: [true, false, true] }]);
    const user = await signInAdmin();
    await user.click(screen.getByRole('tab', { name: '原始记录' }));

    await screen.findByText(/共 3 条决策/);
    await user.selectOptions(screen.getByLabelText('情境'), 'phone');
    await screen.findByText(/共 1 条决策/);
  });
});

describe('参与者明细', () => {
  it('只显示匿名码与匿名字段', async () => {
    seed([{ label: 'A001', variant: 'A', risky: [true, true, true] }]);
    const user = await signInAdmin();
    await user.click(screen.getByRole('tab', { name: '参与者明细' }));

    const table = await screen.findByRole('table');
    expect(within(table).getByText('A001')).toBeTruthy();
    for (const banned of ['姓名', '手机号', '身份证', '银行卡', 'IP']) {
      expect(table.textContent?.includes(banned)).toBe(false);
    }
  });
});

describe('撤回删除', () => {
  it('二次确认后清除该匿名码的全部关联记录', async () => {
    seed([
      { label: 'A001', variant: 'A', risky: [true, true, true] },
      { label: 'B001', variant: 'B', risky: [false, false, false] },
    ]);
    const user = await signInAdmin();
    await user.click(screen.getByRole('tab', { name: '导出与撤回' }));

    await user.type(screen.getByLabelText('要撤回的匿名码'), 'A001');
    await user.click(screen.getByRole('button', { name: '撤回这个匿名码' }));

    // 第一次点击只是进入确认态，还没删
    await screen.findByRole('button', { name: '确认删除' });
    let data = await createBackend().dump();
    expect(data.participants).toHaveLength(2);

    await user.click(screen.getByRole('button', { name: '确认删除' }));

    await waitFor(async () => {
      data = await createBackend().dump();
      expect(data.participants).toHaveLength(1);
    });
    expect(data.participants[0].access_code_label).toBe('B001');
    expect(data.sessions).toHaveLength(1);
    expect(data.decisions).toHaveLength(3); // 只剩 B001 的三条
    expect(data.code_status.A001).toBe('withdrawn');
    expect(data.withdrawals).toHaveLength(1);
  });

  it('撤回日志不保留任何实验答案', async () => {
    seed([{ label: 'A001', variant: 'A', risky: [true, true, true] }]);
    const user = await signInAdmin();
    await user.click(screen.getByRole('tab', { name: '导出与撤回' }));
    await user.type(screen.getByLabelText('要撤回的匿名码'), 'A001');
    await user.click(screen.getByRole('button', { name: '撤回这个匿名码' }));
    await user.click(await screen.findByRole('button', { name: '确认删除' }));

    await waitFor(async () => {
      const data = await createBackend().dump();
      expect(data.withdrawals).toHaveLength(1);
    });
    const log = (await createBackend().dump()).withdrawals[0];
    expect(Object.keys(log).sort()).toEqual(
      ['access_code_label', 'id', 'note', 'processed_at', 'processed_by', 'requested_at'].sort(),
    );
  });

  it('撤回后的参与者不再计入总览与指标', async () => {
    seed([
      { label: 'A001', variant: 'A', risky: [true, true, true] },
      { label: 'A002', variant: 'A', risky: [false, false, false] },
    ]);
    const user = await signInAdmin();
    await user.click(screen.getByRole('tab', { name: '导出与撤回' }));
    await user.type(screen.getByLabelText('要撤回的匿名码'), 'A001');
    await user.click(screen.getByRole('button', { name: '撤回这个匿名码' }));
    await user.click(await screen.findByRole('button', { name: '确认删除' }));

    await user.click(screen.getByRole('tab', { name: '总览' }));
    await waitFor(() => {
      const tile = screen.getByText('已完成').parentElement!;
      expect(within(tile).getByText('1')).toBeTruthy();
    });
  });
});

describe('参与者端不受影响', () => {
  it('hash 不是 #/admin 时仍然是参与者页面', async () => {
    window.location.hash = '';
    render(<App />);
    expect(await screen.findByRole('checkbox')).toBeTruthy();
    expect(screen.queryByLabelText('管理员口令')).toBeNull();
  });
});
