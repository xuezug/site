export type NavItem = {
  readonly href: string;
  readonly label: string;
};

/**
 * Single source of truth for site navigation. Sidebar and MobileDrawer both
 * consume it, and tests assert against it.
 */
export const NAV_ITEMS: readonly NavItem[] = [
  { href: '/', label: '首页' },
  { href: '/tier', label: '节奏榜' },
  { href: '/blog', label: '博客' },
];

/**
 * "/" is exact; every other entry also matches its sub-paths so that
 * `/blog/tag/x` keeps 博客 highlighted.
 */
export function isActivePath(pathname: string, href: string): boolean {
  if (href === '/') {
    return pathname === '/';
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}
