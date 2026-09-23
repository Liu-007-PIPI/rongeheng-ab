/**
 * 开放模式（生产默认）的行为。
 *
 * 与定向模式的区别：
 *   - 不需要预先发放的匿名码，同意之后直接进基线
 *   - 分组由后端按两组人数平衡分配
 *   - 撤回码在完成后自动生成并展示给参与者
 *   - 同一台设备可以连续作答多份
 *
 * 本文件用 vi.stubEnv + 动态 import 拿到一份 REQUIRE_ACCESS_CODE=false 的模块实例；
 * 其余测试文件仍按 vitest.config.ts 里的定向模式跑。
 */
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.stubEnv('VITE_REQUIRE_ACCESS_CODE', 'false');

const { default: App } = await import('./App');
const { createBackend } = await import('./lib/storage');
const { REQUIRE_ACCESS_CODE } = await import('./config/experiment');

beforeEach(() => {
  localStorage.clear();
});

/** 同意 → 基线 → 停在第一个情境。开放模式下中间没有匿名码这一步。 */
async function enterOpen() {
  const user = userEvent.setup();
  render(<App />);

  // 同意过的浏览器不再弹同意页，直接落在基线
  const consent = await screen.findByRole('button', { name: /同意并继续|进入实验/ });
  if (consent.textContent?.includes('同意')) {
    await user.click(screen.getByRole('checkbox'));
    await user.click(consent);
  }

  // 基线：每组选第一个选项
  const groups = await screen.findAllByRole('radiogroup');
  for (const group of groups) {
    await user.click(within(group).getAllByRole('radio')[0]);
  }
  await user.click(screen.getByRole('button', { name: '进入实验' }));
  await screen.findByRole('radiogroup', { name: '购买方式' });
  return user;
}

/** 答完一个情境；若落在注意力检查页就顺手答掉。 */
async function answer(user: ReturnType<typeof userEvent.setup>, optionIndex = 1) {
  const group = await screen.findByRole('radiogroup', { name: '购买方式' });
  await user.click(within(group).getAllByRole('radio')[optionIndex]);
  await user.click(screen.getByRole('button', { name: '就这么选，下一题' }));

  if (screen.queryByText('一道小题')) {
    const g = await screen.findByRole('radiogroup', { name: '注意力检查' });
    await user.click(within(g).getAllByRole('radio')[2]); // 绿色
    await user.click(screen.getByRole('button', { name: '继续' }));
    await screen.findByRole('radiogroup', { name: '购买方式' });
  }
}

async function finishOnce(optionIndex = 1) {
  const user = await enterOpen();
  for (let i = 0; i < 3; i += 1) await answer(user, optionIndex);
  await screen.findByText('已完成，谢谢你的参与');
  return user;
}

describe('开放模式：不需要匿名码', () => {
  it('配置确实处于开放模式', () => {
    expect(REQUIRE_ACCESS_CODE).toBe(false);
  });

  it('同意之后直接进基线，不出现匿名码输入框', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: '同意并继续' }));

    await screen.findByRole('button', { name: '进入实验' });
    expect(screen.queryByLabelText('匿名码')).toBeNull();
    expect(screen.queryByRole('button', { name: '开始' })).toBeNull();
  });

  it('能走完三个情境并生成一条参与者记录', async () => {
    await finishOnce();
    const data = await createBackend().dump();
    expect(data.participants).toHaveLength(1);
    expect(data.decisions).toHaveLength(3);
    expect(data.sessions[0].completion_status).toBe('completed');
  });

  it('自动生成撤回码并在完成页展示', async () => {
    await finishOnce();
    const shown = screen.getByLabelText('撤回码').textContent?.trim() ?? '';
    // 形如 R-7K2M9Q，字符集里没有 0/O/1/I/L
    expect(shown).toMatch(/^R-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/);

    const data = await createBackend().dump();
    expect(data.participants[0].access_code_label).toBe(shown);
  });
});

describe('开放模式：同一台设备可以作答多份', () => {
  it('点"再填一份"之后能提交第二份，且不覆盖第一份', async () => {
    const user = await finishOnce(1); // 第一份：分期
    const first = (await createBackend().dump()).participants[0].access_code_label;

    await user.click(screen.getByRole('button', { name: '换一个人，再填一份' }));

    // 同意页不再出现（已经同意过），直接回到基线
    const groups = await screen.findAllByRole('radiogroup');
    for (const g of groups) await user.click(within(g).getAllByRole('radio')[0]);
    await user.click(screen.getByRole('button', { name: '进入实验' }));
    await screen.findByRole('radiogroup', { name: '购买方式' });
    for (let i = 0; i < 3; i += 1) await answer(user, 4); // 第二份：暂不购买
    await screen.findByText('已完成，谢谢你的参与');

    const data = await createBackend().dump();
    expect(data.participants).toHaveLength(2);
    expect(data.sessions).toHaveLength(2);
    expect(data.decisions).toHaveLength(6);

    // 两份的撤回码不同，第一份仍在
    const labels = data.participants.map((p) => p.access_code_label);
    expect(new Set(labels).size).toBe(2);
    expect(labels).toContain(first);

    // 两份的选择确实不同，说明第二份不是第一份的副本
    const choices = new Set(data.decisions.map((d) => d.final_choice));
    expect(choices.size).toBeGreaterThan(1);
  });

  it('记录这台浏览器提交的第几份，供数据质量审计', async () => {
    const user = await finishOnce();
    await user.click(screen.getByRole('button', { name: '换一个人，再填一份' }));
    const groups = await screen.findAllByRole('radiogroup');
    for (const g of groups) await user.click(within(g).getAllByRole('radio')[0]);
    await user.click(screen.getByRole('button', { name: '进入实验' }));
    await screen.findByRole('radiogroup', { name: '购买方式' });

    const data = await createBackend().dump();
    const seqs = data.sessions.map((s) => s.browser_submission_seq).sort();
    expect(seqs).toEqual([1, 2]);
  });
});

describe('开放模式：分组平衡', () => {
  it('连续多份作答时 A/B 人数差不超过 1', async () => {
    for (let n = 0; n < 6; n += 1) {
      const user = await finishOnce();
      await user.click(screen.getByRole('button', { name: '换一个人，再填一份' }));
      cleanup();
    }
    const data = await createBackend().dump();
    const a = data.participants.filter((p) => p.variant === 'A').length;
    const b = data.participants.filter((p) => p.variant === 'B').length;
    expect(a + b).toBe(6);
    // 按人数少的一组优先补，任何时点两组差值都不会超过 1
    expect(Math.abs(a - b)).toBeLessThanOrEqual(1);
  }, 60000);
});
