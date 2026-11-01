import { useId, useRef } from 'react';
import type { ReactNode } from 'react';
import { useModalBehavior } from './useModalBehavior';

type DialogProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  footer?: ReactNode;
  children: ReactNode;
};

/**
 * Modal dialog: focus is trapped inside, Escape / overlay click closes it, and
 * focus returns to the trigger on close. Rendered inline (no portal) with a
 * high z-index so it sits above the shell chrome.
 */
export function Dialog({ open, onClose, title, footer, children }: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useModalBehavior(open, onClose, panelRef);

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center p-4 sm:items-center">
      <div
        data-testid="dialog-overlay"
        aria-hidden="true"
        onClick={onClose}
        className="absolute inset-0 bg-black/60"
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="relative flex max-h-[85vh] w-full max-w-lg flex-col rounded-xl border border-[color:var(--bl-border)] bg-[var(--bl-panel)] p-5 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4">
          <h2 id={titleId} className="text-lg font-semibold">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭对话框"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-[var(--bl-muted)] transition-colors hover:bg-[var(--bl-panel-hover)] hover:text-[var(--bl-text)]"
          >
            <svg
              aria-hidden="true"
              focusable="false"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.7}
              strokeLinecap="round"
              className="h-5 w-5"
            >
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>

        <div className="mt-3 overflow-y-auto text-sm text-[var(--bl-muted)]">{children}</div>

        {footer !== undefined ? (
          <div className="mt-5 flex flex-wrap justify-end gap-2">{footer}</div>
        ) : null}
      </div>
    </div>
  );
}
