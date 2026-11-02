import { useEffect, useRef, useState } from 'react';
import type { Ref } from 'react';
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
  /** Lets the row measure this column when resizing it. */
  rootRef?: Ref<HTMLDivElement>;
};

/**
 * The narrow left column of a tier row (width comes from the board's
 * `--bl-tier-name-w`, resizable via the handle in `TierRow`): editable name and
 * a 「设置」 panel with colours, reorder and delete. The panel is a native
 * `<details>` so it needs no focus management.
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
  rootRef,
}: TierHeaderProps) {
  const [editing, setEditing] = useState(false);
  // `null` means "mirror `tier.name`"; a string is the in-progress edit, which
  // may legitimately be empty while the user clears the field.
  const [draft, setDraft] = useState<string | null>(null);
  // Live colour while the native picker is being dragged. Board updates (and
  // the 916-card re-render they trigger) are deferred until the drag settles.
  const [draftColor, setDraftColor] = useState<{ base: string; value: string } | null>(null);
  const colorTimer = useRef<number | null>(null);
  const skipBlur = useRef(false);
  const removeHintId = `tier-remove-hint-${tier.id}`;

  const activeColor =
    draftColor !== null && draftColor.base === tier.color ? draftColor.value : tier.color;

  const queueColor = (value: string): void => {
    setDraftColor({ base: tier.color, value });
    if (colorTimer.current !== null) {
      window.clearTimeout(colorTimer.current);
    }
    colorTimer.current = window.setTimeout(() => {
      colorTimer.current = null;
      onChangeColor(tier.id, value);
    }, 180);
  };

  const commitColor = (value: string): void => {
    if (colorTimer.current !== null) {
      window.clearTimeout(colorTimer.current);
      colorTimer.current = null;
    }
    setDraftColor(null);
    onChangeColor(tier.id, value);
  };

  useEffect(
    () => () => {
      if (colorTimer.current !== null) {
        window.clearTimeout(colorTimer.current);
      }
    },
    [],
  );

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
      ref={rootRef}
      className="flex flex-col gap-1.5 rounded-lg border border-[color:var(--bl-border)] p-1.5"
      style={{
        borderLeft: `6px solid ${activeColor}`,
        backgroundColor: `color-mix(in srgb, ${activeColor} 16%, transparent)`,
      }}
    >
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
          className="bl-tier-name w-full rounded border border-[color:var(--bl-accent)] bg-[var(--bl-bg)] px-1 text-sm font-semibold text-[var(--bl-text)]"
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
          className="bl-tier-name w-full whitespace-normal break-words rounded px-1 text-left text-sm font-semibold leading-tight text-[var(--bl-text)] hover:bg-black/20"
        >
          {tier.name}
        </button>
      )}

      <details className="bl-tier-settings relative">
        <summary
          aria-label={`${tier.name} 档位设置`}
          className="grid cursor-pointer list-none place-items-center rounded border border-[color:var(--bl-border)] text-[11px] font-medium text-[var(--bl-text)] marker:hidden hover:bg-black/20"
        >
          设置
        </summary>

        <div className="absolute left-0 top-full z-20 mt-1 flex w-48 flex-col gap-2 rounded-lg border border-[color:var(--bl-border-strong)] bg-[var(--bl-panel)] p-2 shadow-xl">
          <div className="flex flex-col gap-1">
            <p className="text-[11px] text-[var(--bl-muted)]">预设颜色</p>
            <div className="grid grid-cols-4 gap-1">
              {TIER_COLORS.map((swatch) => (
                <button
                  key={swatch}
                  type="button"
                  aria-label={`颜色 ${swatch}`}
                  aria-pressed={activeColor === swatch}
                  onClick={() => commitColor(swatch)}
                  style={{ backgroundColor: swatch }}
                  className={
                    activeColor === swatch
                      ? 'h-8 w-full rounded border-2 border-white'
                      : 'h-8 w-full rounded border border-transparent'
                  }
                />
              ))}
            </div>
            <label className="mt-1 flex items-center justify-between gap-2 text-[11px] text-[var(--bl-muted)]">
              自定义
              <input
                type="color"
                value={activeColor}
                aria-label={`${tier.name} 档颜色`}
                onChange={(event) => queueColor(event.target.value)}
                className="h-8 w-20 cursor-pointer rounded border border-[color:var(--bl-border)] bg-transparent p-0.5"
              />
            </label>
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
