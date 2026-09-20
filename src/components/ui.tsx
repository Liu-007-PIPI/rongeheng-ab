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

/**
 * 指标色调。按【信息类型】分配，不按【选择好不好】分配——
 * 同一个指标换任何选项看都是同一个颜色，详见 styles.css 顶部的上色原则。
 *
 *   plain    默认主文字
 *   accent   青绿，用于剩余可用资金
 *   cost     琥珀，用于利率、利息与手续费
 *   reserve  绿色，用于应急储备这条固定参照线
 *   risk/safe  判定结果，默认不着色（由 --verdict-* 控制）
 */
export type StatTone = 'plain' | 'accent' | 'cost' | 'reserve' | 'risk' | 'safe';

/**
 * 标签 + 数值。默认左右排布；hero 为纵向排布的主指标，数字明显放大。
 * 标签与数值是相邻兄弟节点，测试可以用 label.nextElementSibling 取值。
 */
export function Stat({
  label,
  value,
  tone = 'plain',
  hero = false,
}: {
  label: ReactNode;
  value: ReactNode;
  tone?: StatTone;
  hero?: boolean;
}) {
  return (
    <div className={hero ? 'stat stat--hero' : 'stat'} data-tone={tone}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
    </div>
  );
}

/** 信息分区。用卡片层级和留白分组，而不是靠横向分割线。 */
export function Zone({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="zone">
      <h3 className="zone-title">{title}</h3>
      {children}
    </section>
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
