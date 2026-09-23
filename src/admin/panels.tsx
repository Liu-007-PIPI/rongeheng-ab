import { useMemo, useState } from 'react';
import { ACCESS_CODES } from '../config/accessCodes';
import { SCENARIOS } from '../config/scenarios';
import { buildTables, downloadCsv } from '../lib/csv';
import {
  applyFilter,
  computeAb,
  computeByScenario,
  computeOverview,
} from '../lib/metrics';
import type { AnalysisFilter, CohortMetrics, ParticipantView } from '../lib/metrics';
import { APP_VERSION, CURRENT_ROUND, ROUND_LABELS } from '../config/experiment';
import type { RoundKey } from '../config/experiment';
import type { DataBackend, StoredData, WithdrawalResult } from '../lib/storage';
import type { CodeType, ScenarioId, Variant } from '../lib/types';
import { CHOICE_LABELS } from '../lib/calc';
import { OPERATOR_ID } from './auth';

/* ────────────────── 展示辅助 ────────────────── */

/** 缺失值显示为「—」，绝不显示 0——交接文档 9.3 要求两者可区分。 */
function num(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return value.toFixed(digits);
}

function pct(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `${(value * 100).toFixed(1)}%`;
}

function seconds(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return '—';
  return `${(ms / 1000).toFixed(1)} 秒`;
}

/** 数据库存 UTC，界面显示本地时间（交接文档 9.2）。 */
function localTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('zh-CN');
}

const SCENARIO_TITLES: Record<string, string> = Object.fromEntries(
  Object.values(SCENARIOS).map((s) => [s.scenario_id, s.title]),
);

/* ────────────────── 总览 ────────────────── */

export function OverviewPanel({ data }: { data: StoredData }) {
  // 总览只统计当前轮。两轮情境参数不同，混在一起看会把招募进度看错。
  const overview = useMemo(
    () => computeOverview(data, ACCESS_CODES.length, CURRENT_ROUND),
    [data],
  );

  const cells: [string, string][] = [
    ['已登记匿名码', String(overview.issued_codes)],
    ['已开始', String(overview.started)],
    ['已完成', String(overview.completed)],
    ['进行中', String(overview.in_progress)],
    ['已撤回', String(overview.withdrawn)],
    ['正式 · 开始 / 完成', `${overview.formal_started} / ${overview.formal_completed}`],
    ['预试 · 开始 / 完成', `${overview.pilot_started} / ${overview.pilot_completed}`],
    ['完成数 A / B', `${overview.completed_a} / ${overview.completed_b}`],
  ];

  return (
    <>
      <p className="admin-note">
        以下数字只统计<strong>{ROUND_LABELS[CURRENT_ROUND]}</strong>
        （网页版本 {APP_VERSION}）。
        {overview.other_rounds > 0 ? (
          <>
            {' '}
            库里另有 {overview.other_rounds} 人属于更早的轮次，未计入本屏。
            两轮的情境参数不同，数据不可合并分析。
          </>
        ) : null}
      </p>
      <div className="admin-grid">
        {cells.map(([label, value]) => (
          <div className="admin-tile" key={label}>
            <span className="admin-tile-label">{label}</span>
            <span className="admin-tile-value">{value}</span>
          </div>
        ))}
      </div>
    </>
  );
}

/* ────────────────── 主要指标 ────────────────── */

export function MetricsPanel({
  views,
  filter,
  onFilter,
}: {
  views: ParticipantView[];
  filter: AnalysisFilter;
  onFilter: (f: AnalysisFilter) => void;
}) {
  const analysed = useMemo(() => applyFilter(views, filter), [views, filter]);
  const ab = useMemo(() => computeAb(analysed), [analysed]);
  const byScenario = useMemo(() => computeByScenario(analysed), [analysed]);

  const rows: [string, (m: CohortMetrics) => string][] = [
    ['参与者数', (m) => String(m.n_participants)],
    ['决策条数', (m) => String(m.n_decisions)],
    ['平均高风险比例', (m) => pct(m.mean_high_risk_ratio)],
    ['高风险比例中位数', (m) => pct(m.median_high_risk_ratio)],
    ['四分位 Q1 / Q3', (m) => `${pct(m.q1_high_risk_ratio)} / ${pct(m.q3_high_risk_ratio)}`],
    ['平均高风险情境数（满分 3）', (m) => num(m.mean_high_risk_count, 2)],
    ['至少一次高风险（30天口径）', (m) => `${m.any_high_risk_n} 人 · ${pct(m.any_high_risk_ratio)}`],
    ['平均高风险比例（完整还款期）', (m) => pct(m.mean_high_risk_term_ratio)],
    ['至少一次高风险（完整期）', (m) => `${m.any_high_risk_term_n} 人 · ${pct(m.any_high_risk_term_ratio)}`],
    ['分期选择率', (m) => pct(m.installment_rate)],
    ['暂缓购买率（储蓄+暂不）', (m) => pct(m.defer_rate)],
    ['低价替代选择率', (m) => pct(m.alternative_choice_rate)],
    ['提交前改过选择', (m) => pct(m.changed_choice_rate)],
    ['决策时间中位数', (m) => seconds(m.median_decision_time_ms)],
    ['关键信息有效曝光率', (m) => pct(m.key_info_exposure_rate)],
    ['关键信息曝光时长中位数', (m) => seconds(m.median_key_info_exposed_ms)],
    ['注意力检查通过', (m) => `${m.attention_pass_n} 人 · ${pct(m.attention_pass_rate)}`],
  ];

  return (
    <>
      <FilterBar filter={filter} onFilter={onFilter} />

      {filter.round === 'all' ? (
        <p className="admin-note">
          <strong>当前把两轮混在一起算。</strong>
          两轮的情境参数不同（第一轮没有月收入字段，风险结构也不一样），
          这里的比例不能用来写任何结论，只能用于核对数据是否都在。
        </p>
      ) : null}

      <p className="admin-note">
        主要指标在<strong>参与者层面</strong>计算：个人高风险比例 = 三个情境中高风险选择数 ÷ 3。
        {analysed.length} 人进入当前分析集，不是 {analysed.reduce((n, v) => n + v.decisions.length, 0)} 个独立样本。
      </p>

      <table className="admin-table">
        <thead>
          <tr>
            <th>指标</th>
            <th>A 组</th>
            <th>B 组</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, get]) => (
            <tr key={label}>
              <td>{label}</td>
              <td>{get(ab.a)}</td>
              <td>{get(ab.b)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="admin-callout">
        <span className="admin-tile-label">绝对差（B 组平均 − A 组平均）</span>
        <span className="admin-tile-value">{pct(ab.absolute_difference)}</span>
        <p className="admin-note">
          负值代表 B 版观察到更少的高风险选择。这只是点估计。
          置换检验、Mann-Whitney U 和 bootstrap 置信区间属于采集结束、版本冻结之后
          一次性运行的分析脚本，不在这个随时可刷新的页面里做——
          边采边看容易提前停止或挑口径（交接文档 10.3、10.5）。
        </p>
      </div>

      <h3 className="admin-subtitle">分情境</h3>
      <table className="admin-table">
        <thead>
          <tr>
            <th>情境</th>
            <th>决策数</th>
            <th>高风险率</th>
            <th>决策时间中位数</th>
          </tr>
        </thead>
        <tbody>
          {byScenario.map((s) => (
            <tr key={s.scenario_id}>
              <td>{SCENARIO_TITLES[s.scenario_id] ?? s.scenario_id}</td>
              <td>{s.n_decisions}</td>
              <td>{pct(s.high_risk_rate)}</td>
              <td>{seconds(s.median_decision_time_ms)}</td>
            </tr>
          ))}
          {byScenario.length === 0 ? (
            <tr>
              <td colSpan={4}>当前分析集没有数据</td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </>
  );
}

function FilterBar({
  filter,
  onFilter,
}: {
  filter: AnalysisFilter;
  onFilter: (f: AnalysisFilter) => void;
}) {
  const types: { value: CodeType | 'all'; label: string }[] = [
    { value: 'formal', label: '仅正式' },
    { value: 'pilot', label: '仅预试' },
    { value: 'all', label: '全部' },
  ];
  const rounds: { value: RoundKey | 'all'; label: string }[] = [
    { value: 'round2', label: ROUND_LABELS.round2 },
    { value: 'round1', label: ROUND_LABELS.round1 },
    { value: 'all', label: '不分轮次' },
  ];
  return (
    <div className="admin-filters">
      {/*
        轮次放在最前面。两轮的情境参数不同，跨轮合并出来的比例没有解释力，
        所以"不分轮次"只是为了核对数据是否都在，不能拿它的数字写结论。
      */}
      <div className="segmented" role="radiogroup" aria-label="采集轮次">
        {rounds.map((r) => (
          <button
            key={r.value}
            type="button"
            role="radio"
            aria-checked={filter.round === r.value}
            data-selected={filter.round === r.value}
            onClick={() => onFilter({ ...filter, round: r.value })}
          >
            {r.label}
          </button>
        ))}
      </div>
      <div className="segmented" role="radiogroup" aria-label="样本范围">
        {types.map((t) => (
          <button
            key={t.value}
            type="button"
            role="radio"
            aria-checked={filter.codeType === t.value}
            data-selected={filter.codeType === t.value}
            onClick={() => onFilter({ ...filter, codeType: t.value })}
          >
            {t.label}
          </button>
        ))}
      </div>
      <label className="admin-checkbox">
        <input
          type="checkbox"
          checked={filter.completedOnly}
          onChange={(e) => onFilter({ ...filter, completedOnly: e.target.checked })}
        />
        <span>只统计完成三个情境的会话</span>
      </label>
    </div>
  );
}

/* ────────────────── 原始记录 ────────────────── */

export interface RecordFilter {
  round: RoundKey | 'all';
  codeType: CodeType | 'all';
  variant: Variant | 'all';
  completion: 'all' | 'completed' | 'in_progress';
  scenario: ScenarioId | 'all';
}

export const DEFAULT_RECORD_FILTER: RecordFilter = {
  round: CURRENT_ROUND,
  codeType: 'all',
  variant: 'all',
  completion: 'all',
  scenario: 'all',
};

export function RecordsPanel({
  views,
  filter,
  onFilter,
}: {
  views: ParticipantView[];
  filter: RecordFilter;
  onFilter: (f: RecordFilter) => void;
}) {
  const rows = useMemo(() => {
    const matched = views.filter((v) => {
      if (filter.round !== 'all' && v.round !== filter.round) return false;
      if (filter.codeType !== 'all' && v.participant.code_type !== filter.codeType) return false;
      if (filter.variant !== 'all' && v.participant.variant !== filter.variant) return false;
      if (filter.completion === 'completed' && !v.completed) return false;
      if (filter.completion === 'in_progress' && v.completed) return false;
      return true;
    });
    return matched.flatMap((v) =>
      v.decisions
        .filter((d) => filter.scenario === 'all' || d.scenario_id === filter.scenario)
        .map((d) => ({ view: v, decision: d })),
    );
  }, [views, filter]);

  const selects: {
    label: string;
    value: string;
    options: [string, string][];
    onChange: (v: string) => void;
  }[] = [
    {
      label: '轮次',
      value: filter.round,
      options: [
        ['round2', ROUND_LABELS.round2],
        ['round1', ROUND_LABELS.round1],
        ['other', ROUND_LABELS.other],
        ['all', '全部'],
      ],
      onChange: (v) => onFilter({ ...filter, round: v as RecordFilter['round'] }),
    },
    {
      label: '样本',
      value: filter.codeType,
      options: [['all', '全部'], ['formal', '正式'], ['pilot', '预试']],
      onChange: (v) => onFilter({ ...filter, codeType: v as RecordFilter['codeType'] }),
    },
    {
      label: '分组',
      value: filter.variant,
      options: [['all', '全部'], ['A', 'A'], ['B', 'B']],
      onChange: (v) => onFilter({ ...filter, variant: v as RecordFilter['variant'] }),
    },
    {
      label: '完成情况',
      value: filter.completion,
      options: [['all', '全部'], ['completed', '已完成'], ['in_progress', '未完成']],
      onChange: (v) => onFilter({ ...filter, completion: v as RecordFilter['completion'] }),
    },
    {
      label: '情境',
      value: filter.scenario,
      options: [
        ['all', '全部'],
        ...Object.values(SCENARIOS).map((s) => [s.scenario_id, s.title] as [string, string]),
      ],
      onChange: (v) => onFilter({ ...filter, scenario: v as RecordFilter['scenario'] }),
    },
  ];

  return (
    <>
      <div className="admin-filters">
        {selects.map((s) => (
          <label className="admin-select" key={s.label}>
            <span>{s.label}</span>
            <select value={s.value} onChange={(e) => s.onChange(e.target.value)}>
              {s.options.map(([v, l]) => (
                <option value={v} key={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>

      <p className="admin-note">
        共 {rows.length} 条决策。表格只读，后台不提供任何修改参与者答案的入口（交接文档 8.8）。
      </p>

      <div className="admin-scroll">
        <table className="admin-table">
          <thead>
            <tr>
              <th>匿名码</th>
              <th>组</th>
              <th>样本</th>
              <th>情境</th>
              <th>次序</th>
              <th>最终选择</th>
              <th>30天余额</th>
              <th>30天风险</th>
              <th>期内最低</th>
              <th>完整期风险</th>
              <th>关键信息曝光</th>
              <th>改过</th>
              <th>耗时</th>
              <th>提交时间</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ view, decision }) => (
              <tr key={decision.decision_id}>
                <td>{view.participant.access_code_label}</td>
                <td>{view.participant.variant}</td>
                <td>{view.participant.code_type === 'pilot' ? '预试' : '正式'}</td>
                <td>{SCENARIO_TITLES[decision.scenario_id] ?? decision.scenario_id}</td>
                <td>{decision.scenario_position}</td>
                <td>{CHOICE_LABELS[decision.final_choice]}</td>
                <td>{decision.projected_min_balance}</td>
                <td>{decision.high_risk_choice ? '是' : '否'}</td>
                <td>{decision.worst_balance_term}</td>
                <td>{decision.high_risk_term ? '是' : '否'}</td>
                <td>{decision.key_info_exposed ? '是' : '否'}</td>
                <td>{decision.changed_choice ? '是' : '否'}</td>
                <td>{seconds(decision.decision_time_ms)}</td>
                <td>{localTime(decision.submitted_at)}</td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={14}>没有符合条件的记录</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </>
  );
}

/* ────────────────── 参与者明细 ────────────────── */

export function ParticipantsPanel({ views }: { views: ParticipantView[] }) {
  return (
    <>
      <p className="admin-note">
        只显示匿名码与匿名基线字段。系统从不采集姓名、手机号、真实账户或设备标识。
        本表列出库里的全部参与者，<strong>轮次</strong>一列标明各自属于哪一轮。
      </p>
      <div className="admin-scroll">
        <table className="admin-table">
          <thead>
            <tr>
              <th>匿名码</th>
              <th>轮次</th>
              <th>组</th>
              <th>样本</th>
              <th>状态</th>
              <th>年龄段</th>
              <th>身份</th>
              <th>可支配区间</th>
              <th>分期经历</th>
              <th>近一年大额消费</th>
              <th>已答情境</th>
              <th>开始时间</th>
            </tr>
          </thead>
          <tbody>
            {views.map((v) => (
              <tr key={v.participant.participant_id}>
                <td>{v.participant.access_code_label}</td>
                <td>{ROUND_LABELS[v.round]}</td>
                <td>{v.participant.variant}</td>
                <td>{v.participant.code_type === 'pilot' ? '预试' : '正式'}</td>
                <td>{v.withdrawn ? '已撤回' : v.completed ? '已完成' : '进行中'}</td>
                <td>{v.participant.baseline.age_group || '—'}</td>
                <td>{v.participant.baseline.role_status || '—'}</td>
                <td>{v.participant.baseline.disposable_funds_band || '—'}</td>
                <td>{v.participant.baseline.installment_experience || '—'}</td>
                <td>
                  {v.participant.baseline.recent_large_purchase === null
                    ? '—'
                    : v.participant.baseline.recent_large_purchase
                      ? '有'
                      : '没有'}
                </td>
                <td>{v.decisions.length} / 3</td>
                <td>{localTime(v.session?.started_at)}</td>
              </tr>
            ))}
            {views.length === 0 ? (
              <tr>
                <td colSpan={12}>还没有参与者记录</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </>
  );
}

/* ────────────────── 导出与撤回 ────────────────── */

export function ToolsPanel({
  data,
  backend,
  onChanged,
}: {
  data: StoredData;
  backend: DataBackend;
  onChanged: () => void;
}) {
  const tables = useMemo(() => buildTables(data), [data]);
  const [code, setCode] = useState('');
  const [note, setNote] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<WithdrawalResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleWithdraw() {
    setError(null);
    try {
      const r = await backend.withdrawByCode(code, OPERATOR_ID, note);
      setResult(r);
      setConfirming(false);
      setCode('');
      setNote('');
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : '撤回失败');
      setConfirming(false);
    }
  }

  return (
    <>
      <h3 className="admin-subtitle">导出 CSV</h3>
      <p className="admin-note">
        UTF-8 带 BOM，Excel 双击打开中文不乱码；时间为 UTC ISO 8601；布尔为 TRUE / FALSE；
        缺失值为空，不写 0。四张核心表可通过 participant_id 与 session_id 关联。
      </p>
      <div className="admin-export">
        {tables.map((t) => (
          <button
            key={t.name}
            type="button"
            className="btn btn--ghost"
            onClick={() => downloadCsv(t)}
          >
            {t.name}
            <span className="admin-count">{t.rows.length} 行</span>
          </button>
        ))}
      </div>

      <h3 className="admin-subtitle">按匿名码撤回</h3>
      <p className="admin-note">
        删除该匿名码对应的参与者、会话、决策和事件，并把匿名码标记为 withdrawn。
        撤回日志只留匿名码与处理时间，不保留任何实验答案。此操作不可撤销。
      </p>

      <div className="admin-withdraw">
        <input
          className="admin-input"
          value={code}
          onChange={(e) => {
            setCode(e.target.value);
            setConfirming(false);
            setResult(null);
          }}
          placeholder="匿名码，例如 A001"
          aria-label="要撤回的匿名码"
        />
        <input
          className="admin-input"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="处理说明（可选，勿写参与者身份）"
          aria-label="处理说明"
        />

        {!confirming ? (
          <button
            type="button"
            className="btn btn--ghost"
            disabled={code.trim().length === 0}
            onClick={() => setConfirming(true)}
          >
            撤回这个匿名码
          </button>
        ) : (
          <div className="admin-confirm">
            <p>
              确认删除 <strong>{code.trim().toUpperCase()}</strong> 的全部关联记录？此操作不可撤销。
            </p>
            <div className="admin-confirm-actions">
              <button type="button" className="btn btn--ghost" onClick={() => setConfirming(false)}>
                取消
              </button>
              <button type="button" className="btn" onClick={handleWithdraw}>
                确认删除
              </button>
            </div>
          </div>
        )}

        {error ? <p className="admin-note">{error}</p> : null}
        {result ? (
          <p className="admin-note">
            已删除：参与者 {result.participants} 条、会话 {result.sessions} 条、
            决策 {result.decisions} 条、事件 {result.events} 条。匿名码已标记为 withdrawn。
          </p>
        ) : null}
      </div>

      {data.withdrawals.length > 0 ? (
        <>
          <h3 className="admin-subtitle">撤回日志</h3>
          <div className="admin-scroll">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>匿名码</th>
                  <th>处理时间</th>
                  <th>操作者</th>
                  <th>说明</th>
                </tr>
              </thead>
              <tbody>
                {data.withdrawals.map((w) => (
                  <tr key={w.id}>
                    <td>{w.access_code_label}</td>
                    <td>{localTime(w.processed_at)}</td>
                    <td>{w.processed_by}</td>
                    <td>{w.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </>
  );
}
