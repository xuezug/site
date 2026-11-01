import { Link, useLocation } from 'react-router';
import { cn } from '../../lib/cn';
import { isActivePath, NAV_ITEMS } from '../../lib/nav';

function NavIcon({ href }: { href: string }) {
  const common = {
    'aria-hidden': true,
    focusable: 'false' as const,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.7,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className: 'h-5 w-5 shrink-0',
  };

  if (href === '/tier') {
    return (
      <svg {...common}>
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </svg>
    );
  }

  if (href === '/blog') {
    return (
      <svg {...common}>
        <path d="M5 4h9l5 5v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z" />
        <path d="M14 4v5h5" />
        <path d="M8 13h8M8 17h5" />
      </svg>
    );
  }

  return (
    <svg {...common}>
      <path d="M4 10.5 12 4l8 6.5" />
      <path d="M6 9.5V20h12V9.5" />
      <path d="M10 20v-5h4v5" />
    </svg>
  );
}

type NavListProps = {
  collapsed?: boolean;
  onNavigate?: () => void;
  ariaLabel: string;
};

/** Shared link list used by the desktop sidebar and the mobile drawer. */
export function NavList({ collapsed = false, onNavigate, ariaLabel }: NavListProps) {
  const { pathname } = useLocation();

  return (
    <nav aria-label={ariaLabel}>
      <ul className="flex flex-col gap-1">
        {NAV_ITEMS.map((item) => {
          const active = isActivePath(pathname, item.href);

          return (
            <li key={item.href}>
              <Link
                to={item.href}
                aria-current={active ? 'page' : undefined}
                onClick={onNavigate}
                title={collapsed ? item.label : undefined}
                className={cn(
                  'flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors',
                  collapsed && 'justify-center px-0',
                  active
                    ? 'bg-[var(--bl-accent-soft)] text-[var(--bl-accent-text)]'
                    : 'text-[var(--bl-muted)] hover:bg-[var(--bl-panel-hover)] hover:text-[var(--bl-text)]',
                )}
              >
                <NavIcon href={item.href} />
                <span className={cn(collapsed && 'sr-only')}>{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

type SidebarProps = {
  collapsed: boolean;
  onToggle: () => void;
};

/** Desktop-only fixed sidebar (220px, 64px when collapsed). */
export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  return (
    <aside
      id="bl-sidebar"
      aria-label="站点导航"
      className="fixed inset-y-0 left-0 z-40 hidden flex-col border-r border-[color:var(--bl-border)] bg-[var(--bl-panel)] lg:flex lg:w-[var(--bl-sidebar-w)]"
    >
      <div className={cn('flex min-h-14 items-center px-3', collapsed && 'justify-center px-0')}>
        <Link
          to="/"
          className={cn(
            'flex min-h-11 items-center gap-2 rounded-lg px-1 text-sm font-semibold text-[var(--bl-text)]',
            collapsed && 'justify-center',
          )}
          title={collapsed ? '血族资源站' : undefined}
        >
          <span
            aria-hidden="true"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[var(--bl-accent)] text-sm font-bold text-white"
          >
            血
          </span>
          <span className={cn('whitespace-nowrap', collapsed && 'sr-only')}>血族资源站</span>
        </Link>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-3">
        <NavList collapsed={collapsed} ariaLabel="主导航" />
      </div>

      <div className="border-t border-[color:var(--bl-border)] p-2">
        <button
          type="button"
          onClick={onToggle}
          aria-label={collapsed ? '展开导航' : '收起导航'}
          aria-expanded={!collapsed}
          aria-controls="bl-sidebar"
          className={cn(
            'flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-sm text-[var(--bl-muted)] transition-colors hover:bg-[var(--bl-panel-hover)] hover:text-[var(--bl-text)]',
            collapsed && 'justify-center px-0',
          )}
        >
          <svg
            aria-hidden="true"
            focusable="false"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.7}
            strokeLinecap="round"
            strokeLinejoin="round"
            className={cn('h-5 w-5 shrink-0 transition-transform', collapsed && 'rotate-180')}
          >
            <path d="m14 6-6 6 6 6" />
          </svg>
          <span className={cn(collapsed && 'sr-only')}>{collapsed ? '展开导航' : '收起导航'}</span>
        </button>
      </div>
    </aside>
  );
}
