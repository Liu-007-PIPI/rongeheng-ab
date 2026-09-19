import type { ReactNode } from 'react';
import { SIMULATION_NOTICE } from '../config/scenarios';

/** 每一屏顶部固定的模拟数据声明。所有页面共用同一段文案。 */
export function SimBanner() {
  return <div className="sim-banner">{SIMULATION_NOTICE}</div>;
}

export function Screen({
  title,
  lede,
  children,
}: {
  title: string;
  lede?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="screen">
      <h1>{title}</h1>
      {lede ? <p className="lede">{lede}</p> : null}
      {children}
    </section>
  );
}

export function Progress({ current, total }: { current: number; total: number }) {
  const pct = Math.max(0, Math.min(100, (current / total) * 100));
  return (
    <div className="progress">
      <span>
        情境 {current} / {total}
      </span>
      <span className="progress-track">
        <span className="progress-fill" style={{ width: `${pct}%` }} />
      </span>
    </div>
  );
}

/** 键值信息行。所有数值使用同一种中性样式，不按好坏着色。 */
export function InfoRow({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div className="info-row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

export function ChipGroup<T extends string>({
  options,
  value,
  onChange,
  name,
}: {
  options: { value: T; label: string }[];
  value: T | '';
  onChange: (value: T) => void;
  name: string;
}) {
  return (
    <div className="chips" role="radiogroup" aria-label={name}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="radio"
          aria-checked={value === opt.value}
          className="chip"
          data-selected={value === opt.value}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
