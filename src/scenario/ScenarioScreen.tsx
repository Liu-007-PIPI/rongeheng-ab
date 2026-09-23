import { useEffect, useMemo, useRef, useState } from 'react';
import { OptionCard } from '../components/OptionCard';
import { Progress, Screen, Stat, Zone } from '../components/ui';
import { CHOICE_LABELS, CHOICE_ORDER, evaluateOption, monthlyNet } from '../lib/calc';
import { formatMoney, formatPercent } from '../lib/money';
import { useExposure } from '../lib/useExposure';
import type { FinalChoice, OptionOutcome, PaymentPath, ScenarioConfig, Variant } from '../lib/types';
import { useExperiment } from '../state/experiment';

const SUMMARY_REGION_LABEL = '你这样选的话';

/**
 * 第二轮情境页。相对第一轮的三处结构性改动：
 *
 * 1. 默认展开。页面上不再有任何折叠层——第一轮 B 版的关键数字要点两次才看得到，
 *    实测触达率只有 12.28%—29.82%，主要指标测到的其实是"接触率 × 信息效果"的合成结果。
 * 2. A 版也看到全部事实。判定线：用页面上已显示的数字做一次加减法就能得出的，
 *    属于事实，两版都给（总支付、利息与手续费、期数、与原商品价差、月收支）；
 *    需要建模或解方程才能得出的，属于产品的分析，只给 B 版（折合年化、完整还款期最低余额、风险判定）。
 *    第一轮 A 版连"12 期一共还多少"都看不到，会让"B 组风险更低"分不清是呈现方式有效还是 A 组被蒙住眼。
 * 3. 触达率改用曝光时长测量，不再依赖点击。
 *
 * 文案口径（2026-09-23）：全部改成大白话，"应急储备""净结余""折合年化利率"
 * 这类词都配了一行解释。改的只是说法，指标集合、A/B 分界线和数值一律没动——
 * 看不懂指标会变成一种与分组无关的噪声，两组同时被它拉平，反而更难测出信息呈现的效果。
 */
export function ScenarioScreen({
  scenario,
  variant,
  position,
  total,
}: {
  scenario: ScenarioConfig;
  variant: Variant;
  position: number; // 从 1 开始
  total: number;
}) {
  const { submitDecision, logEvent, busy } = useExperiment();

  const [choice, setChoice] = useState<FinalChoice | null>(null);
  const [altPath, setAltPath] = useState<PaymentPath>('full_payment');
  const [selectionCount, setSelectionCount] = useState(0);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const shownAt = useRef<number>(Date.now());
  // 本版本核心信息区块的曝光。A 版观测事实区，B 版观测分析区——
  // 内容不同但结构对等，两版都测"本版本要传达的东西有没有真的停留在视野里"。
  const exposure = useExposure(2000);

  useEffect(() => {
    setChoice(null);
    setAltPath('full_payment');
    setSelectionCount(0);
    setSubmitError(null);
    exposure.reset();
    shownAt.current = Date.now();
    logEvent('scenario_shown', scenario.scenario_id, { position });
    // logEvent 依赖当前会话，故只按情境变化触发
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenario.scenario_id, position]);

  const isB = variant === 'B';
  const net = useMemo(() => monthlyNet(scenario), [scenario]);

  const outcomeOf = (c: FinalChoice) =>
    evaluateOption(scenario, c, c === 'alternative' ? altPath : 'full_payment');

  function select(c: FinalChoice) {
    setChoice(c);
    setSelectionCount((n) => n + 1);
    logEvent('select_option', scenario.scenario_id, {
      option: c,
      path: c === 'alternative' ? altPath : null,
    });
  }

  function selectAltPath(p: PaymentPath) {
    setAltPath(p);
    logEvent('switch_alt_path', scenario.scenario_id, { path: p });
    if (choice === 'alternative') {
      setSelectionCount((n) => n + 1);
      logEvent('select_option', scenario.scenario_id, { option: 'alternative', path: p });
    }
  }

  async function handleSubmit() {
    if (!choice || busy) return;
    setSubmitError(null);
    const outcome = outcomeOf(choice);
    const exposedMs = exposure.totalMs();
    try {
      await submitDecision({
        scenario_id: scenario.scenario_id,
        scenario_position: position,
        final_choice: choice,
        selected_payment_path: outcome.payment_path,
        installment_term: outcome.installment_term,
        // 服务端用 due_now 按同一条公式重算余额与两套风险标签，不直接采信前端结果
        due_now: outcome.due_now,
        projected_min_balance: outcome.projected_min_balance,
        high_risk_choice: outcome.high_risk_choice,
        worst_balance_term: outcome.worst_balance_term,
        high_risk_term: outcome.high_risk_term,
        key_info_exposed: exposure.exposed,
        key_info_exposed_ms: exposedMs,
        changed_choice: selectionCount > 1,
        decision_time_ms: Date.now() - shownAt.current,
      });
      logEvent('submit_decision', scenario.scenario_id, {
        option: choice,
        key_info_exposed: exposure.exposed,
        key_info_exposed_ms: exposedMs,
      });
    } catch {
      setSubmitError('提交没有成功，请检查网络后再次点击提交。重复点击不会产生重复记录。');
    }
  }

  const selected = choice ? outcomeOf(choice) : null;

  return (
    <Screen title={scenario.title}>
      <Progress current={position} total={total} />

      {/* 商品信息：A 版与 B 版完全一致 */}
      <div className="product">
        <div className="product-top">
          <div>
            <p className="product-name">{scenario.product_name}</p>
            <p className="product-model">{scenario.product_model}</p>
          </div>
          <p className="product-price">{formatMoney(scenario.base_price)}</p>
        </div>
        <p className="product-installment">
          也可以分期：分 {scenario.installment_periods} 个月付，每月
          {formatMoney(scenario.installment_payment)}，加起来
          {formatMoney(scenario.installment_total)}
        </p>
      </div>

      {/*
        资金情况：第二轮两版都给，且默认展开。
        这些是情境设定的既有事实，不是产品算出来的东西，扣着不给会让对照组无法做任何预算判断。
        每一项都配一句大白话解释，两版文字完全相同。
      */}
      <div className="card">
        <h3 className="panel-title">假设你现在的钱是这样</h3>
        <Stat
          label="手上现在有"
          hint="随时能动用的钱"
          value={formatMoney(scenario.available_funds)}
        />
        <Stat
          label="每月到手"
          hint="工资、生活费、兼职加起来"
          value={formatMoney(scenario.monthly_income)}
        />
        <Stat
          label="每月必须花掉"
          hint="吃饭、房租、交通、话费这些省不掉的"
          value={formatMoney(scenario.necessary_expense_30d)}
        />
        <Stat
          label="所以每月能剩下"
          hint="到手的钱减掉必须花的"
          value={formatMoney(net)}
        />
        <Stat
          label="手上至少要留住"
          hint="应急的钱：生病、手机摔了、临时要用钱的时候得有。低于这个数，出点事就只能去借"
          value={formatMoney(scenario.emergency_reserve)}
          tone="reserve"
        />
      </div>

      <h2>你会怎么买</h2>

      {/*
        曝光观测挂在选项区，而不是选完之后才出现的摘要区：
        要测的是"做决定时有没有看到本版本的核心信息"，不是"决定之后有没有回看结果"。
        选项区从进入页面就存在，两版结构对等，只是里面的信息量不同。
      */}
      <div role="radiogroup" aria-label="购买方式" ref={exposure.ref}>
        {CHOICE_ORDER.map((c) => (
          <OptionCard
            key={c}
            title={CHOICE_LABELS[c]}
            headline={headlineFor(scenario, c)}
            selected={choice === c}
            onSelect={() => select(c)}
            detail={
              <OptionDetail
                scenario={scenario}
                choice={c}
                variant={variant}
                altPath={altPath}
                onAltPath={selectAltPath}
              />
            }
          />
        ))}
      </div>

      {submitError ? <p className="form-note">{submitError}</p> : null}

      {/*
        选定后的结果摘要。必须留在吸底的 .actions 之外：
        .actions 是 position: sticky; bottom: 0，把摘要放进去之后，
        B 版带完整分析区的摘要会比一屏还高，于是整个吸底块盖满屏幕、
        页面再也滚不动，提交按钮也被挤出可视区——"退不出去"就是这么来的。
        摘要随页面正常滚动，只有按钮吸底。
        曝光观测不在这里，见上方选项区的说明。
      */}
      {selected ? (
        <section className="summary" aria-label={SUMMARY_REGION_LABEL}>
          <div className="summary-head">
            <span className="summary-label">你选的是</span>
            <span className="summary-choice">{CHOICE_LABELS[selected.choice]}</span>
          </div>
          <div className="zones">
            <FactZone scenario={scenario} outcome={selected} />
            {isB ? <AnalysisZone scenario={scenario} outcome={selected} /> : null}
          </div>
        </section>
      ) : null}

      <div className="actions">
        <button type="button" className="btn" disabled={!choice || busy} onClick={handleSubmit}>
          {busy ? '提交中…' : '就这么选，下一题'}
        </button>
        <p className="actions-note">每题只能提交一次，交了就不能回来改了。</p>
      </div>
    </Screen>
  );
}

/**
 * 事实分区。两版都显示。
 * 只放"把页面上已有的数字做一次加减法"就能得到的内容，不含任何需要建模的推算。
 */
function FactZone({ scenario, outcome }: { scenario: ScenarioConfig; outcome: OptionOutcome }) {
  const isInstallment = outcome.payment_path === 'installment';
  return (
    <Zone title="这笔钱要怎么掏">
      <Stat label="现在就要掏" value={formatMoney(outcome.due_now)} />
      {outcome.choice !== 'not_now' ? (
        <Stat
          label="前前后后一共掏"
          hint="从现在到还完，加起来的总数"
          value={formatMoney(outcome.total_payment)}
        />
      ) : null}
      {isInstallment ? (
        <>
          <Stat
            label="比标价多掏"
            hint="分期要另外给的利息和手续费"
            value={formatMoney(outcome.total_interest)}
          />
          <Stat
            label="接下来每个月还"
            value={`${formatMoney(outcome.monthly_burden ?? 0)}，连还 ${outcome.installment_term} 个月`}
          />
        </>
      ) : null}
      {outcome.choice === 'alternative' ? (
        <Stat
          label="比原来那个省"
          value={formatMoney(scenario.base_price - scenario.alternative_price)}
        />
      ) : null}
    </Zone>
  );
}

/**
 * 分析分区。B 版专有。
 * 这里的每一项都需要建模或解方程才能得出，是产品真正提供的东西：
 * 折合年化要反解等额本息方程，完整还款期最低余额要做多月现金流模拟。
 */
function AnalysisZone({ scenario, outcome }: { scenario: ScenarioConfig; outcome: OptionOutcome }) {
  const isInstallment = outcome.payment_path === 'installment';
  return (
    <Zone title="以后手上还剩多少钱">
      <Stat
        hero
        tone="accent"
        label={`这样选，接下来 ${scenario.horizon_months} 个月里，手上最少的时候只剩`}
        value={formatMoney(outcome.worst_balance_term)}
      />
      <BalanceBar
        balance={outcome.worst_balance_term}
        reserve={scenario.emergency_reserve}
        ceiling={scenario.available_funds}
      />
      <Stat label="最紧的是哪个月" value={`第 ${outcome.worst_balance_month} 个月`} />
      <Stat
        tone="reserve"
        label="手上至少要留住"
        value={formatMoney(scenario.emergency_reserve)}
      />
      <Stat
        tone={outcome.high_risk_term ? 'risk' : 'safe'}
        label="这些钱够应急吗"
        hint={
          outcome.high_risk_term
            ? '最紧的那个月，手上的钱会低于要留住的应急钱'
            : '就算最紧的那个月，手上的钱也没有低于要留住的应急钱'
        }
        value={outcome.high_risk_term ? '不够了' : '够'}
      />
      {isInstallment ? (
        <Stat
          tone="cost"
          label="这样分期，相当于一年的利息是"
          hint="把多掏的钱换算成年利率，方便和别处的借钱成本比"
          value={outcome.annual_rate === null ? '—' : formatPercent(outcome.annual_rate)}
        />
      ) : null}
      {outcome.choice === 'save_then_buy' ? (
        <Stat
          label="照这个速度攒，大概要攒"
          hint="攒到买完还剩得下应急钱为止"
          value={
            outcome.months_to_save === null
              ? '每月剩不下钱，攒不出来'
              : `${outcome.months_to_save} 个月`
          }
        />
      ) : null}
    </Zone>
  );
}

/**
 * 余额条。用同一种中性青绿画所有情况，长度表示金额大小，绿色刻度标出应急储备位置。
 * 低于储备时不换色、不变红、不加图标——只是填充条没能越过那条刻度线。
 */
function BalanceBar({
  balance,
  reserve,
  ceiling,
}: {
  balance: number;
  reserve: number;
  ceiling: number;
}) {
  const span = Math.max(ceiling, reserve, balance, 1);
  const pct = Math.max(0, Math.min(100, (balance / span) * 100));
  const reservePct = Math.max(0, Math.min(100, (reserve / span) * 100));
  return (
    <div className="bar" aria-hidden="true">
      <div className="bar-fill" style={{ width: `${pct}%` }} />
      <div className="bar-mark" style={{ left: `${reservePct}%` }} />
    </div>
  );
}

/** 选项摘要行。两版完全相同，只含基础事实，不含任何推算结果。 */
function headlineFor(s: ScenarioConfig, c: FinalChoice) {
  switch (c) {
    case 'full_payment':
      return `现在一次性付 ${formatMoney(s.base_price)}`;
    case 'installment':
      return `分 ${s.installment_periods} 个月付，每月 ${formatMoney(s.installment_payment)}`;
    case 'save_then_buy':
      return '这个月先不花钱，攒够了再来买';
    case 'alternative':
      return `改买${s.alternative_name}，${formatMoney(s.alternative_price)}`;
    case 'not_now':
      return '这个月不花这笔钱，也不打算攒了买';
  }
}

/**
 * 选项内的常驻信息。第二轮不再折叠。
 * 事实行两版一致；替代项的支付方式切换是一次真实的选择，不是信息揭示，故保留为可交互。
 */
function OptionDetail({
  scenario,
  choice,
  variant,
  altPath,
  onAltPath,
}: {
  scenario: ScenarioConfig;
  choice: FinalChoice;
  variant: Variant;
  altPath: PaymentPath;
  onAltPath: (p: PaymentPath) => void;
}) {
  const isB = variant === 'B';
  const outcome = evaluateOption(
    scenario,
    choice,
    choice === 'alternative' ? altPath : 'full_payment',
  );

  const basic: [string, string][] = [];
  switch (choice) {
    case 'full_payment':
      basic.push(['现在就要掏', formatMoney(scenario.base_price)]);
      basic.push(['前前后后一共掏', formatMoney(scenario.base_price)]);
      break;
    case 'installment':
      basic.push(['现在就要掏（第一个月）', formatMoney(scenario.installment_payment)]);
      basic.push([
        '前前后后一共掏',
        `${formatMoney(scenario.installment_total)}（${scenario.installment_periods} 个月 × ${formatMoney(scenario.installment_payment)}）`,
      ]);
      basic.push([
        '比标价多掏',
        formatMoney(scenario.installment_total - scenario.base_price),
      ]);
      break;
    case 'save_then_buy':
      basic.push(['现在就要掏', formatMoney(0)]);
      basic.push(['东西标价', formatMoney(scenario.base_price)]);
      break;
    case 'alternative':
      basic.push(['改买', scenario.alternative_name]);
      basic.push(['标价', formatMoney(scenario.alternative_price)]);
      basic.push([
        '比原来那个省',
        formatMoney(scenario.base_price - scenario.alternative_price),
      ]);
      if (altPath === 'installment') {
        basic.push([
          '前前后后一共掏',
          `${formatMoney(scenario.alternative_installment_total)}（${scenario.alternative_installment_periods} 个月 × ${formatMoney(scenario.alternative_installment_payment)}）`,
        ]);
      } else {
        basic.push(['前前后后一共掏', formatMoney(scenario.alternative_price)]);
      }
      break;
    case 'not_now':
      basic.push(['现在就要掏', formatMoney(0)]);
      break;
  }

  return (
    <>
      {basic.map(([k, v]) => (
        <Stat key={k} label={k} value={v} />
      ))}

      {/*
        替代项的支付方式切换用 group + aria-pressed，而不是嵌套 radiogroup：
        默认展开之后，嵌套的 role="radio" 会被外层"购买方式"单选组一并收进去，
        既是无障碍语义错误，也会让按顺序取选项卡片的代码拿错元素。
      */}
      {choice === 'alternative' ? (
        <div className="segmented" role="group" aria-label="替代项支付方式">
          {(['full_payment', 'installment'] as PaymentPath[]).map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={altPath === p}
              data-selected={altPath === p}
              onClick={() => onAltPath(p)}
            >
              {p === 'full_payment' ? '一次付清' : '分期付'}
            </button>
          ))}
        </div>
      ) : null}

      {/* B 版在每个选项上直接给出完整还款期的最低余额，不需要任何点击 */}
      {isB ? (
        <Stat
          tone={outcome.high_risk_term ? 'risk' : 'safe'}
          label={`这 ${scenario.horizon_months} 个月里，手上最少时只剩`}
          value={formatMoney(outcome.worst_balance_term)}
        />
      ) : null}
    </>
  );
}
