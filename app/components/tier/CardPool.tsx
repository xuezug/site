import { useCallback, useMemo, useRef, useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { FilterBar } from './FilterBar';
import { PoolCard } from './CardTile';
import { Button } from '../ui/Button';
import { EMPTY_FILTERS, useCardPool, type PoolFilters } from './useCardPool';
import type { Card } from '../../lib/cards/types';
import { cn } from '../../lib/cn';
import { POOL_ID } from '../../lib/tier/dnd';
import type { Tier } from '../../lib/tier/model';

type CardPoolProps = {
  cards: readonly Card[];
  tiers: readonly Tier[];
  /** Serials that already sit in a tier; they stay in the pool, dimmed. */
  placed: ReadonlySet<number>;
  onMove: (serial: number, tierId: string | null) => void;
};

/**
 * 角色池（design §6.1/§6.4）: the filter toolbar plus the 916-tile grid.
 *
 * Only the list (or its empty state) is the `pool` droppable — the toolbar is
 * deliberately *not* a drop target, so dropping a card on the search box can
 * never remove it from the board. Placed cards are *not* removed from the
 * pool: they render dimmed with a tier badge so the board reads as a single
 * set of cards. Dropping a card on the list still removes it from the board
 * (Task 6 behaviour, `pool` droppable id unchanged).
 */
export function CardPool({ cards, tiers, placed, onMove }: CardPoolProps) {
  const [filters, setFilters] = useState<PoolFilters>(EMPTY_FILTERS);
  const { items, filteredCount, placedCount, total } = useCardPool(cards, placed, filters);
  const { setNodeRef, isOver } = useDroppable({ id: POOL_ID });
  // Shared with FilterBar so both「清空筛选」buttons can restore focus to it.
  const searchRef = useRef<HTMLInputElement>(null);

  const handleFilters = useCallback((next: PoolFilters) => {
    setFilters(next);
  }, []);

  const clearFilters = useCallback(() => {
    setFilters(EMPTY_FILTERS);
    // The empty-state button unmounts as the list comes back; without this,
    // focus would fall to <body>.
    searchRef.current?.focus();
  }, []);

  // serial → owning tier, so a placed tile can label itself「已在 S 档」.
  const tierBySerial = useMemo(() => {
    const map = new Map<number, Tier>();
    for (const tier of tiers) {
      for (const serial of tier.cards) {
        map.set(serial, tier);
      }
    }
    return map;
  }, [tiers]);

  return (
    <section
      aria-labelledby="card-pool-heading"
      data-testid="card-pool"
      className="flex flex-col gap-3 rounded-xl border border-[color:var(--bl-border)] bg-[var(--bl-panel)]/40 p-3"
    >
      <h2 id="card-pool-heading" className="text-base font-semibold">
        角色池
      </h2>

      <FilterBar
        value={filters}
        onChange={handleFilters}
        filteredCount={filteredCount}
        total={total}
        placedCount={placedCount}
        searchRef={searchRef}
      />

      <noscript>启用 JavaScript 后可拖拽排序；结构化数据见 /data/cards.json。</noscript>

      <div
        ref={setNodeRef}
        data-testid="pool-dropzone"
        className={cn(
          'rounded-lg transition-colors',
          isOver && 'bg-[var(--bl-accent-soft)] ring-2 ring-[color:var(--bl-accent)]',
        )}
      >
        {items.length === 0 ? (
          <div
            data-testid="pool-empty"
            className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-[color:var(--bl-border)] px-3 py-8"
          >
            <p id="pool-empty-message" className="text-center text-xs text-[var(--bl-muted)]">
              没有符合条件的卡片
            </p>
            <Button size="sm" variant="ghost" onClick={clearFilters} aria-describedby="pool-empty-message">
              清空筛选
            </Button>
          </div>
        ) : (
          <ul className="grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10">
            {items.map((card) => (
              <PoolCard
                key={card.serial}
                card={card}
                tiers={tiers}
                placedTier={tierBySerial.get(card.serial) ?? null}
                onAssign={onMove}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
