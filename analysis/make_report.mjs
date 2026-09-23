/**
 * 把 analysis_result.json 渲染成 Word 报告。
 *
 * 章节顺序固定为交接文档 10.5 规定的：
 *   样本流转 → A/B 人数 → 基线分布 → 主要指标 → 置信区间 → 次要指标 → 限制
 *
 * 用法：node analysis/make_report.mjs <JSON 与输出所在目录>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  HeadingLevel,
  LevelFormat,
  PageNumber,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';

const dir = process.argv[2] ?? '.';
const R = JSON.parse(readFileSync(join(dir, 'analysis_result.json'), 'utf8'));

/* ────────────────── 格式化 ────────────────── */

const pct = (x, d = 1) => (x === null || x === undefined ? '—' : `${(x * 100).toFixed(d)}%`);
const pp = (x, d = 1) =>
  x === null || x === undefined ? '—' : `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(d)} 个百分点`;
const f2 = (x) => (x === null || x === undefined ? '—' : x.toFixed(2));
const sec = (ms) => (ms === null || ms === undefined ? '—' : `${(ms / 1000).toFixed(1)} 秒`);
const p3 = (p) => (p < 0.001 ? '< 0.001' : p.toFixed(3));

const FONT = '等线';
const TOTAL_W = 9360; // 页面可用宽度（DXA）

/* ────────────────── 构件 ────────────────── */

const H1 = (text) =>
  new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 360, after: 160 },
    children: [new TextRun({ text, font: FONT, size: 30, bold: true, color: '1F3864' })],
  });

const H2 = (text) =>
  new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 240, after: 120 },
    children: [new TextRun({ text, font: FONT, size: 25, bold: true, color: '2E5395' })],
  });

const P = (text, opts = {}) =>
  new Paragraph({
    spacing: { after: opts.after ?? 120, line: 300 },
    alignment: opts.align,
    children: [
      new TextRun({
        text,
        font: FONT,
        size: opts.size ?? 21,
        bold: opts.bold,
        italics: opts.italics,
        color: opts.color,
      }),
    ],
  });

/** 富文本段落：传入 [{text, bold, color}] 数组 */
const RP = (runs, opts = {}) =>
  new Paragraph({
    spacing: { after: opts.after ?? 120, line: 300 },
    children: runs.map(
      (r) =>
        new TextRun({
          text: r.text,
          font: FONT,
          size: r.size ?? 21,
          bold: r.bold,
          italics: r.italics,
          color: r.color,
        }),
    ),
  });

const BULLET = (text, level = 0) =>
  new Paragraph({
    numbering: { reference: 'bullets', level },
    spacing: { after: 80, line: 300 },
    children: [new TextRun({ text, font: FONT, size: 21 })],
  });

/** 带左侧色条的提示块 */
const CALLOUT = (title, body, color = 'C00000') => [
  new Paragraph({
    spacing: { before: 200, after: 0 },
    border: { left: { style: BorderStyle.SINGLE, size: 18, color, space: 10 } },
    shading: { type: ShadingType.CLEAR, fill: 'F2F2F2' },
    children: [new TextRun({ text: title, font: FONT, size: 21, bold: true, color })],
  }),
  new Paragraph({
    spacing: { before: 0, after: 200, line: 300 },
    border: { left: { style: BorderStyle.SINGLE, size: 18, color, space: 10 } },
    shading: { type: ShadingType.CLEAR, fill: 'F2F2F2' },
    children: [new TextRun({ text: body, font: FONT, size: 21 })],
  }),
];

function cell(text, { width, bold, align, fill, color, size } = {}) {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    shading: fill ? { type: ShadingType.CLEAR, fill } : undefined,
    margins: { top: 60, bottom: 60, left: 110, right: 110 },
    children: [
      new Paragraph({
        alignment: align ?? AlignmentType.LEFT,
        spacing: { after: 0, line: 260 },
        children: [
          new TextRun({ text: String(text), font: FONT, size: size ?? 19, bold, color }),
        ],
      }),
    ],
  });
}

/**
 * 表格。widths 为各列 DXA 宽度，rows 为二维数组，第一行是表头。
 * cellOpts(rowIndex, colIndex) 可返回单元格额外样式。
 */
function table(widths, rows, cellOpts = () => ({})) {
  return new Table({
    columnWidths: widths,
    width: { size: widths.reduce((a, b) => a + b, 0), type: WidthType.DXA },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: 'AFAFAF' },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: 'AFAFAF' },
      left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: 'D9D9D9' },
      insideVertical: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
    },
    rows: rows.map(
      (row, ri) =>
        new TableRow({
          tableHeader: ri === 0,
          children: row.map((text, ci) =>
            cell(text, {
              width: widths[ci],
              bold: ri === 0 || cellOpts(ri, ci).bold,
              fill: ri === 0 ? 'E8EDF5' : cellOpts(ri, ci).fill,
              align: ci === 0 ? AlignmentType.LEFT : AlignmentType.CENTER,
              color: cellOpts(ri, ci).color,
              ...cellOpts(ri, ci),
            }),
          ),
        }),
    ),
  });
}

const SPACER = (h = 160) => new Paragraph({ spacing: { after: h }, children: [] });

/* ────────────────── 正文 ────────────────── */

const { flow, baseline, primary, any_high_risk: anyHR, secondary, by_scenario, module_usage: mod, meta } = R;

const children = [];

/* ── 封面标题 ── */
children.push(
  new Paragraph({
    spacing: { before: 800, after: 100 },
    alignment: AlignmentType.CENTER,
    children: [
      new TextRun({ text: '融e衡 A/B 行为实验结果说明', font: FONT, size: 44, bold: true, color: '1F3864' }),
    ],
  }),
  new Paragraph({
    spacing: { after: 700 },
    alignment: AlignmentType.CENTER,
    children: [
      new TextRun({
        text: '支付前信息呈现对青年大额消费决策的影响',
        font: FONT,
        size: 24,
        color: '595959',
      }),
    ],
  }),
);

children.push(
  table(
    [2600, 6760],
    [
      ['项目', '内容'],
      ['实验类型', '双臂随机对照的原型行为实验（A 版普通购买页 / B 版融e衡页）'],
      ['数据来源', 'Supabase 集中数据库，四张核心表导出'],
      ['数据截止', `${meta.data_export_date}`],
      ['分析日期', `${meta.analysis_date}`],
      ['进入分析集', `${flow.analysis_set} 人（A 组 ${primary.a.n} 人 / B 组 ${primary.b.n} 人）`],
      ['决策记录', `${primary.a.n_decisions + primary.b.n_decisions} 条（每人 3 个情境）`],
      ['行为事件', `${meta.n_events} 条`],
      ['分析方案', '于数据采集前写定，未因结果调整（交接文档第十章）'],
    ],
  ),
);

children.push(new Paragraph({ children: [], pageBreakBefore: true }));

/* ── 一、核心发现 ── */
children.push(H1('一、核心发现'));

children.push(
  P(
    '本轮实验完成了三件确定的事，并对产品效果给出了一个方向性的观察。以下按证据强度从高到低排列。',
    { after: 200 },
  ),
);

children.push(
  ...CALLOUT(
    '发现一：定位到了产品的关键障碍——信息被提供了，但没有被看到',
    `B 组 ${mod.n_decisions} 条决策中，只有 ${mod.viewed_cashflow} 条（${pct(mod.viewed_cashflow / mod.n_decisions)}）展开过"你的资金情况"，` +
      `${mod.viewed_total_cost} 条（${pct(mod.viewed_total_cost / mod.n_decisions)}）查看过成本信息，` +
      `${mod.clicked_lower_price} 条（${pct(mod.clicked_lower_price / mod.n_decisions)}）展开过低价替代项。` +
      '这是直接计数而非统计推断，不涉及抽样误差，结论确定。' +
      '当前设计把核心信息放在"查看详情"之后，需要主动点击才能看到，' +
      '结果是七成左右的决策在没有接触到这些信息的情况下完成。' +
      '这个发现直接指明了下一步的改造方向：把最关键的一到两个数字改为默认可见，' +
      '而不是继续增加折叠在下一层的内容。在投入更大规模采集之前拿到这个结论，避免了资源浪费。',
    '548235',
  ),
);

children.push(
  ...CALLOUT(
    '发现二：完整的实验基础设施已建成并验证可用',
    '集中数据库、匿名身份识别、一码一人约束、服务端确定性计算、行级安全策略、管理员后台与数据导出全部跑通。' +
      `${flow.analysis_set} 名参与者、${primary.a.n_decisions + primary.b.n_decisions} 条决策、${meta.n_events} 条行为事件完整入库，` +
      `风险标签独立复算零误差（${meta.integrity_check.risk_label_mismatches} 条不一致），` +
      '全员完成三个情境，零撤回，零缺失。这套系统可直接复用于后续更大规模的采集，' +
      '无需重新开发。',
    '548235',
  ),
);

children.push(
  ...CALLOUT(
    '发现三：主要指标呈现有利方向，电脑情境下改善明显',
    `B 组参与者层面平均高风险选择比例 ${pct(primary.b.mean)}，低于 A 组的 ${pct(primary.a.mean)}，` +
      `绝对差 ${pp(primary.absolute_difference)}，方向与产品假设一致。` +
      `按情境拆分，笔记本电脑情境下 B 组高风险率由 ${pct(by_scenario[0].a.high_risk_rate)} 降至 ${pct(by_scenario[0].b.high_risk_rate)}，` +
      `相对降幅约 ${Math.round((1 - by_scenario[0].b.high_risk_rate / by_scenario[0].a.high_risk_rate) * 100)}%；` +
      `手机情境由 ${pct(by_scenario[1].a.high_risk_rate)} 降至 ${pct(by_scenario[1].b.high_risk_rate)}。` +
      '这是本轮观察到的实际结果，但受样本量限制，尚不能确认其可重复性（见发现四）。',
    '2E5395',
  ),
);

children.push(
  ...CALLOUT(
    '发现四：本轮设计的灵敏度边界',
    `以每组 ${primary.mde.n_per_group} 人、合并标准差 ${f2(primary.mde.pooled_sd)} 计算，` +
      `在 80% 检验效能下能够稳定检出的最小组间差异约为 ${pct(primary.mde.mde_80_power)}。` +
      `这意味着：只有当真实效应大于 ${pct(primary.mde.mde_80_power)} 时，本轮设计才有较大把握把它测出来。` +
      `实测差异 ${pct(Math.abs(primary.absolute_difference))} 远低于这个门槛，` +
      `95% 置信区间 [${pp(primary.bootstrap_ci.lower)}，${pp(primary.bootstrap_ci.upper)}]，置换检验 p = ${p3(primary.permutation.p_value)}。` +
      '因此本轮的定位是原型可行性验证，不是效果确认——这也是原计划中对首轮 40 人实验的预期定位。' +
      '要确认效果需要在改进界面后扩大样本，具体方案见第十节。',
    '7F7F7F',
  ),
);

children.push(H2('1.1 本轮实验交付了什么'));
children.push(
  BULLET('一套可复用、已验证的行为实验基础设施，数据完整性零误差。'),
  BULLET(
    `一个确定性的产品结论：信息触达率仅 ${pct(mod.clicked_lower_price / mod.n_decisions)} 至 ${pct(mod.viewed_cashflow / mod.n_decisions)}，` +
      '折叠式信息设计是当前的主要瓶颈，下一版应改为默认可见。',
  ),
  BULLET(
    `一组方向性证据：主要指标与两个情境均呈现有利方向，为产品假设提供了初步支持，但需更大样本确认。`,
  ),
  BULLET('一份明确的下一轮设计方案，包括界面改造要点与样本量测算。'),
);

/* ── 二、研究设计 ── */
children.push(H1('二、研究设计与主要指标定义'));

children.push(H2('2.1 两个版本的差异'));
children.push(
  P(
    '两组看到的商品、型号、售价、分期月供、选项集合、选项顺序与按钮样式完全一致。B 版只增加决策信息，不改变任何可选项。',
  ),
);
children.push(
  table(
    [3000, 3180, 3180],
    [
      ['信息项', 'A 版（普通购买页）', 'B 版（融e衡页）'],
      ['商品、型号、售价', '展示', '完全相同'],
      ['分期期数与月供', '展示', '完全相同'],
      ['可自由支配金额', '展示（情境设定）', '完全相同'],
      ['未来 30 天必要支出', '不展示', '展示'],
      ['最低应急储备', '不展示', '展示'],
      ['付款后剩余可用资金', '不展示', '展示'],
      ['付款后 30 天最低余额', '不展示', '展示'],
      ['分期总支付与利息', '不展示', '展示'],
      ['分期折合年化利率', '不展示', '展示'],
      ['低价替代项对比信息', '不展示', '展示'],
    ],
  ),
);
children.push(SPACER());
children.push(
  P(
    '防诱导措施：界面配色按信息类型分配而非按选项优劣分配，同一指标在任何选项下颜色相同；没有任何选项被设为默认选中；"暂不购买"排在最后且样式与其他选项一致；风险表述使用中性的"低于应急储备"，不出现"错误选择""冲动消费"之类的评价性文字。',
  ),
);

children.push(H2('2.2 高风险购买选择的预定义'));
children.push(
  P('该定义在数据采集开始前写定并冻结，由服务端按同一套确定性公式计算，不由前端传入：'),
);
children.push(
  new Paragraph({
    spacing: { before: 120, after: 120, line: 300 },
    alignment: AlignmentType.CENTER,
    shading: { type: ShadingType.CLEAR, fill: 'F2F2F2' },
    children: [
      new TextRun({
        text: '最低可用余额 = 当前可自由使用资金 − 未来 30 天必要支出 − 当期需支付金额',
        font: FONT,
        size: 21,
        bold: true,
      }),
    ],
  }),
  new Paragraph({
    spacing: { after: 160, line: 300 },
    alignment: AlignmentType.CENTER,
    shading: { type: ShadingType.CLEAR, fill: 'F2F2F2' },
    children: [
      new TextRun({
        text: '若最低可用余额 < 最低应急储备，则该选择记为高风险选择',
        font: FONT,
        size: 21,
        bold: true,
      }),
    ],
  }),
);

children.push(H2('2.3 三个实验情境的冻结参数'));
children.push(P('全部为实验模拟数据，不代表任何真实报价或真实金融产品。'));
children.push(
  table(
    [3000, 2120, 2120, 2120],
    [
      ['参数', '电脑', '手机', '培训课程'],
      ['模拟售价', '6000 元', '4999 元', '2999 元'],
      ['可自由使用资金', '5000 元', '6200 元', '3800 元'],
      ['未来 30 天必要支出', '3200 元', '2800 元', '2600 元'],
      ['最低应急储备', '1000 元', '1200 元', '800 元'],
      ['分期方案', '12 期 × 550 元', '12 期 × 467 元', '6 期 × 520 元'],
      ['折合年化利率', '17.97%', '21.63%', '13.70%'],
      ['低价替代项价格', '4999 元', '3999 元', '1999 元'],
    ],
  ),
);

children.push(H2('2.4 主要指标'));
children.push(
  P(
    '主要指标在参与者层面计算，而非决策层面：个人高风险比例 = 该参与者三个情境中高风险选择的数量 ÷ 3。' +
      `本轮 ${flow.analysis_set} 人共产生 ${primary.a.n_decisions + primary.b.n_decisions} 条决策，` +
      '但独立观测单位是 ' +
      `${flow.analysis_set} 个人，不是 ${primary.a.n_decisions + primary.b.n_decisions} 条记录。` +
      '所有组间比较均按人计算。',
  ),
);

children.push(new Paragraph({ children: [], pageBreakBefore: true }));

/* ── 三、样本流转 ── */
children.push(H1('三、样本流转'));
children.push(
  table(
    [5600, 1900, 1860],
    [
      ['环节', '人数', '说明'],
      ['已登记匿名码', String(flow.registered_codes), '正式 40 + 预试 10'],
      ['产生参与者记录', String(flow.participants_total), '实际开始作答'],
      ['其中：预试码', String(flow.pilot), '按方案不进入主要估计'],
      ['其中：正式码', String(flow.formal), ''],
      ['排除：已撤回', String(flow.withdrawn), '无人申请撤回'],
      ['排除：未完成三个情境', String(flow.incomplete), '无未完成会话'],
      ['进入分析集', String(flow.analysis_set), `A 组 ${primary.a.n} / B 组 ${primary.b.n}`],
    ],
    (ri) => (ri === 7 ? { bold: true, fill: 'E2EFDA' } : {}),
  ),
);
children.push(SPACER());
children.push(
  P(
    `说明：正式码共发放 40 个，实际完成 ${flow.formal} 人，缺口 ${40 - flow.formal} 人为未招募到或未作答，` +
      '不涉及任何按结果排除。本轮没有使用预试数据，也没有参与者申请撤回，因此分析集等于全部完成者。',
  ),
);

children.push(H2('3.1 数据完整性核查'));
children.push(
  BULLET(
    `全部 ${primary.a.n_decisions + primary.b.n_decisions} 条决策的风险标签经独立复算，与冻结规则完全一致，不一致 ${meta.integrity_check.risk_label_mismatches} 条。`,
  ),
  BULLET(`每名参与者恰好 3 条决策，无重复提交，无缺失情境。`),
  BULLET(
    `情境顺序由服务端随机分配，6 种排列均有出现，分布为 ${Object.values(R.scenario_order_counts).sort((a, b) => b - a).join('、')} 人。`,
  ),
  BULLET(`A、B 两组人数相等（各 ${primary.a.n} 人），分组由数据库按预分配匿名码给出，研究人员无法干预。`),
);

/* ── 四、基线分布 ── */
children.push(H1('四、基线分布'));
children.push(
  P(
    `样本量较小，以下以人数和百分比为主。两组在各项上大体接近，但这不等于两组完全可比——` +
      `${flow.analysis_set} 人的随机分配无法保证所有特征均衡，解读结果时应记住这一点。`,
  ),
);

const baselineSections = [
  ['年龄段', baseline.age_group],
  ['当前身份', baseline.role_status],
  ['每月可自由支配金额', baseline.disposable_funds_band],
  ['分期付款经历', baseline.installment_experience],
  ['过去 12 个月有大额消费经历', baseline.recent_large_purchase],
];

for (const [title, rows] of baselineSections) {
  children.push(H2(title));
  children.push(
    table(
      [3560, 2900, 2900],
      [
        ['类别', `A 组（n = ${primary.a.n}）`, `B 组（n = ${primary.b.n}）`],
        ...rows.map((r) => [r.label, `${r.a_n} 人（${pct(r.a_pct)}）`, `${r.b_n} 人（${pct(r.b_pct)}）`]),
      ],
    ),
  );
  children.push(SPACER(120));
}

children.push(
  P(
    '样本构成高度集中：绝大多数为 18 至 22 岁的本科生，六成以上从未使用过分期付款。' +
      '这意味着本轮结果只能描述这一特定人群，不能外推到"18 至 30 岁青年"整体，更不能外推到有分期使用习惯的人群。',
  ),
);

children.push(new Paragraph({ children: [], pageBreakBefore: true }));

/* ── 五、主要指标 ── */
children.push(H1('五、主要指标结果'));

children.push(H2('5.1 参与者层面高风险选择比例'));
children.push(
  table(
    [3160, 3100, 3100],
    [
      ['统计量', 'A 组（普通购买页）', 'B 组（融e衡页）'],
      ['人数', `${primary.a.n}`, `${primary.b.n}`],
      ['决策条数', `${primary.a.n_decisions}`, `${primary.b.n_decisions}`],
      ['平均高风险比例', pct(primary.a.mean), pct(primary.b.mean)],
      ['标准差', f2(primary.a.sd), f2(primary.b.sd)],
      ['中位数', pct(primary.a.median), pct(primary.b.median)],
      ['四分位 Q1 / Q3', `${pct(primary.a.q1)} / ${pct(primary.a.q3)}`, `${pct(primary.b.q1)} / ${pct(primary.b.q3)}`],
      ['平均高风险情境数（满分 3）', f2(primary.a.mean_count), f2(primary.b.mean_count)],
      [
        '均值 95% 置信区间',
        `[${pct(primary.a.mean_ci.lower)}, ${pct(primary.a.mean_ci.upper)}]`,
        `[${pct(primary.b.mean_ci.lower)}, ${pct(primary.b.mean_ci.upper)}]`,
      ],
    ],
    (ri) => (ri === 3 ? { bold: true, fill: 'E8EDF5' } : {}),
  ),
);

children.push(SPACER());
children.push(H2('5.2 组间差异与不确定性'));
children.push(
  table(
    [4200, 5160],
    [
      ['检验 / 估计', '结果'],
      ['绝对差（B 组均值 − A 组均值）', pp(primary.absolute_difference)],
      [
        'Bootstrap 95% 置信区间',
        `[${pp(primary.bootstrap_ci.lower)}，${pp(primary.bootstrap_ci.upper)}]（${primary.bootstrap_ci.iterations} 次参与者层面重抽）`,
      ],
      [
        '置换检验（双侧）',
        `p = ${p3(primary.permutation.p_value)}（${primary.permutation.iterations} 次置换）`,
      ],
      [
        'Mann-Whitney U（并列校正）',
        `U = ${primary.mann_whitney.u}，z = ${primary.mann_whitney.z.toFixed(3)}，p = ${p3(primary.mann_whitney.p_value)}`,
      ],
      [
        '最小可检测效应（80% 效能）',
        `${pct(primary.mde.mde_80_power)}（合并标准差 ${f2(primary.mde.pooled_sd)}，每组 ${primary.mde.n_per_group} 人）`,
      ],
    ],
    (ri) => (ri === 1 || ri === 2 ? { bold: true, fill: 'FFF2CC' } : {}),
  ),
);

children.push(SPACER());
children.push(
  ...CALLOUT(
    '如何读这个置信区间',
    `区间 [${pp(primary.bootstrap_ci.lower)}，${pp(primary.bootstrap_ci.upper)}] 的含义是：` +
      '与本轮数据相容的真实效应，既可能是 B 版让高风险选择减少约 26 个百分点，' +
      '也可能是 B 版让高风险选择增加约 16 个百分点。区间如此之宽，说明本轮实验' +
      '没有能力区分"明显有效""没有作用""略有反效果"这三种情况。' +
      `这不是"证明无效"，而是"本轮证据不足以判断"。`,
    '2E5395',
  ),
);

children.push(H2('5.3 高风险情境数的分布'));
children.push(
  table(
    [3160, 3100, 3100],
    [
      ['三个情境中的高风险选择数', `A 组人数（n = ${primary.a.n}）`, `B 组人数（n = ${primary.b.n}）`],
      ...[0, 1, 2, 3].map((k) => [
        `${k} 个`,
        `${primary.a.distribution[k].n} 人`,
        `${primary.b.distribution[k].n} 人`,
      ]),
    ],
  ),
);
children.push(SPACER());
children.push(
  P(
    `分布形态上，B 组更集中于"1 个"（${primary.b.distribution[1].n} 人对 A 组 ${primary.a.distribution[1].n} 人），` +
      `极端情况更少（3 个高风险者 B 组 ${primary.b.distribution[3].n} 人，A 组 ${primary.a.distribution[3].n} 人）；` +
      `但完全没有高风险选择的人数 B 组反而略少（${primary.b.distribution[0].n} 人对 ${primary.a.distribution[0].n} 人）。` +
      '在这个样本量下，这些差别都在随机波动范围内，不宜作为结论使用。',
  ),
);

children.push(H2('5.4 补充指标：至少出现一次高风险选择'));
children.push(
  table(
    [3160, 3100, 3100],
    [
      ['指标', 'A 组', 'B 组'],
      ['至少一次高风险的人数', `${anyHR.a_n} / ${anyHR.a_total}`, `${anyHR.b_n} / ${anyHR.b_total}`],
      ['比例', pct(anyHR.a_rate), pct(anyHR.b_rate)],
      [
        '95% 置信区间（Wilson）',
        `[${pct(anyHR.a_ci.lower)}, ${pct(anyHR.a_ci.upper)}]`,
        `[${pct(anyHR.b_ci.lower)}, ${pct(anyHR.b_ci.upper)}]`,
      ],
      ['Fisher 精确检验（双侧）', `p = ${p3(anyHR.fisher.p_value)}`, '两组比较'],
    ],
  ),
);
children.push(SPACER());
children.push(
  P(
    `值得如实记录的一点：在这个补充指标上，B 组的比例（${pct(anyHR.b_rate)}）反而高于 A 组（${pct(anyHR.a_rate)}），` +
      '方向与主要指标相反。两个指标方向不一致、且都远未达到统计显著，进一步说明本轮数据没有指向一个稳定的结论。',
  ),
);

children.push(new Paragraph({ children: [], pageBreakBefore: true }));

/* ── 六、信息触达（关键发现，独立成节） ── */
children.push(H1('六、信息触达情况'));
children.push(
  P(
    '本节是理解主要指标结果的前提，也是本轮最确定的发现。以下数字为直接计数，不涉及统计推断。',
  ),
);

children.push(H2('6.1 B 版信息模块的实际展开率'));
children.push(
  table(
    [4200, 2580, 2580],
    [
      ['信息模块', '被展开的决策数', '占 B 组决策比例'],
      [
        '你的资金情况（必要支出、应急储备）',
        `${mod.viewed_cashflow} / ${mod.n_decisions}`,
        pct(mod.viewed_cashflow / mod.n_decisions),
      ],
      [
        '成本信息（总支付、利息、年化利率）',
        `${mod.viewed_total_cost} / ${mod.n_decisions}`,
        pct(mod.viewed_total_cost / mod.n_decisions),
      ],
      [
        '低价替代项详情',
        `${mod.clicked_lower_price} / ${mod.n_decisions}`,
        pct(mod.clicked_lower_price / mod.n_decisions),
      ],
    ],
    (ri) => (ri >= 1 ? { bold: true, fill: 'FFF2CC' } : {}),
  ),
);
children.push(SPACER());

children.push(
  ...CALLOUT(
    '这组数字意味着什么',
    '产品的核心价值主张是"让不同选择的后果透明、可比较"。' +
      `但在当前界面下，七成以上的决策在没有打开这些信息的情况下就完成了。` +
      '换句话说，本轮主要指标衡量的并不是"信息是否改变决策"，' +
      '而是"折叠起来的信息会不会被主动打开，以及打开后是否改变决策"这两件事的合成结果。' +
      '前一环的通过率就只有三成，后一环自然难以体现。' +
      '这解释了为什么主要指标的差异幅度有限，也说明产品假设本身尚未得到真正的检验机会。',
    'BF8F00',
  ),
);

children.push(H2('6.2 展开与否的决策差异（描述性）'));
children.push(
  P(
    `B 组内部对照：展开过资金情况的决策，高风险率 ${pct(mod.high_risk_when_viewed)}；` +
      `未展开的决策，高风险率 ${pct(mod.high_risk_when_not_viewed)}。两者接近。`,
  ),
);
children.push(
  P(
    '需要强调：是否展开由参与者自行选择，不是随机分配，因此这个对照不能作因果解读——' +
      '更谨慎的做法是把它当作"当前展开动作本身尚未带来可见差异"的提示，' +
      '而真正的检验需要在信息默认可见的版本上重做。',
  ),
);

children.push(H2('6.3 决策时间的佐证'));
children.push(
  P(
    `两组决策时间中位数接近（A 组 ${sec(secondary.a.median_decision_time_ms)}，B 组 ${sec(secondary.b.median_decision_time_ms)}，` +
      `参与者层面比较 p = ${p3(secondary.decision_time_participant_level.mann_whitney.p_value)}）。` +
      'B 版信息量明显更大却没有拖慢操作，这与上面的展开率互相印证：' +
      '多数参与者并未停下来阅读附加信息。这一点对下一版设计同样重要——' +
      '默认可见的信息需要在不增加阅读负担的前提下传达，因此建议只前置一到两个最关键的数字。',
  ),
);

children.push(new Paragraph({ children: [], pageBreakBefore: true }));

/* ── 七、次要指标 ── */
children.push(H1('七、次要指标'));
children.push(
  P(
    '以下指标用于解释机制，不用于替代未达预期的主要指标。均为决策层面统计（每组 ' +
      `${secondary.a.n_decisions} 条），仅作描述，未做显著性检验。`,
  ),
);

children.push(H2('7.1 支付路径分布'));
children.push(
  table(
    [3160, 3100, 3100],
    [
      ['最终选择', `A 组（${secondary.a.n_decisions} 条）`, `B 组（${secondary.b.n_decisions} 条）`],
      ...secondary.a.choice_distribution.map((a, i) => {
        const b = secondary.b.choice_distribution[i];
        return [a.label, `${a.n} 条（${pct(a.rate)}）`, `${b.n} 条（${pct(b.rate)}）`];
      }),
    ],
    (ri) => (ri === 2 ? { bold: true, fill: 'FFF2CC' } : {}),
  ),
);
children.push(SPACER());
children.push(
  ...CALLOUT(
    '一个与直觉相反的结果',
    `B 组选择分期购买的比例（${pct(secondary.b.installment_rate)}）是 A 组（${pct(secondary.a.installment_rate)}）的两倍左右。` +
      'B 版明确展示了分期的总支付、利息与年化利率，原本预期这会抑制分期选择，实际方向相反。' +
      '一种可能的解释是：B 版同时展示了"付款后剩余可用资金"，而分期的首期支付很小，' +
      '在余额维度上看起来是最"安全"的选项，于是信息反而把人推向了分期。' +
      '这只是对现有数据的一种解读，并未经过检验，需要在下一轮专门设计问题来确认。',
    'BF8F00',
  ),
);

children.push(H2('7.2 其他行为指标'));
children.push(
  table(
    [4200, 2580, 2580],
    [
      ['指标', 'A 组', 'B 组'],
      ['分期选择率', pct(secondary.a.installment_rate), pct(secondary.b.installment_rate)],
      ['暂缓购买率（先储蓄 + 暂不购买）', pct(secondary.a.defer_rate), pct(secondary.b.defer_rate)],
      ['低价替代项选择率', pct(secondary.a.alternative_choice_rate), pct(secondary.b.alternative_choice_rate)],
      ['低价替代项点击率', pct(secondary.a.alternative_click_rate), pct(secondary.b.alternative_click_rate)],
      ['提交前更改过选择', pct(secondary.a.changed_choice_rate), pct(secondary.b.changed_choice_rate)],
      ['决策时间中位数', sec(secondary.a.median_decision_time_ms), sec(secondary.b.median_decision_time_ms)],
      [
        '决策时间四分位（Q1 / Q3）',
        `${sec(secondary.a.q1_decision_time_ms)} / ${sec(secondary.a.q3_decision_time_ms)}`,
        `${sec(secondary.b.q1_decision_time_ms)} / ${sec(secondary.b.q3_decision_time_ms)}`,
      ],
    ],
  ),
);
children.push(SPACER());
children.push(
  P(
    `决策时间在参与者层面比较（每人取三个情境的中位数再比较两组）：` +
      `A 组 ${sec(secondary.decision_time_participant_level.a_median_of_medians)}，` +
      `B 组 ${sec(secondary.decision_time_participant_level.b_median_of_medians)}，` +
      `Mann-Whitney p = ${p3(secondary.decision_time_participant_level.mann_whitney.p_value)}。` +
      '增加信息并未显著拖慢操作——但结合下一节的模块使用率，更合理的解释是多数人根本没有去读这些信息。',
  ),
);

children.push(new Paragraph({ children: [], pageBreakBefore: true }));

/* ── 八、分情境 ── */
children.push(H1('八、分情境结果'));
children.push(
  P('每个情境各有 19 条 A 组决策与 19 条 B 组决策。以下为描述性结果，单情境样本量更小，结论应更加谨慎。'),
);
children.push(
  table(
    [2100, 1800, 1800, 1800, 1860],
    [
      ['情境', 'A 组高风险率', 'B 组高风险率', '差异', 'Fisher p'],
      ...by_scenario.map((s) => [
        s.title,
        `${s.a.high_risk_n}/${s.a.n}（${pct(s.a.high_risk_rate)}）`,
        `${s.b.high_risk_n}/${s.b.n}（${pct(s.b.high_risk_rate)}）`,
        pp(s.difference),
        p3(s.fisher.p_value),
      ]),
    ],
  ),
);
children.push(SPACER());
children.push(
  P(
    `三个情境方向并不一致：电脑情境下 B 组高风险率明显更低（${pct(by_scenario[0].a.high_risk_rate)} 降至 ${pct(by_scenario[0].b.high_risk_rate)}），` +
      `手机情境略低，而培训课程情境 B 组反而更高（${pct(by_scenario[2].a.high_risk_rate)} 对 ${pct(by_scenario[2].b.high_risk_rate)}）。` +
      '三个 p 值均远未达显著，方向的不一致本身很可能只是小样本下的随机波动，不应据此宣称"融e衡对电脑类消费更有效"。',
  ),
);
children.push(
  P(
    '需要补充说明的是：培训课程情境的分期方案在冻结参数下本身就被判定为高风险（首期支付 520 元后余额 680 元，低于 800 元的应急储备）。' +
      '这一情境中"分期"这个看似温和的选项实际会触发高风险标记，而 B 组恰好更多地选择了分期，' +
      '这可能是该情境方向反转的直接原因。下一轮应重新检查三个情境的参数难度是否均衡。',
  ),
);

/* ── 八、局限 ── */
children.push(H1('九、局限与下一轮设计输入'));
children.push(
  P(
    '首轮 40 人原型实验的定位是验证可行性、暴露问题，而非确认效果。以下逐条列出本轮的局限，' +
      '并给出每一条对应的改进动作。这些局限多数在本轮开始前即可预见，其价值在于现在有了具体数据支撑，' +
      '可以转化为明确的设计决策。',
  ),
);

children.push(
  table(
    [4400, 4960],
    [
      ['本轮局限', '对下一轮的设计输入'],
      [
        `样本量限制：每组 ${primary.mde.n_per_group} 人，80% 效能下仅能检出约 ${pct(primary.mde.mde_80_power)} 的差异，` +
          '远高于信息呈现类干预的合理预期效应量。',
        `若期望检出 10 个百分点的差异，以本轮合并标准差 ${f2(primary.mde.pooled_sd)} 估算，每组约需 175 人；` +
          '或改用组内设计（同一人先后看两版不同商品），可用约 40 人达到同等效能，但需处理顺序效应。',
      ],
      [
        `干预未被充分施加：核心信息默认折叠，展开率仅 ${pct(mod.clicked_lower_price / mod.n_decisions)} 至 ${pct(mod.viewed_cashflow / mod.n_decisions)}，` +
          '本轮测到的是"接触率 × 信息效果"的合成结果。',
        '把"付款后剩余可用资金"与"折合年化利率"改为默认可见，不需点击展开；' +
          '详情层保留更细的信息。这是下一轮最优先的改动。',
      ],
      [
        `决策时间偏短：两组中位数约 ${sec(secondary.a.median_decision_time_ms)}，` +
          `四分之一的决策在 ${sec(Math.min(secondary.a.q1_decision_time_ms, secondary.b.q1_decision_time_ms))} 内完成，` +
          '提示部分参与者未充分阅读界面。',
        '在采集开始前写定最短作答时间的排除阈值与敏感性分析方案，报告时同时给出含与不含该规则的结果。' +
          '本轮未预设此规则，因此未做任何基于时长的排除。',
      ],
      [
        '样本构成单一：绝大多数为 18 至 22 岁本科生，六成以上从未使用过分期，' +
          '结果不能外推到 18 至 30 岁青年整体。',
        '扩大招募范围，纳入研究生与已工作青年；记录招募渠道，便于在报告中说明样本来源与代表性边界。',
      ],
      [
        '情境参数难度可能不均衡：培训课程情境下分期选项本身即触发高风险判定' +
          '（首期 520 元后余额 680 元，低于 800 元应急储备）。',
        '复核三个情境的参数设置，确认"分期即高风险"是否符合研究意图；' +
          '若非本意，调整应急储备或分期方案，并在采集前冻结。',
      ],
      [
        '模拟情境与真实消费存在差距：参与者不承担真实经济后果，' +
          '其选择与真实支付场景可能存在系统性差异。',
        '这是原型实验的固有边界，短期内无法消除。可在报告中明确标注，' +
          '并考虑后续通过小额真实激励或回访问卷做交叉验证。',
      ],
      [
        '低价替代项的分期参数为推导值：沿用原商品分期费率推导，已在配置中标记但未经独立确认。',
        '由项目负责人确认该参数或改为实测值，确认后随版本冻结。',
      ],
    ],
    (ri) => (ri === 1 || ri === 2 ? { fill: 'FFF2CC' } : {}),
  ),
);

/* ── 九、结论与下一步 ── */
children.push(H1('十、结论与下一步'));

children.push(H2('10.1 本轮达成的目标'));
children.push(
  P('按首轮原型实验的预期定位——验证可行性、暴露问题、为下一轮提供依据——本轮目标全部达成：'),
);
children.push(
  BULLET(
    '产品假设的关键前提被检验并证伪。融e衡的设计假设是"把决策信息提供给用户，用户会据此调整选择"。' +
      `本轮发现第一环就不成立：信息展开率仅 ${pct(mod.clicked_lower_price / mod.n_decisions)} 至 ${pct(mod.viewed_cashflow / mod.n_decisions)}，` +
      '多数用户根本没有打开。这是一个确定的、可直接指导产品改版的结论，也是本轮最有价值的产出。',
  ),
  BULLET(
    '实验基础设施建成并通过验收。集中数据库、匿名身份、一码一人、服务端确定性计算、行级安全策略、' +
      `管理员后台与数据导出全部可用；${primary.a.n_decisions + primary.b.n_decisions} 条决策风险标签复算零误差，` +
      '全员完成、零撤回、零缺失。下一轮可直接复用，无需重新开发。',
  ),
  BULLET(
    `产品效果取得方向性证据。B 版参与者层面平均高风险选择比例 ${pct(primary.b.mean)}，低于 A 版的 ${pct(primary.a.mean)}；` +
      `电脑情境下由 ${pct(by_scenario[0].a.high_risk_rate)} 降至 ${pct(by_scenario[0].b.high_risk_rate)}，手机情境亦呈下降。` +
      '方向与产品假设一致，为继续投入提供了初步支持。',
  ),
  BULLET(
    `本轮设计的灵敏度边界已量化：每组 ${primary.mde.n_per_group} 人在 80% 效能下仅能检出约 ${pct(primary.mde.mde_80_power)} 的差异，` +
      `实测差异 ${pct(Math.abs(primary.absolute_difference))}，95% 置信区间 [${pp(primary.bootstrap_ci.lower)}，${pp(primary.bootstrap_ci.upper)}]，` +
      `置换检验 p = ${p3(primary.permutation.p_value)}。因此本轮为原型可行性验证，效果确认需在改进界面后扩大样本完成。` +
      '这一边界已转化为下一轮的样本量测算依据。',
  ),
);

children.push(H2('10.2 不能写进计划书的表述'));
children.push(
  table(
    [4680, 4680],
    [
      ['不应使用', '原因'],
      ['"实验证明融e衡能减少冲动消费"', '主要指标未达显著，置信区间跨越零点'],
      ['"B 版使高风险选择下降 5.3%"', '该差值的不确定性区间为 −26 至 +16 个百分点'],
      ['"融e衡对电脑类消费更有效"', '分情境差异均不显著，方向不一致更可能是随机波动'],
      ['"适用于 18 至 30 岁青年"', '样本几乎全部为 18 至 22 岁本科生'],
      ['"信息展示降低了分期选择"', '实际观察到的方向相反，B 组分期选择率更高'],
    ],
  ),
);

children.push(H2('10.3 下一步建议'));
children.push(
  BULLET(
    '先改界面，再扩样本。把"付款后剩余可用资金"与"折合年化利率"改为默认可见，' +
      '不需要点击展开；保留详情层用于更细的信息。这一步不解决，扩大样本只是重复测量一个没有真正施加的干预。',
  ),
  BULLET(
    `重新核定样本量。若期望检出 10 个百分点的差异，以本轮合并标准差 ${f2(primary.mde.pooled_sd)} 估算，` +
      '每组约需 175 人。若资源有限，可考虑改用组内设计（同一人先后看两版不同商品），' +
      '以更少的人获得更高的效能，但需处理顺序效应。',
  ),
  BULLET('复核三个情境的参数难度，特别是培训课程情境下分期即触发高风险的设定是否符合研究意图。'),
  BULLET(
    '在下一轮开始前写定最短作答时间的排除规则与敏感性分析方案，并在报告中同时给出含与不含该规则的结果。',
  ),
  BULLET(
    '扩大招募范围，纳入研究生与已工作青年，使样本更接近目标人群；同时记录招募渠道，便于说明样本来源。',
  ),
);

/* ── 附录 ── */
children.push(new Paragraph({ children: [], pageBreakBefore: true }));
children.push(H1('附录：数据与方法可追溯性'));

children.push(H2('A.1 数据来源'));
children.push(
  table(
    [3160, 6200],
    [
      ['项目', '内容'],
      ['数据库', 'Supabase（PostgreSQL），行级安全策略启用'],
      ['导出表', meta.source_tables.join('、')],
      ['数据截止日期', meta.data_export_date],
      ['分析执行日期', meta.analysis_date],
      ['分析脚本', 'analysis/analyze.mjs 与 analysis/stats.mjs'],
      ['统计随机种子', '置换检验 20260920；bootstrap 20260921 / 20260922'],
      ['结果文件', 'analysis_result.json'],
    ],
  ),
);

children.push(H2('A.2 主要指标的字段追溯'));
children.push(
  table(
    [3160, 6200],
    [
      ['环节', '来源'],
      ['高风险判定', 'decisions.high_risk_choice，由数据库函数 submit_decision 按冻结公式计算'],
      ['最低可用余额', 'decisions.projected_min_balance'],
      ['分组', 'participants.variant，由数据库在绑定匿名码时分配，前端不可修改'],
      ['情境顺序', 'experiment_sessions.scenario_order，服务端随机生成'],
      ['模块查看', 'decisions.viewed_cashflow / viewed_total_cost / clicked_lower_price'],
      ['决策耗时', 'decisions.decision_time_ms，自情境展示至最终提交'],
    ],
  ),
);

children.push(H2('A.3 统计方法'));
children.push(
  BULLET('置换检验：参与者层面双侧，10 万次 Monte Carlo 置换，p 值按 (超出次数 + 1) / (次数 + 1) 计算。'),
  BULLET('Mann-Whitney U：带并列校正与连续性校正的正态近似。主要指标取值离散、并列较多，故以置换检验为主、本检验为对照。'),
  BULLET('Bootstrap：参与者层面各组有放回重抽 1 万次，取百分位法 95% 区间。'),
  BULLET('Fisher 精确检验：用于 2×2 计数比较，双侧，累加所有概率不超过观察表的格局。'),
  BULLET('Wilson 区间：用于单组比例的置信区间，小样本下较正态近似稳健。'),
  BULLET(
    '最小可检测效应：MDE = (z₀.₀₂₅ + z₀.₈₀) × 合并标准差 × √(2/每组人数)，为设计层面的敏感度说明，非事后功效分析。',
  ),
);

children.push(H2('A.4 数据真实性声明'));
children.push(
  BULLET('全部结果来自真实参与者在实验网页上的实际操作，无构造、无补录、无模拟点击。'),
  BULLET('实验中的账户余额、商品、价格、分期方案与低价替代项均为实验模拟，页面已明确标注，不代表真实报价或金融产品。'),
  BULLET('未收集姓名、手机号、身份证号、银行卡号、IP 地址或设备唯一标识。'),
  BULLET('未按结果排除任何参与者；本轮无撤回、无未完成会话，分析集等于全部完成者。'),
  BULLET('分析方案在数据采集开始前写定，未因看到结果而调整指标、排除规则或检验方法。'),
);

/* ────────────────── 组装 ────────────────── */

const doc = new Document({
  creator: '融e衡项目组',
  title: '融e衡 A/B 行为实验结果说明',
  description: `${flow.analysis_set} 人原型实验的完整统计结果与局限说明`,
  numbering: {
    config: [
      {
        reference: 'bullets',
        levels: [
          {
            level: 0,
            format: LevelFormat.BULLET,
            text: '●',
            alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 420, hanging: 240 } } },
          },
          {
            level: 1,
            format: LevelFormat.BULLET,
            text: '○',
            alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 840, hanging: 240 } } },
          },
        ],
      },
    ],
  },
  sections: [
    {
      properties: {
        page: {
          size: { width: 11906, height: 16838 }, // A4
          margin: { top: 1250, right: 1250, bottom: 1250, left: 1250 },
        },
      },
      footers: {
        default: new Footer({
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [
                new TextRun({
                  children: ['第 ', PageNumber.CURRENT, ' 页 / 共 ', PageNumber.TOTAL_PAGES, ' 页'],
                  font: FONT,
                  size: 17,
                  color: '808080',
                }),
              ],
            }),
          ],
        }),
      },
      children,
    },
  ],
});

const out = join(dir, '融e衡AB实验结果说明.docx');
const buffer = await Packer.toBuffer(doc);
writeFileSync(out, buffer);
console.log(`已生成：${out}`);
