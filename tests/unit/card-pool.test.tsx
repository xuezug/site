import { act, fireEvent, render, renderHook, screen, within } from '@testing-library/react';
import { DndContext } from '@dnd-kit/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CardPool } from '../../app/components/tier/CardPool';
import { useCardPool, type CardPoolView, type PoolFilters } from '../../app/components/tier/useCardPool';
import type { Card } from '../../app/lib/cards/types';
import { moveAnnouncement } from '../../app/lib/tier/announce';
import { cardDndId, parseSerial, poolCardDndId } from '../../app/lib/tier/dnd';
import type { Tier } from '../../app/lib/tier/model';
import cardsJson from '../../src/data/cards.json';

/**
 * Tests for the filtered pool (design §6.1/§6.4).
 *
 * Counts are asserted against the real `cards.json`; interactions use a small
 * fixture so the DOM stays readable. dnd-kit behaviour itself is covered by
 * `tier-board.test.tsx` — here the pool only needs a `DndContext` to mount.
 */

const ALL_CARDS = cardsJson as Card[];
const NO_PLACED = new Set<number>();

function makeCard(
  serial: number,
  name: string,
  star: number,
  attribute: Card['attribute'],
  faction: Card['faction'],
  career: Card['career'],
): Card {
  return {
    serial,
    looks: serial + 1000,
    name,
    uniqueId: serial,
    star,
    maxStar: 5,
    attribute,
    attributes: [attribute],
    faction,
    career,
    careerOptions: [],
    gender: 'female',
    skinOf: null,
    iconPath: `card_icons/${serial}_1.png`,
  };
}

const FIXTURE: Card[] = [
  makeCard(1, '夜刃', 3, 'fire', 'traveler', 'warrior'),
  makeCard(2, '月季院', 5, 'light', 'sanctuary', 'mage'),
  makeCard(3, '血蔷薇', 4, 'dark', 'traveler', 'assassin'),
  makeCard(4, '火羽', 5, 'fire', 'tower', 'priest'),
  makeCard(5, '赤月', 1, 'fire', 'traveler', 'warrior'),
];

const TIERS: Tier[] = [
  { id: 't-s', name: 'S', color: '#e11d48', cards: [] },
  { id: 't-a', name: 'A', color: '#f97316', cards: [] },
];

const PLACED_TIERS: Tier[] = [
  { id: 't-s', name: 'S', color: '#e11d48', cards: [1] },
  { id: 't-a', name: 'A', color: '#f97316', cards: [] },
];

function poolCounts(filters: PoolFilters, placed: ReadonlySet<number> = NO_PLACED): CardPoolView {
  const { result } = renderHook(() => useCardPool(ALL_CARDS, placed, filters));
  return result.current;
}

type PoolProps = {
  cards?: readonly Card[];
  tiers?: readonly Tier[];
  placed?: ReadonlySet<number>;
  onMove?: (serial: number, tierId: string | null) => void;
};

function renderPool(props: PoolProps = {}) {
  const { cards = FIXTURE, tiers = TIERS, placed = NO_PLACED } = props;
  const onMove = props.onMove ?? vi.fn<(serial: number, tierId: string | null) => void>();

  const view = render(
    <DndContext>
      <CardPool cards={cards} tiers={tiers} placed={placed} onMove={onMove} />
    </DndContext>,
  );

  return { ...view, onMove };
}

function pool(): HTMLElement {
  return screen.getByRole('region', { name: '角色池' });
}

function tiles(): HTMLElement[] {
  return within(pool()).getAllByRole('listitem');
}

function count(): HTMLElement {
  return screen.getByTestId('pool-count');
}

afterEach(() => {
  vi.useRealTimers();
});

describe('useCardPool with the real catalog', () => {
  it('reports the unfiltered total and an empty placed set', () => {
    const view = poolCounts({ query: '', onlyUnplaced: false });

    expect(view.total).toBe(916);
    expect(view.filteredCount).toBe(916);
    expect(view.items).toHaveLength(916);
    expect(view.placedCount).toBe(0);
  });

  it('matches the documented single-dimension counts', () => {
    expect(poolCounts({ query: '', onlyUnplaced: false, attribute: 'fire' }).filteredCount).toBe(
      211,
    );
    expect(poolCounts({ query: '', onlyUnplaced: false, star: 5 }).filteredCount).toBe(526);
    expect(poolCounts({ query: '', onlyUnplaced: false, faction: 'traveler' }).filteredCount).toBe(
      349,
    );
    expect(poolCounts({ query: '', onlyUnplaced: false, career: 'warrior' }).filteredCount).toBe(
      294,
    );
  });

  it('ANDs dimensions and keeps the total independent of the filters', () => {
    const view = poolCounts({ query: '', onlyUnplaced: false, attribute: 'fire', star: 5 });

    expect(view.filteredCount).toBe(126);
    expect(view.total).toBe(916);
    expect(view.items.every((card) => card.attribute === 'fire' && card.star === 5)).toBe(true);
  });

  it('counts placed cards and hides them behind onlyUnplaced', () => {
    const placed = new Set(ALL_CARDS.slice(0, 12).map((card) => card.serial));

    const all = poolCounts({ query: '', onlyUnplaced: false }, placed);
    expect(all.placedCount).toBe(12);
    expect(all.filteredCount).toBe(916);

    const unplaced = poolCounts({ query: '', onlyUnplaced: true }, placed);
    expect(unplaced.placedCount).toBe(12);
    expect(unplaced.filteredCount).toBe(904);
    expect(unplaced.items.some((card) => placed.has(card.serial))).toBe(false);
  });
});

describe('CardPool rendering', () => {
  it('renders a list item per card with a lazy 144px icon and the documented alt text', () => {
    renderPool();

    expect(within(pool()).getByRole('heading', { name: '角色池' })).toBeInTheDocument();
    expect(tiles()).toHaveLength(FIXTURE.length);

    const image = within(pool()).getByAltText('夜刃（3 星 火）');
    expect(image.getAttribute('src')).toMatch(
      /^https:\/\/bl-resource\.cracklewis\.site\/card_icons\//,
    );
    expect(image).toHaveAttribute('width', '144');
    expect(image).toHaveAttribute('height', '144');
    expect(image).toHaveAttribute('loading', 'lazy');
    expect(image).toHaveAttribute('decoding', 'async');

    // Every tile is virtualisable so the 916-row grid stays cheap to lay out.
    // It sits on the card face, not the <li>: `content-visibility` implies paint
    // containment and would clip the overflowing「＋」menu.
    const face = image.parentElement;
    expect(face?.className).toContain('[content-visibility:auto]');
    expect(face?.className).toContain('[contain-intrinsic-size:auto_144px]');
  });

  it('shows the unfiltered count in the pool live region', () => {
    renderPool();

    expect(count()).toHaveTextContent('共 5 张 · 全站已上榜 0 张');
    expect(count()).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByRole('button', { name: '仅看未上榜' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('makes only the list — not the toolbar — the pool drop target', () => {
    renderPool();

    const zone = screen.getByTestId('pool-dropzone');
    const bar = screen.getByTestId('filter-bar');

    // Dropping a card on the search box must not remove it from the board.
    expect(zone.contains(bar)).toBe(false);
    expect(zone.contains(screen.getByRole('list'))).toBe(true);
    expect(within(zone).getByAltText('夜刃（3 星 火）')).toBeInTheDocument();
  });

  it('filters by attribute and star, keeping the count in step', () => {
    renderPool();

    fireEvent.change(screen.getByLabelText('属性'), { target: { value: 'fire' } });
    expect(tiles()).toHaveLength(3);
    expect(count()).toHaveTextContent('筛选出 3 张 · 全站已上榜 0 张');

    fireEvent.change(screen.getByLabelText('星级'), { target: { value: '5' } });
    expect(tiles()).toHaveLength(1);
    expect(within(pool()).getByText('火羽')).toBeInTheDocument();
    expect(count()).toHaveTextContent('筛选出 1 张 · 全站已上榜 0 张');

    // 「全部」 clears just that dimension.
    fireEvent.change(screen.getByLabelText('星级'), { target: { value: '' } });
    expect(tiles()).toHaveLength(3);
    expect(count()).toHaveTextContent('筛选出 3 张 · 全站已上榜 0 张');
  });
});

describe('CardPool search', () => {
  it('debounces the query by 150ms and clears on Escape', () => {
    vi.useFakeTimers();
    renderPool();

    const search = screen.getByLabelText('搜索卡片名称或编号');
    expect(search).toHaveAttribute('type', 'search');

    fireEvent.change(search, { target: { value: '夜刃' } });
    expect(count()).toHaveTextContent('共 5 张 · 全站已上榜 0 张');

    act(() => {
      vi.advanceTimersByTime(149);
    });
    expect(tiles()).toHaveLength(5);
    expect(count()).toHaveTextContent('共 5 张 · 全站已上榜 0 张');

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(tiles()).toHaveLength(1);
    expect(count()).toHaveTextContent('筛选出 1 张 · 全站已上榜 0 张');

    fireEvent.keyDown(search, { key: 'Escape' });
    expect(search).toHaveValue('');
    expect(tiles()).toHaveLength(5);
    expect(count()).toHaveTextContent('共 5 张 · 全站已上榜 0 张');
  });
});

describe('CardPool placed cards', () => {
  it('keeps placed cards in the pool, dimmed with a tier badge and an「已在」label', () => {
    renderPool({ tiers: PLACED_TIERS, placed: new Set([1]) });

    const label = within(pool()).getByLabelText('夜刃，3 星，火，已在 S 档');
    const tile = label.closest('li');

    expect(tile).not.toBeNull();
    expect(within(tile as HTMLElement).getByText('S')).toBeInTheDocument();
    expect(tile?.querySelector('.opacity-40')).not.toBeNull();
    expect(count()).toHaveTextContent('共 5 张 · 全站已上榜 1 张');

    // Still draggable from the pool: the「＋」menu is rendered for it.
    expect(within(tile as HTMLElement).getByLabelText('夜刃 放入档位')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '仅看未上榜' }));
    expect(screen.getByRole('button', { name: '仅看未上榜' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(tiles()).toHaveLength(4);
    expect(within(pool()).queryByText('夜刃')).not.toBeInTheDocument();
    expect(count()).toHaveTextContent('筛选出 4 张 · 全站已上榜 1 张');
  });
});

describe('CardPool empty state', () => {
  it('offers its own 清空筛选 button and hands focus back to the search box', () => {
    renderPool();

    fireEvent.change(screen.getByLabelText('属性'), { target: { value: 'water' } });

    expect(within(pool()).queryAllByRole('listitem')).toHaveLength(0);
    expect(screen.getByText('没有符合条件的卡片')).toBeInTheDocument();
    expect(count()).toHaveTextContent('筛选出 0 张 · 全站已上榜 0 张');

    const empty = screen.getByTestId('pool-empty');
    const emptyClear = within(empty).getByRole('button', { name: '清空筛选' });
    // The empty state explains the situation; the button points back at it.
    expect(emptyClear).toHaveAttribute('aria-describedby', 'pool-empty-message');

    fireEvent.click(emptyClear);

    expect(tiles()).toHaveLength(5);
    expect(screen.queryByText('没有符合条件的卡片')).not.toBeInTheDocument();
    expect(count()).toHaveTextContent('共 5 张 · 全站已上榜 0 张');
    expect(screen.getByLabelText('属性')).toHaveValue('');
    // The empty-state button unmounts with the message, so focus must land on
    // the search box rather than fall through to <body>.
    expect(document.activeElement).toBe(screen.getByLabelText('搜索卡片名称或编号'));
  });
});

describe('CardPool clear-filters focus', () => {
  it('keeps the clear button focusable and moves focus to the search box', () => {
    renderPool();

    const bar = screen.getByTestId('filter-bar');
    const clear = within(bar).getByRole('button', { name: '清空筛选' });

    // Idle: still focusable, only announced as disabled (never `disabled`, which
    // would drop focus to <body> the instant the filters are cleared).
    expect(clear).not.toHaveAttribute('disabled');
    expect(clear).toHaveAttribute('aria-disabled', 'true');

    fireEvent.change(screen.getByLabelText('属性'), { target: { value: 'fire' } });
    expect(clear).toHaveAttribute('aria-disabled', 'false');

    act(() => {
      clear.focus();
    });
    expect(document.activeElement).toBe(clear);

    fireEvent.click(clear);

    expect(tiles()).toHaveLength(5);
    expect(screen.getByLabelText('属性')).toHaveValue('');
    expect(document.activeElement).toBe(screen.getByLabelText('搜索卡片名称或编号'));
    // Focus survives: the button is re-enabled-looking but not removed, and it
    // can still be focused again afterwards.
    expect(clear).not.toHaveAttribute('disabled');
    expect(clear).toHaveAttribute('aria-disabled', 'true');
    act(() => {
      clear.focus();
    });
    expect(document.activeElement).toBe(clear);
  });
});

describe('pool drag ids', () => {
  it('keeps pool tiles in a separate id space from tier cards', () => {
    expect(poolCardDndId(7)).toBe('pool-card:7');
    expect(poolCardDndId(7)).not.toBe(cardDndId(7));
    expect(parseSerial(poolCardDndId(7))).toBe(7);
    expect(parseSerial(cardDndId(7))).toBe(7);
    expect(parseSerial('pool-card:')).toBeNull();
    expect(parseSerial('pool-card:abc')).toBeNull();
  });
});

describe('move announcements', () => {
  it('announces the target tier for any placement', () => {
    expect(moveAnnouncement('夜壬', 'S', false)).toBe('夜壬 已放入 S 档');
    expect(moveAnnouncement('夜壬', 'S', true)).toBe('夜壬 已放入 S 档');
  });

  it('announces a removal only when the card was actually placed', () => {
    expect(moveAnnouncement('夜壬', undefined, true)).toBe('夜壬 已移出榜单');
  });

  it('stays quiet when an unplaced pool card is dropped back on the pool', () => {
    // The reducer no-ops here, so「已移出榜单」would be wrong.
    expect(moveAnnouncement('夜壬', undefined, false)).toBeNull();
  });
});
