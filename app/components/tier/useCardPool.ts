import { useMemo } from 'react';
import { filterCards } from '../../lib/cards/filters';
import { sortCards } from '../../lib/cards/sort';
import type { AttrId, CareerId, FactionId } from '../../lib/cards/taxonomy';
import type { Card } from '../../lib/cards/types';

/**
 * Pool filter state (design §6.4). Unlike `Filters` from the cards library,
 * `onlyUnplaced` is required here: the pool always knows whether the「仅看未
 * 上榜」switch was explicitly turned off, which keeps the empty/active
 * detection in `hasActiveFilters` exact.
 *
 * Filters are intentionally *not* persisted — a refresh shows all 916 cards.
 */
export type PoolFilters = {
  query: string;
  attribute?: AttrId;
  faction?: FactionId;
  career?: CareerId;
  star?: number;
  onlyUnplaced: boolean;
};

/** No filtering at all: the pool shows every card. */
export const EMPTY_FILTERS: PoolFilters = { query: '', onlyUnplaced: false };

/** `true` when at least one dimension is narrowing the list. */
export function hasActiveFilters(filters: PoolFilters): boolean {
  return (
    filters.query.trim() !== '' ||
    filters.attribute !== undefined ||
    filters.faction !== undefined ||
    filters.career !== undefined ||
    filters.star !== undefined ||
    filters.onlyUnplaced
  );
}

export type CardPoolView = {
  /** Filtered cards in display order (star desc, then pinyin name). */
  items: Card[];
  /** Cards matching the current filters. */
  filteredCount: number;
  /** Cards currently sitting in a tier (catalog-wide, not filter-scoped). */
  placedCount: number;
  /** Catalog size, independent of the filters. */
  total: number;
};

/**
 * Filter + sort the pool in memory (design §6.4: 916 rows, memoised).
 *
 * The result is memoised on the identity of `cards`, `placed` and `filters`;
 * the hook therefore expects all three to be stable values (state or memoised
 * inputs) rather than fresh literals on every render.
 */
export function useCardPool(
  cards: readonly Card[],
  placed: ReadonlySet<number>,
  filters: PoolFilters,
): CardPoolView {
  const items = useMemo(() => sortCards(filterCards(cards, filters, placed)), [cards, filters, placed]);

  const placedCount = useMemo(() => {
    let count = 0;
    for (const card of cards) {
      if (placed.has(card.serial)) {
        count += 1;
      }
    }
    return count;
  }, [cards, placed]);

  return { items, filteredCount: items.length, placedCount, total: cards.length };
}
