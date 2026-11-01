import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import cardsJson from '../../src/data/cards.json';
import { AppShell } from '../../app/components/layout/AppShell';
import { Dialog } from '../../app/components/ui/Dialog';
import { ATTRIBUTES, FACTIONS } from '../../app/lib/cards/taxonomy';
import type { Card } from '../../app/lib/cards/types';
import { SITE_URL } from '../../app/lib/env';
import { NAV_ITEMS } from '../../app/lib/nav';
import { siteHeadTags } from '../../app/lib/seo/head';
import Home from '../../app/routes/home';
import NotFound from '../../app/routes/not-found';

function renderShell(initialEntry = '/') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <AppShell>
        <p>页面内容</p>
      </AppShell>
    </MemoryRouter>,
  );
}

function desktopNav() {
  return screen.getByRole('navigation', { name: '主导航' });
}

type MediaChangeListener = (event: MediaQueryListEvent) => void;

/**
 * jsdom has no `matchMedia`; this controllable stub models the drawer's
 * `(min-width: 1024px)` query so tests can grow the viewport.
 */
function installMatchMedia(initialMatches: boolean) {
  let matches = initialMatches;
  const listeners = new Set<MediaChangeListener>();

  const query = {
    get matches() {
      return matches;
    },
    media: '(min-width: 1024px)',
    onchange: null,
    addEventListener: (type: string, listener: MediaChangeListener) => {
      if (type === 'change') {
        listeners.add(listener);
      }
    },
    removeEventListener: (type: string, listener: MediaChangeListener) => {
      if (type === 'change') {
        listeners.delete(listener);
      }
    },
    addListener: (listener: MediaChangeListener) => listeners.add(listener),
    removeListener: (listener: MediaChangeListener) => listeners.delete(listener),
    dispatchEvent: () => true,
  } as unknown as MediaQueryList;

  vi.stubGlobal('matchMedia', () => query);

  return {
    setMatches(next: boolean) {
      matches = next;
      for (const listener of [...listeners]) {
        listener({ matches: next } as MediaQueryListEvent);
      }
    },
    listenerCount: () => listeners.size,
  };
}

describe('AppShell navigation', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('renders every NAV_ITEMS entry in the desktop sidebar', () => {
    renderShell('/');
    const nav = desktopNav();

    expect(within(nav).getAllByRole('link')).toHaveLength(NAV_ITEMS.length);
    for (const item of NAV_ITEMS) {
      expect(within(nav).getByRole('link', { name: item.label })).toHaveAttribute(
        'href',
        item.href,
      );
    }
  });

  it('marks the exact current route with aria-current', () => {
    renderShell('/tier');
    const nav = desktopNav();

    expect(within(nav).getByRole('link', { name: '节奏榜' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(nav).getByRole('link', { name: '首页' })).not.toHaveAttribute('aria-current');
    expect(within(nav).getByRole('link', { name: '博客' })).not.toHaveAttribute('aria-current');
  });

  it('keeps 博客 active on blog sub-paths', () => {
    renderShell('/blog/tag/jie-zou-bang');

    expect(within(desktopNav()).getByRole('link', { name: '博客' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('does not mark 首页 active on other routes', () => {
    renderShell('/blog');
    const nav = desktopNav();

    expect(within(nav).getByRole('link', { name: '首页' })).not.toHaveAttribute('aria-current');
    expect(within(nav).getByRole('link', { name: '博客' })).toHaveAttribute('aria-current', 'page');
  });

  it('provides the skip link and the single main landmark', () => {
    renderShell('/');

    expect(screen.getByRole('link', { name: '跳到主内容' })).toHaveAttribute('href', '#main');
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main');
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(screen.getByRole('main')).toHaveTextContent('页面内容');
  });

  it('collapses to 64px and remembers the choice in localStorage', () => {
    renderShell('/');

    fireEvent.click(screen.getByRole('button', { name: '收起导航' }));

    expect(window.localStorage.getItem('bl.nav.collapsed.v1')).toBe('1');
    expect(screen.getByRole('button', { name: '展开导航' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('restores a collapsed sidebar from localStorage', () => {
    window.localStorage.setItem('bl.nav.collapsed.v1', '1');
    renderShell('/');

    expect(screen.getByRole('button', { name: '展开导航' })).toBeInTheDocument();
  });
});

describe('MobileDrawer', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('opens from the top bar, moves focus in, and closes on Escape', () => {
    renderShell('/');
    const trigger = screen.getByRole('button', { name: '打开导航菜单' });
    trigger.focus();
    fireEvent.click(trigger);

    const dialog = screen.getByRole('dialog', { name: '导航菜单' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(within(dialog).getByRole('link', { name: '节奏榜' })).toHaveAttribute('href', '/tier');
    expect(within(dialog).getByRole('button', { name: '关闭导航' })).toHaveFocus();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('closes when the overlay is clicked and returns focus to the trigger', () => {
    renderShell('/');
    const trigger = screen.getByRole('button', { name: '打开导航菜单' });
    trigger.focus();
    fireEvent.click(trigger);

    fireEvent.click(screen.getByTestId('mobile-drawer-overlay'));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('closes after a navigation link is followed', () => {
    renderShell('/');
    fireEvent.click(screen.getByRole('button', { name: '打开导航菜单' }));
    const dialog = screen.getByRole('dialog', { name: '导航菜单' });

    fireEvent.click(within(dialog).getByRole('link', { name: '节奏榜' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closes when the viewport grows past lg and releases its listeners', () => {
    const media = installMatchMedia(false);
    renderShell('/');
    const trigger = screen.getByRole('button', { name: '打开导航菜单' });
    trigger.focus();
    fireEvent.click(trigger);

    expect(screen.getByRole('dialog', { name: '导航菜单' })).toBeInTheDocument();
    expect(media.listenerCount()).toBe(1);

    act(() => {
      media.setMatches(true);
    });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(media.listenerCount()).toBe(0);
    expect(trigger).toHaveFocus();
  });

  it('does not linger when opened while already on desktop', () => {
    const media = installMatchMedia(true);
    renderShell('/');

    fireEvent.click(screen.getByRole('button', { name: '打开导航菜单' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(media.listenerCount()).toBe(0);
  });
});

describe('Dialog', () => {
  function Harness() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          打开对话框
        </button>
        <Dialog
          open={open}
          onClose={() => setOpen(false)}
          title="测试对话框"
          footer={<button type="button">确定</button>}
        >
          <p>对话框内容</p>
        </Dialog>
      </>
    );
  }

  it('labels itself, moves focus in, and restores focus on Escape', () => {
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: '打开对话框' });
    trigger.focus();
    fireEvent.click(trigger);

    const dialog = screen.getByRole('dialog', { name: '测试对话框' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(within(dialog).getByRole('button', { name: '关闭对话框' })).toHaveFocus();
    expect(within(dialog).getByText('对话框内容')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('closes when the backdrop is clicked', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: '打开对话框' }));

    fireEvent.click(screen.getByTestId('dialog-overlay'));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('wraps Tab at the end and Shift+Tab at the start', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: '打开对话框' }));

    const dialog = screen.getByRole('dialog', { name: '测试对话框' });
    const first = within(dialog).getByRole('button', { name: '关闭对话框' });
    const last = within(dialog).getByRole('button', { name: '确定' });

    // Tab from the last focusable wraps to the first.
    last.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(first).toHaveFocus();

    // Shift+Tab from the first wraps to the last.
    first.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(last).toHaveFocus();
  });
});

describe('site head tags', () => {
  it('omits the canonical and marks the shared 404 document noindex', () => {
    expect(siteHeadTags('/404')).toEqual({ canonical: null, noindex: true });
  });

  it('keeps a per-path canonical for regular routes', () => {
    expect(siteHeadTags('/')).toEqual({ canonical: SITE_URL, noindex: false });
    expect(siteHeadTags('/tier').canonical).toBe(`${SITE_URL}/tier`);
    expect(siteHeadTags('/blog/tag/x').canonical).toBe(`${SITE_URL}/blog/tag/x`);
  });
});

describe('home page', () => {
  const cards = cardsJson as Card[];

  it('renders one h1, the two feature entries, and a data summary from cards.json', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <Home />
      </MemoryRouter>,
    );

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: '血族资源站' })).toBeInTheDocument();

    expect(screen.getByRole('link', { name: /Tier Maker/ })).toHaveAttribute('href', '/tier');
    expect(screen.getByRole('link', { name: /版本笔记与数据说明/ })).toHaveAttribute(
      'href',
      '/blog',
    );

    const summary = screen.getByRole('region', { name: '数据摘要' });
    expect(summary).toHaveTextContent(String(cards.length));
    expect(summary).toHaveTextContent(
      String(new Set(cards.map((card) => card.uniqueId)).size),
    );
    expect(summary).toHaveTextContent(String(ATTRIBUTES.length));
    expect(summary).toHaveTextContent(String(FACTIONS.length));

    expect(within(summary).getByRole('link', { name: '下载 /data/cards.json' })).toHaveAttribute(
      'href',
      '/data/cards.json',
    );
  });
});

describe('not found page', () => {
  it('renders branded 404 copy with return links', () => {
    render(
      <MemoryRouter initialEntries={['/404']}>
        <NotFound />
      </MemoryRouter>,
    );

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: '页面不存在' })).toBeInTheDocument();
    expect(screen.getByText(/404/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '返回首页' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: '去节奏榜' })).toHaveAttribute('href', '/tier');
  });
});
