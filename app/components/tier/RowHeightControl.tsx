import { useId, useRef, useState } from 'react';
import {
  ROW_HEIGHT_DEFAULT,
  ROW_HEIGHT_MAX,
  ROW_HEIGHT_MIN,
  ROW_HEIGHT_STEP,
} from '../../lib/tier/rowHeight';

const PANEL_WIDTH = 256;
const VIEWPORT_MARGIN = 8;

type RowHeightControlProps = {
  /** Committed height, or `null` for the CSS default. */
  value: number | null;
  /** Live preview during the drag; writes the CSS variable directly. */
  onPreview: (px: number | null) => void;
  /** Persist the final value (or reset with `null`). */
  onCommit: (px: number | null) => void;
};

/**
 * Toolbar popover for the shared tier row height. The slider previews by
 * changing a CSS variable (no React state / 916-card re-render per frame) and
 * commits on release, arrow-key up or blur.
 */
export function RowHeightControl({ value, onPreview, onCommit }: RowHeightControlProps) {
  const inputId = useId();
  const summaryRef = useRef<HTMLElement>(null);
  const [panelLeft, setPanelLeft] = useState(-(PANEL_WIDTH - 64));
  // `base` pins the draft to the committed value: an external change (reset,
  // import) makes the draft stale and the committed value wins again.
  const [draft, setDraft] = useState<{ base: number | null; value: number } | null>(null);
  const active = draft !== null && draft.base === value ? draft.value : (value ?? ROW_HEIGHT_DEFAULT);

  // Align the panel to the summary but keep it inside the viewport; on a phone
  // the button can sit at either edge of a wrapped toolbar row.
  const placePanel = (): void => {
    const rect = summaryRef.current?.getBoundingClientRect();
    if (rect === undefined) {
      return;
    }
    const left = Math.min(
      Math.max(rect.right - PANEL_WIDTH, VIEWPORT_MARGIN),
      window.innerWidth - PANEL_WIDTH - VIEWPORT_MARGIN,
    );
    setPanelLeft(left - rect.left);
  };

  const preview = (next: number): void => {
    setDraft({ base: value, value: next });
    onPreview(next);
  };

  const reset = (): void => {
    setDraft(null);
    onPreview(null);
    onCommit(null);
  };

  return (
    <details className="relative">
      <summary
        ref={summaryRef}
        aria-label="调节行高"
        onClick={placePanel}
        className="inline-flex min-h-11 cursor-pointer list-none items-center justify-center rounded-lg border border-[color:var(--bl-border-strong)] px-3 text-sm font-medium text-[var(--bl-text)] marker:hidden hover:bg-[var(--bl-panel-hover)]"
      >
        行高
      </summary>

      <div
        data-testid="row-height-panel"
        style={{ left: panelLeft }}
        className="absolute top-full z-30 mt-1 w-64 rounded-lg border border-[color:var(--bl-border-strong)] bg-[var(--bl-panel)] p-3 shadow-xl"
      >
        <div className="flex items-center justify-between gap-2">
          <label htmlFor={inputId} className="text-xs text-[var(--bl-text)]">
            行高
          </label>
          <output htmlFor={inputId} className="text-xs tabular-nums text-[var(--bl-muted)]">
            {active}px
          </output>
        </div>

        <input
          id={inputId}
          type="range"
          min={ROW_HEIGHT_MIN}
          max={ROW_HEIGHT_MAX}
          step={ROW_HEIGHT_STEP}
          value={active}
          onChange={(event) => preview(Number(event.target.value))}
          onPointerUp={(event) => onCommit(Number(event.currentTarget.value))}
          onKeyUp={(event) => {
            if (
              event.key.startsWith('Arrow') ||
              event.key === 'Home' ||
              event.key === 'End' ||
              event.key === 'PageUp' ||
              event.key === 'PageDown'
            ) {
              onCommit(Number(event.currentTarget.value));
            }
          }}
          onBlur={(event) => {
            if (draft !== null) {
              onCommit(Number(event.currentTarget.value));
            }
          }}
          className="mt-2 w-full accent-[var(--bl-accent)]"
        />

        <div className="mt-1 flex items-center justify-between text-[11px] text-[var(--bl-muted)]">
          <span>{ROW_HEIGHT_MIN}px</span>
          <span>{ROW_HEIGHT_MAX}px</span>
        </div>

        <button
          type="button"
          onClick={reset}
          className="mt-3 min-h-9 w-full rounded border border-[color:var(--bl-border)] px-2 text-left text-xs text-[var(--bl-text)] hover:bg-[var(--bl-panel-hover)]"
        >
          恢复默认（{ROW_HEIGHT_DEFAULT}px）
        </button>
      </div>
    </details>
  );
}
