import { describe, expect, it } from 'vitest';
import type { CollisionDetection, Over } from '@dnd-kit/core';
import {
  cardDndId,
  parseDropTarget,
  parseSerial,
  tierBoardCollisionDetection,
  tierDndId,
} from '../../app/lib/tier/dnd';
import type { Board } from '../../app/lib/tier/model';
import { boardReducer } from '../../app/lib/tier/reducer';

const RECT = { top: 0, left: 0, right: 10, bottom: 10, width: 10, height: 10 };

function makeOver(id: string, data?: Record<string, unknown>): Over {
  return {
    id,
    rect: RECT,
    disabled: false,
    data: { current: data },
  };
}

function makeBoard(): Board {
  return {
    version: 1,
    title: '测试榜',
    updatedAt: '2026-11-01T00:00:00.000Z',
    tiers: [
      { id: 't-s', name: 'S', color: '#e11d48', cards: [1, 2, 3] },
      { id: 't-a', name: 'A', color: '#f97316', cards: [4] },
    ],
  };
}

type DetectionArgs = Parameters<CollisionDetection>[0];

describe('dnd ids', () => {
  it('round-trips card serials and tier ids', () => {
    expect(cardDndId(42)).toBe('card:42');
    expect(tierDndId('t-s')).toBe('tier:t-s');
    expect(parseSerial(cardDndId(42))).toBe(42);
    expect(parseSerial(tierDndId('t-s'))).toBeNull();
    expect(parseSerial('card:')).toBeNull();
    expect(parseSerial('card:abc')).toBeNull();
  });
});

describe('parseDropTarget', () => {
  it('resolves the pool branch', () => {
    expect(parseDropTarget(makeOver('pool'))).toEqual({ tierId: null });
  });

  it('resolves the tier branch as an append', () => {
    const target = parseDropTarget(makeOver(tierDndId('t-b')));
    expect(target).toEqual({ tierId: 't-b' });
    expect(target?.index).toBeUndefined();
  });

  it('resolves the card branch from its droppable data', () => {
    expect(
      parseDropTarget(makeOver(cardDndId(7), { tierId: 't-c', index: 2 })),
    ).toEqual({ tierId: 't-c', index: 2 });

    // A pool card carries no tierId, so dropping onto it is a no-op.
    expect(parseDropTarget(makeOver(cardDndId(7), { from: 'pool' }))).toBeNull();
  });

  it('ignores unknown and malformed ids', () => {
    expect(parseDropTarget(makeOver('mystery'))).toBeNull();
    expect(parseDropTarget(makeOver('tier:'))).toBeNull();
    expect(parseDropTarget(makeOver(cardDndId(7), { tierId: 5 }))).toBeNull();
  });
});

describe('drop index rule', () => {
  it('reorders inside one tier using the post-removal index', () => {
    const board = makeBoard();
    const target = parseDropTarget(makeOver(cardDndId(3), { tierId: 't-s', index: 0 }));
    expect(target).not.toBeNull();

    const next = boardReducer(board, {
      type: 'move',
      serial: 3,
      toTier: target?.tierId ?? null,
      index: target?.index,
    });

    // Same array move semantics as dnd-kit's `arrayMove([1,2,3], 2, 0)`.
    expect(next.tiers[0]?.cards).toEqual([3, 1, 2]);
  });

  it('inserts into another tier at the reported index', () => {
    const board = makeBoard();
    const target = parseDropTarget(makeOver(cardDndId(4), { tierId: 't-a', index: 0 }));
    expect(target).not.toBeNull();

    const next = boardReducer(board, {
      type: 'move',
      serial: 1,
      toTier: target?.tierId ?? null,
      index: target?.index,
    });

    expect(next.tiers[0]?.cards).toEqual([2, 3]);
    expect(next.tiers[1]?.cards).toEqual([1, 4]);
  });

  it('appends when the over target is a tier row', () => {
    const board = makeBoard();
    const target = parseDropTarget(makeOver(tierDndId('t-a')));
    expect(target).not.toBeNull();

    const next = boardReducer(board, {
      type: 'move',
      serial: 1,
      toTier: target?.tierId ?? null,
      index: target?.index,
    });

    expect(next.tiers[1]?.cards).toEqual([4, 1]);
  });

  it('removes the card when the over target is the pool', () => {
    const board = makeBoard();
    const target = parseDropTarget(makeOver('pool'));
    expect(target).not.toBeNull();

    const next = boardReducer(board, {
      type: 'move',
      serial: 2,
      toTier: target?.tierId ?? null,
      index: target?.index,
    });

    expect(next.tiers[0]?.cards).toEqual([1, 3]);
  });
});

describe('tierBoardCollisionDetection', () => {
  const tierRect = { top: 0, left: 0, right: 400, bottom: 100, width: 400, height: 100 };
  // A nearby droppable whose centre is close to the dragged card but which does
  // not contain it: `closestCenter` alone would pick this, `pointerWithin`
  // (from the card centre) must pick the tier that actually contains it.
  const nearRect = { top: 0, left: 0, right: 4, bottom: 4, width: 4, height: 4 };
  const tierContainer = {
    id: tierDndId('t-s'),
    key: tierDndId('t-s'),
    data: { current: {} },
    disabled: false,
    node: { current: null },
    rect: { current: tierRect },
  };
  const nearContainer = {
    id: cardDndId(9),
    key: cardDndId(9),
    data: { current: {} },
    disabled: false,
    node: { current: null },
    rect: { current: nearRect },
  };
  const collisionRect = { top: 0, left: 0, right: 10, bottom: 10, width: 10, height: 10 };
  const args = {
    active: { id: cardDndId(1), data: { current: {} }, rect: { current: {} } },
    collisionRect,
    droppableRects: new Map([
      [tierContainer.id, tierRect],
      [nearContainer.id, nearRect],
    ]),
    droppableContainers: [tierContainer, nearContainer],
    pointerCoordinates: null,
  } as unknown as DetectionArgs;

  it('aims a keyboard drag from the card centre, so large targets stay reachable', () => {
    const collisions = tierBoardCollisionDetection(args);
    expect(collisions[0]?.id).toBe(tierDndId('t-s'));
  });

  it('falls back to the nearest centre when the card is between droppables', () => {
    const farRect = { top: 200, left: 200, right: 240, bottom: 240, width: 40, height: 40 };
    const emptyArgs = {
      ...args,
      droppableRects: new Map([[tierDndId('t-s'), farRect]]),
      droppableContainers: [{ ...tierContainer, rect: { current: farRect } }],
    } as unknown as DetectionArgs;

    const collisions = tierBoardCollisionDetection(emptyArgs);
    expect(collisions[0]?.id).toBe(tierDndId('t-s'));
  });

  it('keeps pointerWithin for pointer drags and ignores targets under the pointer', () => {
    const collisions = tierBoardCollisionDetection({
      ...args,
      pointerCoordinates: { x: 50, y: 50 },
    });
    // (50,50) is inside the tier, not inside the 4px card.
    expect(collisions.map((collision) => collision.id)).toEqual([tierDndId('t-s')]);
  });
});
