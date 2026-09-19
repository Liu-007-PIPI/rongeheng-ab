/**
 * 参与者端流程冒烟测试。
 * 走一遍 同意 → 匿名码 → 基线 → 三个情境 → 完成页，并检查交接文档 9.1 中
 * 可以自动验证的几条：一码一人、每情境只提交一次、A/B 选项集合一致、完成页不透露分组。
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { CHOICE_LABELS, CHOICE_ORDER } from './lib/calc';
import { createBackend } from './lib/storage';

beforeEach(() => {
  localStorage.clear();
});

/** 走完同意页、匿名码页和基线页，停在第一个情境。 */
async function enterExperiment(code: string) {
  const user = userEvent.setup();
  render(<App />);

  await user.click(await screen.findByRole('checkbox'));
  await user.click(screen.getByRole('button', { name: '同意并继续' }));

  await user.type(await screen.findByLabelText('匿名码'), code);
  await user.click(screen.getByRole('button', { name: '开始' }));

  // 基线：每组选第一个选项
  const groups = await screen.findAllByRole('radiogroup');
  for (const group of groups) {
    await user.click(within(group).getAllByRole('radio')[0]);
  }
  await user.click(screen.getByRole('button', { name: '进入实验' }));
  await screen.findByRole('radiogroup', { name: '购买方式' });

  return user;
}

/** 在当前情境里选第 n 个选项并提交。 */
async function answerScenario(user: ReturnType<typeof userEvent.setup>, optionIndex: number) {
  const group = await screen.findByRole('radiogroup', { name: '购买方式' });
  const options = within(group).getAllByRole('radio');
  await user.click(options[optionIndex]);
  await user.click(screen.getByRole('button', { name: '提交这个情境的选择' }));
}

describe('参与者完整流程', () => {
  it('A 版：三个情境提交后到达完成页，且只生成一条参与者记录', async () => {
    const user = await enterExperiment('A001');

    for (let i = 0; i < 3; i += 1) {
      await answerScenario(user, 1); // 分期
    }

    await screen.findByText('已完成，谢谢你的参与');

    const data = await createBackend().dump();
    expect(data.participants).toHaveLength(1);
    expect(data.sessions).toHaveLength(1);
    expect(data.decisions).toHaveLength(3);
    expect(data.sessions[0].completion_status).toBe('completed');
    expect(new Set(data.decisions.map((d) => d.scenario_id)).size).toBe(3);
    expect(data.sessions[0].scenario_order).toHaveLength(3);
  });

  it('B 版同样能走通，并记录信息模块的查看情况', async () => {
    const user = await enterExperiment('B001');

    // 先展开资金情况，再展开分期详情，然后选分期提交
    await user.click(screen.getByRole('button', { name: '查看你的资金情况' }));
    const group = await screen.findByRole('radiogroup', { name: '购买方式' });
    const cards = within(group).getAllByRole('radio');
    await user.click(cards[1]);
    await user.click(screen.getAllByRole('button', { name: '查看详情' })[1]);
    await user.click(screen.getByRole('button', { name: '提交这个情境的选择' }));

    const data = await createBackend().dump();
    expect(data.decisions[0].viewed_cashflow).toBe(true);
    expect(data.decisions[0].viewed_total_cost).toBe(true);
    expect(data.participants[0].variant).toBe('B');
  });
});

describe('A/B 选项一致性', () => {
  it('两版都展示同样的 5 个选项和同样的顺序', async () => {
    const titles = async () => {
      const group = await screen.findByRole('radiogroup', { name: '购买方式' });
      return within(group)
        .getAllByRole('radio')
        .map((el) => el.textContent ?? '');
    };

    await enterExperiment('A002');
    const a = await titles();
    screen.getByText(/情境 1 \/ 3/);

    localStorage.clear();
    cleanup();

    await enterExperiment('B002');
    const b = await titles();

    expect(a).toHaveLength(CHOICE_ORDER.length);
    expect(b).toHaveLength(CHOICE_ORDER.length);
    CHOICE_ORDER.forEach((c, i) => {
      expect(a[i].startsWith(CHOICE_LABELS[c])).toBe(true);
      expect(b[i].startsWith(CHOICE_LABELS[c])).toBe(true);
    });
  });
});

describe('匿名码校验', () => {
  it('无效码给出提示且不进入实验', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: '同意并继续' }));
    await user.type(await screen.findByLabelText('匿名码'), 'ZZZ999');
    await user.click(screen.getByRole('button', { name: '开始' }));

    await screen.findByText(/无法使用/);
    expect(screen.queryByRole('radiogroup', { name: '购买方式' })).toBeNull();
  });

  it('已完成的码不能再次作答', async () => {
    const user = await enterExperiment('A003');
    for (let i = 0; i < 3; i += 1) await answerScenario(user, 4);
    await screen.findByText('已完成，谢谢你的参与');

    cleanup();
    const user2 = userEvent.setup();
    render(<App />);
    await user2.type(await screen.findByLabelText('匿名码'), 'A003');
    await user2.click(screen.getByRole('button', { name: '开始' }));
    await screen.findByText(/已经完成过实验/);
  });
});

describe('刷新恢复', () => {
  it('答完一个情境后重新挂载，回到第二个情境而不是从头开始', async () => {
    const user = await enterExperiment('A004');
    await answerScenario(user, 0);
    await screen.findByText(/情境 2 \/ 3/);

    cleanup();
    render(<App />);

    await waitFor(() => expect(screen.getByText(/情境 2 \/ 3/)).toBeTruthy());
    const data = await createBackend().dump();
    expect(data.participants).toHaveLength(1);
    expect(data.decisions).toHaveLength(1);
  });
});

describe('完成页不透露研究设计', () => {
  it('不出现分组、假设或对选择的评价', async () => {
    const user = await enterExperiment('B003');
    for (let i = 0; i < 3; i += 1) await answerScenario(user, 0); // 全款，三次都是高风险
    await screen.findByText('已完成，谢谢你的参与');

    const text = document.body.textContent ?? '';
    for (const banned of ['A 版', 'B 版', '对照组', '实验组', '假设', '正确', '冲动', '错误']) {
      expect(text.includes(banned)).toBe(false);
    }
  });
});

describe('选定后的结果摘要', () => {
  it('B 版选中后给出付款后剩余可用资金和年化利率', async () => {
    const user = await enterExperiment('B004');

    const group = await screen.findByRole('radiogroup', { name: '购买方式' });
    await user.click(within(group).getAllByRole('radio')[1]); // 分期

    // 选中即出现剩余可用资金，不需要展开
    await screen.findByText('付款后剩余可用资金');
    expect(screen.getByText('你当前的选择')).toBeTruthy();

    // 展开分期详情能看到折合年化利率，且是两位小数的百分数
    await user.click(screen.getAllByRole('button', { name: '查看详情' })[1]);
    const apr = await screen.findByText('折合年化利率');
    const value = apr.parentElement?.querySelector('dd')?.textContent ?? '';
    expect(value).toMatch(/^\d+\.\d{2}%$/);
  });

  it('A 版选中后只回显选择，不出现任何余额或利率', async () => {
    const user = await enterExperiment('A005');

    const group = await screen.findByRole('radiogroup', { name: '购买方式' });
    await user.click(within(group).getAllByRole('radio')[1]);
    await screen.findByText('你当前的选择');

    // 展开每一个选项的详情，A 版也不能出现 B 版独有的信息
    for (const btn of screen.getAllByRole('button', { name: '查看详情' })) {
      await user.click(btn);
    }

    const text = document.body.textContent ?? '';
    for (const banned of [
      '付款后剩余可用资金',
      '最低余额',
      '折合年化利率',
      '应急储备',
      '必要支出',
      '总支付',
    ]) {
      expect(text.includes(banned)).toBe(false);
    }
  });
});
