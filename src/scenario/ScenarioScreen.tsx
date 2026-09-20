import { useEffect, useMemo, useRef, useState } from 'react';
import { OptionCard } from '../components/OptionCard';
import { Progress, Screen, Stat, Zone } from '../components/ui';
import { CHOICE_LABELS, CHOICE_ORDER, evaluateOption, monthlySurplus } from '../lib/calc';
import { formatMoney, formatPercent } from '../lib/money';
import type { FinalChoice, OptionOutcome, PaymentPath, ScenarioConfig, Variant } from '../lib/types';
import { useExperiment } from '../state/experiment';

/** 需要计入 viewed_total_cost 的选项：详情中含总支付或长期成本。 */
const COST_BEARING: FinalChoice[] = ['full_payment', 'installment', 'alternative'];

const SUMMARY_REGION_LABEL = '当前选择的测算结果';

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
  const [openDetails, setOpenDetails] = useState<FinalChoice[]>([]);
  const [cashflowOpen, setCashflowOpen] = useState(false);
  const [viewedCashflow, setViewedCashflow] = useState(false);
  const [viewedTotalCost, setViewedTotalCost] = useState(false);
  const [clickedLowerPrice, setClickedLowerPrice] = useState(false);
  const [selectionCount, setSelectionCount] = useState(0);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const shownAt = useRef<number>(Date.now());

  // 换到下一个情境时重置全部界面状态与计时
  useEffect(() => {
    setChoice(null);
    setAltPath('full_payment');
    setOpenDetails([]);
    setCashflowOpen(false);
    setViewedCashflow(false);
    setViewedTotalCost(false);
    setClickedLowerPrice(false);
    setSelectionCount(0);
    setSubmitError(null);
    shownAt.current = Date.now();
    logEvent('scenario_shown', scenario.scenario_id, { position });
    // logEvent 依赖当前会话，故只按情境变化触发
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenario.scenario_id, position]);

  const isB = variant === 'B';
  const surplus = useMemo(() => monthlySurplus(scenario), [scenario]);

  const outcomeOf = (c: FinalChoice) =>
    evaluateOption(scenario, c, c === 'alternative' ? altPath : 'full_payment');

  function toggleDetail(c: FinalChoice) {
    const willOpen = !openDetails.includes(c);
    setOpenDetails((prev) => (willOpen ? [...prev, c] : prev.filter((x) => x !== c)));
    if (!willOpen) return;

    if (c === 'alternative') {
      setClickedLowerPrice(true);
      logEvent('open_alternative', scenario.scenario_id, {});
    }
    if (isB && COST_BEARING.includes(c)) {
      setViewedTotalCost(true);
      logEvent('view_total_cost', scenario.scenario_id, { option: c });
    }
  }

  function toggleCashflow() {
    const willOpen = !cashflowOpen;
    setCashflowOpen(willOpen);
    if (willOpen) {
      setViewedCashflow(true);
      logEvent('expand_cashflow', scenario.scenario_id, {});
    }
  }

  function select(c: FinalChoice) {
    setChoice(c);
    setSelectionCount((n) => n + 1);
    logEvent('select_option', scenario.scenario_id, { option: c, path: c === 'alternative' ? altPath : null });
  }

  function selectAltPath(p: PaymentPath) {
    setAltPath(p);
    if (choice === 'alternative') {
      setSelectionCount((n) => n + 1);
      logEvent('select_option', scenario.scenario_id, { option: 'alternative', path: p });
    }
  }

  async function handleSubmit() {
    if (!choice || busy) return;
    setSubmitError(null);
    const outcome = outcomeOf(choice);
    try {
      await submitDecision({
        scenario_id: scenario.scenario_id,
        scenario_position: position,
        final_choice: choice,
        selected_payment_path: outcome.payment_path,
        installment_term: outcome.installment_term,
        projected_min_balance: outcome.projected_min_balance,
        high_risk_choice: outcome.high_risk_choice,
        viewed_cashflow: isB ? viewedCashflow : false,
        viewed_total_cost: isB ? viewedTotalCost : false,
        clicked_lower_price: clickedLowerPrice,
        changed_choice: selectionCount > 1,
        decision_time_ms: Date.now() - shownAt.current,
        submitted_at: new Date().toISOString(),
      });
      logEvent('submit_decision', scenario.scenario_id, { option: choice });
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
          分期 {scenario.installment_periods} 期 · 每期 {formatMoney(scenario.installment_payment)}
        </p>
      </div>

      {/* 情境设定：两版都给出可自由使用资金，否则无法做任何预算判断 */}
      <div className="wallet">
        <span className="wallet-label">你现在可自由支配</span>
        <span className="wallet-value">{formatMoney(scenario.available_funds)}</span>
      </div>

      {/* 现金流模块：仅 B 版 */}
      {isB ? (
        <div className="card">
          <button
            type="button"
            className="panel-toggle"
            onClick={toggleCashflow}
            aria-expanded={cashflowOpen}
          >
            <span>{cashflowOpen ? '收起你的资金情况' : '查看你的资金情况'}</span>
            <span className="chevron" data-open={cashflowOpen} aria-hidden="true" />
          </button>
          {cashflowOpen ? (
            <div className="mt-10">
              <Stat label="当前可自由使用资金" value={formatMoney(scenario.available_funds)} />
              <Stat label="未来 30 天必要支出" value={formatMoney(scenario.necessary_expense_30d)} />
              <Stat
                label="你设定的最低应急储备"
                value={formatMoney(scenario.emergency_reserve)}
                tone="reserve"
              />
              <Stat label="扣除支出与储备后可动用" value={formatMoney(surplus)} />
            </div>
          ) : null}
        </div>
      ) : null}

      <h2>你会怎么做</h2>

      <div role="radiogroup" aria-label="购买方式">
        {CHOICE_ORDER.map((c) => (
          <OptionCard
            key={c}
            title={CHOICE_LABELS[c]}
            headline={headlineFor(scenario, c)}
            selected={choice === c}
            onSelect={() => select(c)}
            detailOpen={openDetails.includes(c)}
            onToggleDetail={() => toggleDetail(c)}
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

      <div className="actions">
        {/* 选定后的结果摘要。A 版只回显选择，B 版另给"余额安全"分区。 */}
        {selected ? (
          <section className="summary" aria-label={SUMMARY_REGION_LABEL}>
            <div className="summary-head">
              <span className="summary-label">你当前的选择</span>
              <span className="summary-choice">{CHOICE_LABELS[selected.choice]}</span>
            </div>
            {isB ? (
              <div className="zones">
                <BalanceZone scenario={scenario} outcome={selected} />
              </div>
            ) : null}
          </section>
        ) : null}

        <button type="button" className="btn" disabled={!choice || busy} onClick={handleSubmit}>
          {busy ? '提交中…' : '提交这个情境的选择'}
        </button>
        <p className="actions-note">每个情境只能提交一次，提交后无法返回修改。</p>
      </div>
    </Screen>
  );
}

/** 余额安全分区。B 版专有。 */
function BalanceZone({
  scenario,
  outcome,
}: {
  scenario: ScenarioConfig;
  outcome: OptionOutcome;
}) {
  return (
    <Zone title="余额安全">
      <Stat
        hero
        tone="accent"
        label="付款后剩余可用资金"
        value={formatMoney(outcome.remaining_funds)}
      />
      <BalanceBar
        balance={outcome.projected_min_balance}
        reserve={scenario.emergency_reserve}
        ceiling={scenario.available_funds}
      />
      <Stat
        label="再扣除未来 30 天必要支出后"
        value={formatMoney(outcome.projected_min_balance)}
      />
      <Stat
        tone="reserve"
        label="你设定的最低应急储备"
        value={formatMoney(scenario.emergency_reserve)}
      />
      <Stat
        tone={outcome.high_risk_choice ? 'risk' : 'safe'}
        label="两者相比"
        value={outcome.high_risk_choice ? '低于应急储备' : '不低于应急储备'}
      />
    </Zone>
  );
}

/**
 * 成本分区。B 版专有。分期路径展示年化利率与利息，一次性路径只展示总支付——
 * 与改版前 B 版详情里的信息条目一一对应，没有增减。
 */
function CostZone({ outcome }: { outcome: OptionOutcome }) {
  const isInstallment = outcome.payment_path === 'installment';
  return (
    <Zone title={isInstallment ? '分期成本' : '支付成本'}>
      {isInstallment ? (
        <>
          <Stat
            hero
            tone="cost"
            label="折合年化利率"
            value={outcome.annual_rate === null ? '—' : formatPercent(outcome.annual_rate)}
          />
          <Stat tone="cost" label="利息与手续费" value={formatMoney(outcome.total_interest)} />
          <Stat
            label="之后每月固定负担"
            value={`${formatMoney(outcome.monthly_burden ?? 0)} × ${outcome.installment_term} 期`}
          />
        </>
      ) : null}
      <Stat label="该路径总支付" value={formatMoney(outcome.total_payment)} />
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
      return `一次性支付 ${formatMoney(s.base_price)}`;
    case 'installment':
      return `${s.installment_periods} 期 × ${formatMoney(s.installment_payment)}`;
    case 'save_then_buy':
      return '本月不付款，之后再购买';
    case 'alternative':
      return `${s.alternative_name} · ${formatMoney(s.alternative_price)}`;
    case 'not_now':
      return '本月不付款';
  }
}

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
  const outcome = evaluateOption(scenario, choice, choice === 'alternative' ? altPath : 'full_payment');

  const basic: [string, string][] = [];
  switch (choice) {
    case 'full_payment':
      basic.push(['支付方式', '一次付清']);
      basic.push(['本次需支付', formatMoney(scenario.base_price)]);
      break;
    case 'installment':
      basic.push(['分期期数', `${scenario.installment_periods} 期`]);
      basic.push(['每期金额', formatMoney(scenario.installment_payment)]);
      basic.push(['本次需支付（首期）', formatMoney(scenario.installment_payment)]);
      break;
    case 'save_then_buy':
      basic.push(['本次需支付', formatMoney(0)]);
      basic.push(['商品价格', formatMoney(scenario.base_price)]);
      break;
    case 'alternative':
      basic.push(['替代项', scenario.alternative_name]);
      basic.push(['价格', formatMoney(scenario.alternative_price)]);
      basic.push([
        '分期',
        `${scenario.alternative_installment_periods} 期 × ${formatMoney(scenario.alternative_installment_payment)}`,
      ]);
      break;
    case 'not_now':
      basic.push(['本次需支付', formatMoney(0)]);
      break;
  }

  // 改版前 B 版对"暂不购买"以外的每个选项都展示总支付，这里保持一致
  const showCost = choice !== 'not_now';

  return (
    <>
      {basic.map(([k, v]) => (
        <Stat key={k} label={k} value={v} />
      ))}

      {choice === 'alternative' ? (
        <div className="segmented" role="radiogroup" aria-label="替代项支付方式">
          {(['full_payment', 'installment'] as PaymentPath[]).map((p) => (
            <button
              key={p}
              type="button"
              role="radio"
              aria-checked={altPath === p}
              data-selected={altPath === p}
              onClick={() => onAltPath(p)}
            >
              {p === 'full_payment' ? '全款' : '分期'}
            </button>
          ))}
        </div>
      ) : null}

      {isB ? (
        <div className="zones">
          <BalanceZone scenario={scenario} outcome={outcome} />
          {showCost ? <CostZone outcome={outcome} /> : null}
          {choice === 'save_then_buy' ? (
            <Zone title="储蓄路径">
              <Stat
                label="按当前可动用金额攒够约需"
                value={
                  outcome.months_to_save === null
                    ? '当前结余为零或为负'
                    : `${outcome.months_to_save} 个月`
                }
              />
            </Zone>
          ) : null}
          {choice === 'alternative' ? (
            <Zone title="与原商品相比">
              <Stat
                label="价格相差"
                value={formatMoney(scenario.base_price - scenario.alternative_price)}
              />
            </Zone>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
