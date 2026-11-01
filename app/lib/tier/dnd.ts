/**
 * dnd-kit id conventions and drop resolution for the tier board.
 *
 * Kept free of React so the four `over` branches and the index rule can be
 * unit-tested without a DOM (see `tests/unit/tier-dnd.test.ts`).
 */

import { closestCenter, pointerWithin } from '@dnd-kit/core';
import type {
  CollisionDetection,
  KeyboardCoordinateGetter,
  Over,
  UniqueIdentifier,
} from '@dnd-kit/core';
import { KeyboardCode } from '@dnd-kit/core';

export const CARD_PREFIX = 'card:';
export const TIER_PREFIX = 'tier:';
export const POOL_ID = 'pool';
/**
 * Pool copies of *placed* cards (design §6.1 keeps them in the pool, dimmed)
 * must not reuse the tier copy's `card:<serial>` id: dnd-kit keys its
 * registries by id, so a second draggable with the same id would shadow the
 * sortable one. The pool therefore owns a separate id space.
 */
export const POOL_CARD_PREFIX = 'pool-card:';

/** Droppable id of a tier row. */
export function tierDndId(tierId: string): string {
  return `${TIER_PREFIX}${tierId}`;
}

/** Draggable/sortable id of a card inside a tier (or of an unplaced card). */
export function cardDndId(serial: number): string {
  return `${CARD_PREFIX}${serial}`;
}

/** Draggable id of a card tile rendered inside the pool. */
export function poolCardDndId(serial: number): string {
  return `${POOL_CARD_PREFIX}${serial}`;
}

/** `card:<serial>` / `pool-card:<serial>` → serial, anything else → `null`. */
export function parseSerial(id: UniqueIdentifier): number | null {
  const text = String(id);
  const prefix = text.startsWith(CARD_PREFIX)
    ? CARD_PREFIX
    : text.startsWith(POOL_CARD_PREFIX)
      ? POOL_CARD_PREFIX
      : null;
  if (prefix === null) {
    return null;
  }
  const serial = Number.parseInt(text.slice(prefix.length), 10);
  return Number.isSafeInteger(serial) ? serial : null;
}

export type DropTarget = { tierId: string | null; index?: number };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Translate dnd-kit's `over` into reducer terms (brief「DnD 细则」):
 *
 * - `tier:<id>` → append to that tier,
 * - `card:<serial>` → its `data.{tierId,index}`; the reducer inserts into the
 *   post-removal array, which is exactly what dnd-kit's index describes, so
 *   same-tier and cross-tier drops use the same number,
 * - `pool` → remove from the board,
 * - anything else → `null` (no-op).
 */
export function parseDropTarget(over: Over): DropTarget | null {
  const text = String(over.id);

  if (text === POOL_ID) {
    return { tierId: null };
  }

  if (text.startsWith(TIER_PREFIX)) {
    const tierId = text.slice(TIER_PREFIX.length);
    return tierId === '' ? null : { tierId };
  }

  if (text.startsWith(CARD_PREFIX)) {
    const data: unknown = over.data.current;
    if (!isRecord(data)) {
      return null;
    }
    const tierId = data['tierId'];
    const index = data['index'];
    if (typeof tierId !== 'string') {
      return null;
    }
    return { tierId, index: typeof index === 'number' ? index : undefined };
  }

  return null;
}

/**
 * Collision detection that works for both input families.
 *
 * `pointerWithin` needs pointer coordinates; a `KeyboardEvent` has none, so
 * calling it directly returns `[]` and a keyboard drop never resolves. For
 * keyboard drags we aim from the centre of the dragged card instead: that
 * keeps large targets (a tier row, the pool) reachable, while nested targets
 * (a card inside a tier) still win by being closer. Only when the card sits
 * between droppables do we fall back to the nearest centre.
 */
export const tierBoardCollisionDetection: CollisionDetection = (args) => {
  if (args.pointerCoordinates !== null) {
    return pointerWithin(args);
  }

  const { collisionRect } = args;
  const pointerCoordinates = {
    x: collisionRect.left + collisionRect.width / 2,
    y: collisionRect.top + collisionRect.height / 2,
  };
  const collisions = pointerWithin({ ...args, pointerCoordinates });
  return collisions.length > 0 ? collisions : closestCenter(args);
};

/** Keyboard drags move in fixed steps, like dnd-kit's default getter. */
const KEYBOARD_STEP = 25;

/**
 * Coordinate getter for `KeyboardSensor`.
 *
 * `sortableKeyboardCoordinates` jumps to other droppables, which fights the
 * sensor's scroll clamping on this tall page (the drag stalls over the pool
 * and never reaches a tier). A fixed-step getter is predictable: every arrow
 * press moves the card 25px, and collision detection resolves whatever tier or
 * pool it is over.
 */
export const tierBoardKeyboardCoordinates: KeyboardCoordinateGetter = (
  event,
  { currentCoordinates },
) => {
  let deltaX = 0;
  let deltaY = 0;

  switch (event.code) {
    case KeyboardCode.Down:
      deltaY = KEYBOARD_STEP;
      break;
    case KeyboardCode.Up:
      deltaY = -KEYBOARD_STEP;
      break;
    case KeyboardCode.Left:
      deltaX = -KEYBOARD_STEP;
      break;
    case KeyboardCode.Right:
      deltaX = KEYBOARD_STEP;
      break;
    default:
      return undefined;
  }

  event.preventDefault();
  return {
    x: currentCoordinates.x + deltaX,
    y: currentCoordinates.y + deltaY,
  };
};
