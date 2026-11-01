import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { useModalBehavior } from '../ui/useModalBehavior';
import { NavList } from './Sidebar';

/** Matches Tailwind's `lg` breakpoint, where the drawer is replaced by the sidebar. */
const DESKTOP_QUERY = '(min-width: 1024px)';

type MobileDrawerProps = {
  open: boolean;
  onClose: () => void;
  /** Element that receives focus again after the drawer closes. */
  returnFocusRef?: RefObject<HTMLElement | null>;
};

/**
 * Off-canvas navigation for < 1024px: `min(80vw, 320px)` wide, Escape /
 * overlay click to close, focus locked inside while open. The slide-in
 * animation is dropped under `prefers-reduced-motion` (see app.css).
 *
 * Growing the viewport to `lg` reveals the sidebar, so the drawer closes
 * itself instead of leaving an invisible `aria-modal` region behind.
 */
export function MobileDrawer({ open, onClose, returnFocusRef }: MobileDrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useModalBehavior(open, onClose, panelRef, returnFocusRef);

  useEffect(() => {
    if (!open) {
      return;
    }

    // jsdom (unit tests) and non-browser builds may not implement matchMedia.
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }

    const query = window.matchMedia(DESKTOP_QUERY);

    // Already on desktop when the drawer was opened (e.g. a programmatic open).
    if (query.matches) {
      onClose();
      return;
    }

    const handleChange = (event: MediaQueryListEvent): void => {
      if (event.matches) {
        onClose();
      }
    };

    query.addEventListener('change', handleChange);
    return () => query.removeEventListener('change', handleChange);
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 lg:hidden">
      <div
        data-testid="mobile-drawer-overlay"
        aria-hidden="true"
        onClick={onClose}
        className="bl-drawer-overlay absolute inset-0 bg-black/60"
      />

      <div
        id="bl-mobile-drawer"
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="导航菜单"
        tabIndex={-1}
        className="bl-drawer-panel absolute inset-y-0 left-0 flex w-[min(80vw,320px)] flex-col border-r border-[color:var(--bl-border)] bg-[var(--bl-panel)] shadow-2xl"
      >
        <div className="flex min-h-14 items-center justify-between gap-2 border-b border-[color:var(--bl-border)] px-3">
          <p className="text-sm font-semibold">血族资源站</p>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭导航"
            className="grid h-11 w-11 place-items-center rounded-lg text-[var(--bl-muted)] transition-colors hover:bg-[var(--bl-panel-hover)] hover:text-[var(--bl-text)]"
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

        <div className="flex-1 overflow-y-auto px-2 py-3">
          <NavList onNavigate={onClose} ariaLabel="移动端主导航" />
        </div>
      </div>
    </div>
  );
}
