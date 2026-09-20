import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildViews, DEFAULT_FILTER } from '../lib/metrics';
import type { AnalysisFilter } from '../lib/metrics';
import { createBackend } from '../lib/storage';
import type { DataBackend, StoredData } from '../lib/storage';
import { APP_VERSION } from '../config/experiment';
import {
  DEFAULT_RECORD_FILTER,
  MetricsPanel,
  OverviewPanel,
  ParticipantsPanel,
  RecordsPanel,
  ToolsPanel,
} from './panels';
import type { RecordFilter } from './panels';
import { authMode, checkSignedIn, isUsingDefaultPassphrase, signIn, signOut } from './auth';

type Tab = 'overview' | 'metrics' | 'records' | 'participants' | 'tools';

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: '总览' },
  { id: 'metrics', label: '主要指标' },
  { id: 'records', label: '原始记录' },
  { id: 'participants', label: '参与者明细' },
  { id: 'tools', label: '导出与撤回' },
];

export default function AdminApp() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    void checkSignedIn().then((ok) => {
      if (!cancelled) setSignedIn(ok);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (signedIn === null) return <p className="admin-note">正在确认登录状态…</p>;
  if (!signedIn) return <AdminLogin onSuccess={() => setSignedIn(true)} />;
  return (
    <AdminConsole
      onSignOut={() => {
        void signOut();
        setSignedIn(false);
      }}
    />
  );
}

/* ────────────────── 登录 ────────────────── */

function AdminLogin({ onSuccess }: { onSuccess: () => void }) {
  const mode = authMode();
  const [email, setEmail] = useState('');
  const [secret, setSecret] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function attempt() {
    setBusy(true);
    setError(null);
    const result = await signIn(mode === 'supabase' ? email : secret, secret);
    setBusy(false);
    if (result.ok) onSuccess();
    else setError(result.message ?? '登录失败。');
  }

  return (
    <div className="admin-login">
      <h1>管理员后台</h1>

      {mode === 'local' ? (
        <div className="admin-warning">
          <strong>这不是访问控制。</strong>
          口令在前端比对，打包后的 JS 里可以读到；数据也还在浏览器本地存储里，绕过本页即可读取。
          真实权限（管理员登录、RLS、参与者读不到他人数据）必须由 Supabase 提供。
          在那之前，不要用这套环境承载真实参与者数据。
        </div>
      ) : (
        <p className="admin-note">
          用你在 Supabase 里建的管理员邮箱密码登录。登录后还会核对 admin_users 表，
          不在表里的账号会被立刻登出。
        </p>
      )}

      {mode === 'supabase' ? (
        <input
          className="admin-input"
          type="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setError(null);
          }}
          placeholder="管理员邮箱"
          aria-label="管理员邮箱"
          autoComplete="username"
        />
      ) : null}

      <input
        className="admin-input"
        type="password"
        value={secret}
        onChange={(e) => {
          setSecret(e.target.value);
          setError(null);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void attempt();
        }}
        placeholder={mode === 'supabase' ? '密码' : '口令'}
        aria-label={mode === 'supabase' ? '管理员密码' : '管理员口令'}
        autoComplete="current-password"
      />

      {error ? <p className="admin-note">{error}</p> : null}
      {mode === 'local' && isUsingDefaultPassphrase() ? (
        <p className="admin-note">
          当前使用默认开发口令 <code>rongeheng-dev</code>。
          在 <code>.env.local</code> 里设置 <code>VITE_ADMIN_PASSPHRASE</code> 可以覆盖。
        </p>
      ) : null}

      <button type="button" className="btn" disabled={busy} onClick={() => void attempt()}>
        {busy ? '登录中…' : '进入'}
      </button>

      <p className="admin-note">
        <a href="#/">返回参与者页面</a>
      </p>
    </div>
  );
}

/* ────────────────── 控制台 ────────────────── */

function AdminConsole({ onSignOut }: { onSignOut: () => void }) {
  const backendRef = useRef<DataBackend | null>(null);
  if (!backendRef.current) backendRef.current = createBackend();
  const backend = backendRef.current;

  const [data, setData] = useState<StoredData | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [filter, setFilter] = useState<AnalysisFilter>(DEFAULT_FILTER);
  const [recordFilter, setRecordFilter] = useState<RecordFilter>(DEFAULT_RECORD_FILTER);

  const refresh = useCallback(() => {
    void backend.dump().then(setData);
  }, [backend]);

  useEffect(refresh, [refresh]);

  const views = useMemo(() => (data ? buildViews(data) : []), [data]);

  if (!data) return <p className="admin-note">正在读取…</p>;

  return (
    <div className="admin">
      <header className="admin-header">
        <div>
          <h1>管理员后台</h1>
          <p className="admin-note">
            数据通道 {backend.kind} · 网页版本 {APP_VERSION}
          </p>
        </div>
        <button type="button" className="btn btn--ghost admin-signout" onClick={onSignOut}>
          退出
        </button>
      </header>

      {backend.kind === 'local' ? (
        <div className="admin-warning">
          当前读的是<strong>这台浏览器本地</strong>的数据，不是集中数据库。
          它只反映在本机走查过的记录，不能用来统计真实参与者。
        </div>
      ) : null}

      <nav className="admin-tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            data-selected={tab === t.id}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <main className="admin-body">
        {tab === 'overview' ? <OverviewPanel data={data} /> : null}
        {tab === 'metrics' ? (
          <MetricsPanel views={views} filter={filter} onFilter={setFilter} />
        ) : null}
        {tab === 'records' ? (
          <RecordsPanel views={views} filter={recordFilter} onFilter={setRecordFilter} />
        ) : null}
        {tab === 'participants' ? <ParticipantsPanel views={views} /> : null}
        {tab === 'tools' ? (
          <ToolsPanel data={data} backend={backend} onChanged={refresh} />
        ) : null}
      </main>
    </div>
  );
}
