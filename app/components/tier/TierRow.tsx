import { useDroppable } from '@dnd-kit/core';
import { SortableContext, rectSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { DraggableCard } from './CardTile';
import { TierHeader } from './TierHeader';
import type { Card } from '../../lib/cards/types';
import { cn } from '../../lib/cn';
import { cardDndId, tierDndId } from '../../lib/tier/dnd';
import type { Tier } from '../../lib/tier/model';

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
}: TierRowProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: tierDndId(tier.id),
    data: { tierId: tier.id },
  });

  // Board index per rendered card: a serial that is no longer in cards.json is
  // skipped visually, but the remaining indices still match the board order.
  const boardIndex = new Map(tier.cards.map((serial, position) => [serial, position]));

  return (
    <div
      data-testid={`tier-${tier.id}`}
      role="group"
      aria-label={`档位 ${tier.name}`}
      className="grid grid-cols-[64px_1fr] items-stretch gap-2 md:grid-cols-[88px_1fr]"
    >
      <TierHeader
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
        ref={setNodeRef}
        className={cn(
          'flex min-h-[88px] flex-wrap content-start gap-1.5 rounded-lg border border-dashed p-2 transition-colors',
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
