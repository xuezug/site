import { useCallback, useRef, useState, useSyncExternalStore } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Link } from 'react-router';
import { collapsedPreference } from '../../lib/navPreference';
import { MobileDrawer } from './MobileDrawer';
import { Sidebar } from './Sidebar';

const EXPANDED_WIDTH = '220px';
const COLLAPSED_WIDTH = '64px';

type AppShellProps = {
  children: ReactNode;
};

/**
 * Site chrome shared by every route:
 *
 * - desktop: fixed 220px sidebar, collapsible to 64px (remembered locally),
 * - mobile: a 56px top bar plus a slide-out drawer,
 * - a skip link and the single `<main id="main">` landmark.
 */
export function AppShell({ children }: AppShellProps) {
  const collapsed = useSyncExternalStore(
    collapsedPreference.subscribe,
    collapsedPreference.getSnapshot,
    collapsedPreference.getServerSnapshot,
  );
  const [drawerOpen, setDrawerOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  const toggleCollapsed = useCallback(() => {
    // Read the store rather than the render snapshot so rapid clicks cannot
    // toggle twice from the same stale value.
    collapsedPreference.set(!collapsedPreference.getSnapshot());
  }, []);

  const openDrawer = useCallback(() => {
    setDrawerOpen(true);
  }, []);

  const closeDrawer = useCallback(() => {
    setDrawerOpen(false);
  }, []);

  const shellStyle = {
    '--bl-sidebar-w': collapsed ? COLLAPSED_WIDTH : EXPANDED_WIDTH,
  } as CSSProperties;

  return (
    <div className="min-h-screen" style={shellStyle}>
      <a href="#main" className="bl-skip-link">
        跳到主内容
      </a>

      <Sidebar collapsed={collapsed} onToggle={toggleCollapsed} />

      <header className="fixed inset-x-0 top-0 z-30 flex h-[var(--bl-topbar-h)] items-center gap-2 border-b border-[color:var(--bl-border)] bg-[var(--bl-panel)] px-2 lg:hidden">
        <button
          ref={menuButtonRef}
          type="button"
          onClick={openDrawer}
          aria-label="打开导航菜单"
          aria-expanded={drawerOpen}
          aria-controls="bl-mobile-drawer"
          className="grid h-11 w-11 place-items-center rounded-lg text-[var(--bl-text)] transition-colors hover:bg-[var(--bl-panel-hover)]"
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
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </button>
        <Link to="/" className="text-sm font-semibold">
          血族资源站
        </Link>
      </header>

      <MobileDrawer open={drawerOpen} onClose={closeDrawer} returnFocusRef={menuButtonRef} />

      <div className="lg:pl-[var(--bl-sidebar-w)]">
        <main
          id="main"
          tabIndex={-1}
          className="mx-auto w-full max-w-6xl px-4 pb-20 pt-[calc(var(--bl-topbar-h)_+_1.5rem)] sm:px-6 lg:pt-10"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
