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

/**
 * 在当前情境里选第 n 个选项并提交。
 * 第 2 个情境提交后会插入注意力检查页，这里顺带答掉，让流程能走到第 3 个情境。
 */
async function answerScenario(
  user: ReturnType<typeof userEvent.setup>,
  optionIndex: number,
  attention: 'pass' | 'fail' = 'pass',
) {
  const group = await screen.findByRole('radiogroup', { name: '购买方式' });
  const options = within(group).getAllByRole('radio');
  await user.click(options[optionIndex]);
  await user.click(screen.getByRole('button', { name: '就这么选，下一题' }));
  await maybeAnswerAttentionCheck(user, attention);
}

/** 若当前停在注意力检查页就答掉；不在该页则什么都不做。 */
async function maybeAnswerAttentionCheck(
  user: ReturnType<typeof userEvent.setup>,
  outcome: 'pass' | 'fail' = 'pass',
) {
  const heading = screen.queryByText('一道小题');
  if (!heading) return;
  const group = await screen.findByRole('radiogroup', { name: '注意力检查' });
  // 选项顺序为 红 / 蓝 / 绿 / 黄，正确答案是"绿色"
  const index = outcome === 'pass' ? 2 : 0;
  await user.click(within(group).getAllByRole('radio')[index]);
  await user.click(screen.getByRole('button', { name: '继续' }));
  await screen.findByRole('radiogroup', { name: '购买方式' });
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

  it('B 版同样能走通，并记录两套风险口径', async () => {
    const user = await enterExperiment('B001');

    // 第二轮没有任何折叠层：资金情况与选项信息都已默认展开，直接选分期提交
    expect(screen.queryByRole('button', { name: '查看你的资金情况' })).toBeNull();
    expect(screen.queryByRole('button', { name: '查看详情' })).toBeNull();

    const group = await screen.findByRole('radiogroup', { name: '购买方式' });
    const cards = within(group).getAllByRole('radio');
    await user.click(cards[1]);
    await user.click(screen.getByRole('button', { name: '就这么选，下一题' }));

    const data = await createBackend().dump();
    // 两套口径都要落库，第二轮的主要判定是 high_risk_term
    expect(typeof data.decisions[0].high_risk_choice).toBe('boolean');
    expect(typeof data.decisions[0].high_risk_term).toBe('boolean');
    expect(typeof data.decisions[0].worst_balance_term).toBe('number');
    // jsdom 没有 IntersectionObserver，曝光只会低估不会虚报
    expect(data.decisions[0].key_info_exposed).toBe(false);
    expect(data.participants[0].variant).toBe('B');
  });
});

describe('注意力检查', () => {
  it('插在第 2 个情境之后，答完继续第 3 个情境', async () => {
    const user = await enterExperiment('A010');

    await answerScenario(user, 1);
    expect(screen.queryByText('一道小题')).toBeNull(); // 第 1 个情境后不出现

    // 第 2 个情境提交后应停在注意力检查页
    const group = await screen.findByRole('radiogroup', { name: '购买方式' });
    await user.click(within(group).getAllByRole('radio')[1]);
    await user.click(screen.getByRole('button', { name: '就这么选，下一题' }));
    expect(await screen.findByText('一道小题')).toBeTruthy();

    await maybeAnswerAttentionCheck(user, 'pass');
    screen.getByText(/第 3 题 \/ 共 3 题/);

    const data = await createBackend().dump();
    expect(data.participants[0].attention_check_passed).toBe(true);
  });

  it('答错照常继续，不当场拦人', async () => {
    const user = await enterExperiment('A011');
    await answerScenario(user, 1);
    await answerScenario(user, 1, 'fail');

    // 未通过也进入第 3 个情境：当场拦下会让参与者知道自己答错，从而改变后续行为。
    // 排除发生在分析阶段，按预注册的规则执行。
    screen.getByText(/第 3 题 \/ 共 3 题/);
    const data = await createBackend().dump();
    expect(data.participants[0].attention_check_passed).toBe(false);
  });

  it('题目内容与实验主题无关，不提示应该关注什么', async () => {
    const user = await enterExperiment('A012');
    await answerScenario(user, 1);
    const group = await screen.findByRole('radiogroup', { name: '购买方式' });
    await user.click(within(group).getAllByRole('radio')[1]);
    await user.click(screen.getByRole('button', { name: '就这么选，下一题' }));
    await screen.findByText('一道小题');

    // 只看题目本身，不算页面顶部那条全局的模拟数据声明横幅
    const question = screen.getByRole('group').textContent ?? '';
    // 词表随界面文案一起改成口语版，守的仍是同一条线：题干不得出现实验主题的任何词
    for (const leak of ['余额', '分期', '应急', '利息', '掏', '剩', '风险']) {
      expect(question.includes(leak)).toBe(false);
    }
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
    screen.getByText(/第 1 题 \/ 共 3 题/);

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
    await screen.findByText(/第 2 题 \/ 共 3 题/);

    cleanup();
    render(<App />);

    await waitFor(() => expect(screen.getByText(/第 2 题 \/ 共 3 题/)).toBeTruthy());
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
  it('B 版选中后给出完整还款期最低余额与年化利率，且无需任何点击', async () => {
    const user = await enterExperiment('B004');

    const group = await screen.findByRole('radiogroup', { name: '购买方式' });
    await user.click(within(group).getAllByRole('radio')[1]); // 分期

    const summary = await screen.findByRole('region', { name: '你这样选的话' });
    expect(within(summary).getByText('你选的是')).toBeTruthy();
    expect(within(summary).getByText('以后手上还剩多少钱')).toBeTruthy();
    expect(within(summary).getByText(/接下来 \d+ 个月里，手上最少的时候只剩/)).toBeTruthy();
    expect(within(summary).getByText('最紧的是哪个月')).toBeTruthy();

    // 折合年化利率直接可见，不需要展开任何东西，且是两位小数的百分数
    const apr = within(summary).getByText('这样分期，相当于一年的利息是');
    expect(apr.nextElementSibling?.textContent ?? '').toMatch(/^\d+\.\d{2}%$/);
  });

  /**
   * 第二轮的 A/B 隔离线与第一轮不同，这里同时守两个方向：
   *   事实（页面上已有数字做一次加减法就能得出）——两版都必须有；
   *   分析（需要建模或解方程）——只有 B 版能有。
   * 第一轮 A 版连"12 期一共还多少"都看不到，会让组间差异分不清是呈现方式有效还是对照组被蒙住眼。
   */
  it('A 版能看到全部事实，但看不到任何需要建模的分析结果', async () => {
    const user = await enterExperiment('A005');

    const group = await screen.findByRole('radiogroup', { name: '购买方式' });
    await user.click(within(group).getAllByRole('radio')[1]); // 分期
    await screen.findByText('你选的是');

    const text = document.body.textContent ?? '';

    // 事实：A 版必须能看到
    for (const shown of [
      '前前后后一共掏',
      '比标价多掏',
      '所以每月能剩下',
      '每月到手',
      '手上至少要留住',
    ]) {
      expect(text.includes(shown)).toBe(true);
    }

    // 分析：A 版一律不得出现
    for (const banned of [
      '以后手上还剩多少钱',
      '相当于一年的利息是',
      '手上最少', // 覆盖摘要区的"手上最少的时候只剩"和选项里的"手上最少时只剩"
      '最紧的是哪个月',
      '够应急',
    ]) {
      expect(text.includes(banned)).toBe(false);
    }
  });

  it('两版的事实口径完全一致，只有分析区块有差异', async () => {
    const factLabels = ['前前后后一共掏', '比标价多掏', '所以每月能剩下'];

    await enterExperiment('A006');
    const aText = document.body.textContent ?? '';
    localStorage.clear();
    cleanup();

    await enterExperiment('B006');
    const bText = document.body.textContent ?? '';

    for (const label of factLabels) {
      expect(aText.includes(label)).toBe(bText.includes(label));
    }
  });
});
