import { useRef, useState } from 'react';
import { TIER_COLORS, type Tier } from '../../lib/tier/model';

type TierHeaderProps = {
  tier: Tier;
  /** Position in the tier list; drives the up/down disabled states. */
  index: number;
  count: number;
  onChangeName: (id: string, name: string) => void;
  onChangeColor: (id: string, color: string) => void;
  onMove: (id: string, delta: -1 | 1) => void;
  onRemove: () => void;
  disabledRemove: boolean;
};

/**
 * The narrow left column of a tier row (64px on phones, 88px from `md`):
 * colour swatch, editable name, and a 「设置」 panel with presets, reorder and
 * delete. The panel is a native `<details>` so it needs no focus management,
 * and its 4-column palette still fits inside the 88px column.
 */
export function TierHeader({
  tier,
  index,
  count,
  onChangeName,
  onChangeColor,
  onMove,
  onRemove,
  disabledRemove,
}: TierHeaderProps) {
  const [editing, setEditing] = useState(false);
  // `null` means "mirror `tier.name`"; a string is the in-progress edit, which
  // may legitimately be empty while the user clears the field.
  const [draft, setDraft] = useState<string | null>(null);
  const skipBlur = useRef(false);
  const removeHintId = `tier-remove-hint-${tier.id}`;

  const commit = (): void => {
    const next = (draft ?? tier.name).trim();
    setDraft(null);
    setEditing(false);
    if (next !== '') {
      onChangeName(tier.id, next);
    }
  };

  const cancel = (): void => {
    setDraft(null);
    setEditing(false);
  };

  return (
    <div
      className="flex flex-col gap-1.5 rounded-lg border border-[color:var(--bl-border)] p-1.5"
      style={{
        borderLeft: `6px solid ${tier.color}`,
        backgroundColor: `color-mix(in srgb, ${tier.color} 16%, transparent)`,
      }}
    >
      <input
        type="color"
        value={tier.color}
        aria-label={`${tier.name} 档颜色`}
        onChange={(event) => onChangeColor(tier.id, event.target.value)}
        className="h-8 w-full cursor-pointer rounded border border-[color:var(--bl-border)] bg-transparent p-0.5"
      />

      {editing ? (
        <input
          autoFocus
          value={draft ?? tier.name}
          aria-label={`档位名称 ${tier.name}`}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              skipBlur.current = false;
              commit();
            } else if (event.key === 'Escape') {
              event.preventDefault();
              skipBlur.current = true;
              cancel();
            }
          }}
          onBlur={() => {
            if (skipBlur.current) {
              skipBlur.current = false;
              return;
            }
            commit();
          }}
          className="min-h-8 w-full rounded border border-[color:var(--bl-accent)] bg-[var(--bl-bg)] px-1 text-sm font-semibold text-[var(--bl-text)]"
        />
      ) : (
        <button
          type="button"
          aria-label={`重命名档位 ${tier.name}`}
          onClick={() => {
            setDraft(null);
            setEditing(true);
          }}
          title="点击改名"
          className="min-h-8 w-full truncate rounded px-1 text-left text-sm font-semibold text-[var(--bl-text)] hover:bg-black/20"
        >
          {tier.name}
        </button>
      )}

      <details className="relative">
        <summary
          aria-label={`${tier.name} 档位设置`}
          className="grid min-h-9 cursor-pointer list-none place-items-center rounded border border-[color:var(--bl-border)] text-[11px] font-medium text-[var(--bl-text)] marker:hidden hover:bg-black/20"
        >
          设置
        </summary>

        <div className="absolute left-0 top-full z-20 mt-1 flex w-48 flex-col gap-2 rounded-lg border border-[color:var(--bl-border-strong)] bg-[var(--bl-panel)] p-2 shadow-xl">
          <div className="flex flex-col gap-1">
            <p className="text-[11px] text-[var(--bl-muted)]">预设颜色</p>
            <div className="grid grid-cols-4 gap-1">
              {TIER_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  aria-label={`颜色 ${color}`}
                  aria-pressed={tier.color === color}
                  onClick={() => onChangeColor(tier.id, color)}
                  style={{ backgroundColor: color }}
                  className={
                    tier.color === color
                      ? 'h-8 w-full rounded border-2 border-white'
                      : 'h-8 w-full rounded border border-transparent'
                  }
                />
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <button
              type="button"
              onClick={() => onMove(tier.id, -1)}
              disabled={index === 0}
              className="min-h-9 rounded border border-[color:var(--bl-border)] px-2 text-left text-xs text-[var(--bl-text)] hover:bg-[var(--bl-panel-hover)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              上移
            </button>
            <button
              type="button"
              onClick={() => onMove(tier.id, 1)}
              disabled={index === count - 1}
              className="min-h-9 rounded border border-[color:var(--bl-border)] px-2 text-left text-xs text-[var(--bl-text)] hover:bg-[var(--bl-panel-hover)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              下移
            </button>
            <button
              type="button"
              onClick={onRemove}
              disabled={disabledRemove}
              title={disabledRemove ? '至少保留一个档位' : undefined}
              aria-describedby={disabledRemove ? removeHintId : undefined}
              className="min-h-9 rounded border border-[color:var(--bl-border)] px-2 text-left text-xs text-[#fda4af] hover:bg-black/20 disabled:cursor-not-allowed disabled:opacity-40"
            >
              删除档位
            </button>
            {disabledRemove ? (
              <p id={removeHintId} className="text-[11px] text-[var(--bl-muted)]">
                至少保留一个档位
              </p>
            ) : null}
          </div>
        </div>
      </details>
    </div>
  );
}
