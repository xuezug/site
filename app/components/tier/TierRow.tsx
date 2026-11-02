import { useEffect, useRef, useState } from 'react';
import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, rectSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { DraggableCard } from './CardTile';
import { TierHeader } from './TierHeader';
import type { Card } from '../../lib/cards/types';
import { cn } from '../../lib/cn';
import { cardDndId, tierDndId } from '../../lib/tier/dnd';
import type { Tier } from '../../lib/tier/model';
import { NAME_WIDTH_MAX, NAME_WIDTH_MIN, clampNameWidth } from '../../lib/tier/nameWidth';

type TierRowProps = {
  tier: Tier;
  index: number;
  count: number;
  /** All tiers, for the per-card「放入档位」menu. */
  tiers: readonly Tier[];
  /** Cards of this tier, in board order. */
  cards: readonly Card[];
  placedSerialSet: ReadonlySet<number>;
  disabledRemove: boolean;
  onRename: (id: string, name: string) => void;
  onChangeColor: (id: string, color: string) => void;
  onMoveTier: (id: string, delta: -1 | 1) => void;
  onRemoveTier: (tier: Tier) => void;
  onAssign: (serial: number, tierId: string | null) => void;
  /** Pinned name-column width, or `null` for the responsive default. */
  nameWidth: number | null;
  onResizeNameWidth: (px: number | null) => void;
};

type PlacedCardProps = {
  card: Card;
  tier: Tier;
  index: number;
  tiers: readonly Tier[];
  placedSerialSet: ReadonlySet<number>;
  onAssign: (serial: number, tierId: string | null) => void;
};

function PlacedCard({
  card,
  tier,
  index,
  tiers,
  placedSerialSet,
  onAssign,
}: PlacedCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: cardDndId(card.serial),
    // `index` is read back in `onDragEnd`; the reducer inserts into the
    // post-removal array, which is exactly what dnd-kit's index describes.
    data: { tierId: tier.id, index },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <DraggableCard
      card={card}
      tiers={tiers}
      tierName={tier.name}
      currentTierId={tier.id}
      placed={placedSerialSet.has(card.serial)}
      onAssign={onAssign}
      attributes={attributes}
      listeners={listeners}
      setNodeRef={setNodeRef}
      dragging={isDragging}
      testId="placed-card"
      style={style}
    />
  );
}

/**
 * One tier: header column on the left, drop zone on the right. The drop zone
 * keeps a 88px minimum height so an empty tier is still an obvious target.
 */
export function TierRow({
  tier,
  index,
  count,
  tiers,
  cards,
  placedSerialSet,
  disabledRemove,
  onRename,
  onChangeColor,
  onMoveTier,
  onRemoveTier,
  onAssign,
  nameWidth,
  onResizeNameWidth,
}: TierRowProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: tierDndId(tier.id),
    data: { tierId: tier.id },
  });

  const headerRef = useRef<HTMLDivElement>(null);
  const [liveWidth, setLiveWidth] = useState(88);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    const element = headerRef.current;
    if (element === null) {
      return;
    }
    const measure = (): void => setLiveWidth(Math.round(element.getBoundingClientRect().width));
    measure();
    if (typeof ResizeObserver === 'undefined') {
      return;
    }
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [nameWidth]);

  const startResize = (event: ReactPointerEvent<HTMLDivElement>): void => {
    event.preventDefault();
    event.stopPropagation();
    const element = headerRef.current;
    const startWidth = element?.getBoundingClientRect().width ?? liveWidth;
    dragRef.current = { startX: event.clientX, startWidth };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.focus();
  };

  const moveResize = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    if (drag === null) {
      return;
    }
    onResizeNameWidth(clampNameWidth(drag.startWidth + event.clientX - drag.startX));
  };

  const endResize = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (dragRef.current === null) {
      return;
    }
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const keyResize = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
      return;
    }
    event.preventDefault();
    const step = event.shiftKey ? 24 : 8;
    const base = nameWidth ?? liveWidth;
    onResizeNameWidth(clampNameWidth(base + (event.key === 'ArrowRight' ? step : -step)));
  };

  // Board index per rendered card: a serial that is no longer in cards.json is
  // skipped visually, but the remaining indices still match the board order.
  const boardIndex = new Map(tier.cards.map((serial, position) => [serial, position]));

  return (
    <div
      data-testid={`tier-${tier.id}`}
      role="group"
      aria-label={`档位 ${tier.name}`}
      className="grid grid-cols-[var(--bl-tier-name-w)_8px_1fr] items-stretch"
    >
      <TierHeader
        rootRef={headerRef}
        tier={tier}
        index={index}
        count={count}
        onChangeName={onRename}
        onChangeColor={onChangeColor}
        onMove={onMoveTier}
        onRemove={() => onRemoveTier(tier)}
        disabledRemove={disabledRemove}
      />

      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={`调整 ${tier.name} 名称列宽度`}
        aria-valuemin={NAME_WIDTH_MIN}
        aria-valuemax={NAME_WIDTH_MAX}
        aria-valuenow={Math.round(nameWidth ?? liveWidth)}
        title="拖动调整名称列宽度，双击恢复默认"
        tabIndex={0}
        onPointerDown={startResize}
        onPointerMove={moveResize}
        onPointerUp={endResize}
        onPointerCancel={endResize}
        onKeyDown={keyResize}
        onDoubleClick={() => onResizeNameWidth(null)}
        className="group relative cursor-col-resize touch-none select-none rounded outline-none focus-visible:ring-2 focus-visible:ring-[var(--bl-accent)]"
      >
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-2 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors group-hover:bg-[var(--bl-border-strong)] group-focus-visible:bg-[var(--bl-accent)]"
        />
      </div>

      <div
        ref={setNodeRef}
        className={cn(
          'flex min-h-[128px] flex-wrap content-start gap-1.5 rounded-lg border border-dashed p-2 transition-colors',
          isOver
            ? 'border-[color:var(--bl-accent)] bg-[var(--bl-accent-soft)]'
            : 'border-[color:var(--bl-border)] bg-[var(--bl-panel)]',
        )}
      >
        {cards.length === 0 ? (
          <p className="self-center text-xs text-[var(--bl-muted)]">拖入卡片</p>
        ) : (
          <SortableContext
            items={cards.map((card) => cardDndId(card.serial))}
            strategy={rectSortingStrategy}
          >
            <ul className="flex flex-wrap gap-1.5">
              {cards.map((card) => (
                <PlacedCard
                  key={card.serial}
                  card={card}
                  tier={tier}
                  index={boardIndex.get(card.serial) ?? 0}
                  tiers={tiers}
                  placedSerialSet={placedSerialSet}
                  onAssign={onAssign}
                />
              ))}
            </ul>
          </SortableContext>
        )}
      </div>
    </div>
  );
}
