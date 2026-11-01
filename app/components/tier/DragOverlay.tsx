import { DragOverlay as DndDragOverlay } from '@dnd-kit/core';
import { CardFace } from './CardTile';
import type { Card } from '../../lib/cards/types';

type BoardDragOverlayProps = {
  card: Card | null;
  /** Tier the overlay is currently over, shown as a corner badge. */
  badge?: string;
};

/**
 * The floating copy shown while dragging (design §6.3: slight scale-up plus a
 * shadow). It is purely visual: dnd-kit's overlay never takes part in
 * collision detection.
 */
export function BoardDragOverlay({ card, badge }: BoardDragOverlayProps) {
  return (
    <DndDragOverlay dropAnimation={null} zIndex={90}>
      {card === null ? null : (
        <div className="scale-105 rotate-1 shadow-2xl">
          <CardFace card={card} size="overlay" badge={badge} />
        </div>
      )}
    </DndDragOverlay>
  );
}
