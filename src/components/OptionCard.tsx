import type { ReactNode } from 'react';

/**
 * 选项卡片。A 版与 B 版共用同一个组件、同一套排版和同一个顺序，
 * 差异只来自 detail 里传入的信息量。不要给某个选项单独加样式或图标。
 */
export function OptionCard({
  title,
  headline,
  selected,
  onSelect,
  detail,
  detailOpen,
  onToggleDetail,
  detailLabel = '查看详情',
}: {
  title: string;
  headline: ReactNode;
  selected: boolean;
  onSelect: () => void;
  detail?: ReactNode;
  detailOpen?: boolean;
  onToggleDetail?: () => void;
  detailLabel?: string;
}) {
  return (
    <div className="option" data-selected={selected}>
      <div
        className="option-head"
        role="radio"
        tabIndex={0}
        aria-checked={selected}
        onClick={onSelect}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelect();
          }
        }}
      >
        <span className="option-mark" aria-hidden="true" />
        <span className="option-title">
          {title}
          <span className="option-headline">{headline}</span>
        </span>
      </div>

      {detail && onToggleDetail ? (
        <>
          <button type="button" className="detail-toggle" onClick={onToggleDetail}>
            {detailOpen ? '收起' : detailLabel}
          </button>
          {detailOpen ? <div className="option-detail">{detail}</div> : null}
        </>
      ) : null}
    </div>
  );
}
