import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_TIERS,
  DEFAULT_TITLE,
  MAX_TIERS,
  NEW_TIER_NAME,
  TIER_COLORS,
  createDefaultBoard,
  placedSerials,
  type Board,
  type Tier,
} from '../../app/lib/tier/model';
import { boardReducer, type Action } from '../../app/lib/tier/reducer';

function makeBoard(overrides: Partial<Board> = {}): Board {
  return {
    version: 1,
    title: DEFAULT_TITLE,
    tiers: DEFAULT_TIERS.map((tier) => ({ ...tier, cards: [...tier.cards] })),
    updatedAt: '2026-10-31T00:00:00.000Z',
    ...overrides,
  };
}

function makeTier(id: string, cards: number[] = []): Tier {
  return { id, name: id, color: '#123456', cards };
}

type MoveAction = Extract<Action, { type: 'move' }>;

function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const UNIVERSE = Array.from({ length: 40 }, (_, index) => index + 1);

/** Six tiers of five cards each, leaving ten serials in the (derived) pool. */
function seededBoard(): Board {
  return makeBoard({
    tiers: DEFAULT_TIERS.map((tier, index) => ({
      ...tier,
      cards: UNIVERSE.slice(index * 5, index * 5 + 5),
    })),
  });
}

function randomWalk(
  seed: number,
  steps: number,
  observe?: (board: Board, move: MoveAction) => void,
): Board {
  const random = createRandom(seed);
  const tierIds = DEFAULT_TIERS.map((tier) => tier.id);
  let board = seededBoard();

  for (let step = 0; step < steps; step += 1) {
    const serial = UNIVERSE[Math.floor(random() * UNIVERSE.length)] ?? 1;
    const targetId = tierIds[Math.floor(random() * tierIds.length)] ?? 't-s';
    const move: MoveAction = {
      type: 'move',
      serial,
      toTier: random() < 0.3 ? null : targetId,
      index: random() < 0.6 ? Math.floor(random() * 10) - 2 : undefined,
    };
    board = boardReducer(board, move);
    observe?.(board, move);
  }
  return board;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('DEFAULT_TIERS', () => {
  it('is the fixed S A B C D F list with the documented colours', () => {
    expect(DEFAULT_TIERS.map((tier) => [tier.id, tier.name, tier.color])).toEqual([
      ['t-s', 'S', '#e11d48'],
      ['t-a', 'A', '#f97316'],
      ['t-b', 'B', '#eab308'],
      ['t-c', 'C', '#22c55e'],
      ['t-d', 'D', '#3b82f6'],
      ['t-f', 'F', '#8b5cf6'],
    ]);
    expect(DEFAULT_TIERS.every((tier) => tier.cards.length === 0)).toBe(true);
    expect(DEFAULT_TITLE).toBe('我的节奏榜');
  });

  it('is deep-copied into the default board', () => {
    const board = createDefaultBoard('2026-11-01T00:00:00.000Z');
    expect(board).toEqual({
      version: 1,
      title: DEFAULT_TITLE,
      tiers: DEFAULT_TIERS,
      updatedAt: '2026-11-01T00:00:00.000Z',
    });
    expect(board.tiers).not.toBe(DEFAULT_TIERS);
    expect(board.tiers[0]).not.toBe(DEFAULT_TIERS[0]);
  });
});

describe('move', () => {
  it('takes a pool card into a tier and appends it by default', () => {
    const state = makeBoard({ tiers: [makeTier('t-s', [4, 5]), makeTier('t-a')] });
    const next = boardReducer(state, { type: 'move', serial: 9, toTier: 't-s' });

    expect(next.tiers[0]?.cards).toEqual([4, 5, 9]);
    expect(next.tiers[1]?.cards).toEqual([]);
    expect(next.version).toBe(1);
  });

  it('returns the original board for a pool card dropped on an unknown tier or on the pool', () => {
    const state = makeBoard({ tiers: [makeTier('t-s', [4])] });

    expect(boardReducer(state, { type: 'move', serial: 9, toTier: 't-missing' })).toBe(state);
    expect(boardReducer(state, { type: 'move', serial: 9, toTier: null })).toBe(state);
    expect(boardReducer(state, { type: 'move', serial: 9, toTier: null, index: 0 })).toBe(state);
  });

  it('treats a same-tier index as measured after removing the card', () => {
    const state = makeBoard({ tiers: [makeTier('t-s', [1, 2, 3, 4])] });

    // Remove 2 -> [1, 3, 4]; insert at 2 -> [1, 3, 2, 4].
    const next = boardReducer(state, { type: 'move', serial: 2, toTier: 't-s', index: 2 });
    expect(next.tiers[0]?.cards).toEqual([1, 3, 2, 4]);

    // Moving to its own post-removal slot is a genuine no-op.
    expect(boardReducer(state, { type: 'move', serial: 2, toTier: 't-s', index: 1 })).toBe(state);
  });

  it('removes from the source tier before inserting into the target tier', () => {
    const state = makeBoard({
      tiers: [makeTier('t-s', [1, 2, 3]), makeTier('t-a', [4, 5])],
    });
    const next = boardReducer(state, { type: 'move', serial: 2, toTier: 't-a', index: 1 });

    expect(next.tiers[0]?.cards).toEqual([1, 3]);
    expect(next.tiers[1]?.cards).toEqual([4, 2, 5]);
    expect(placedSerials(next)).toEqual(new Set([1, 3, 4, 2, 5]));
  });

  it('clamps an out-of-range index to the target bounds', () => {
    const state = makeBoard({ tiers: [makeTier('t-s', [1]), makeTier('t-a', [2, 3])] });

    const append = boardReducer(state, { type: 'move', serial: 1, toTier: 't-a', index: 99 });
    expect(append.tiers[1]?.cards).toEqual([2, 3, 1]);

    const prepend = boardReducer(state, { type: 'move', serial: 1, toTier: 't-a', index: -5 });
    expect(prepend.tiers[1]?.cards).toEqual([1, 2, 3]);
  });

  it('sends a card back to the pool for `toTier: null`, removing it everywhere', () => {
    const state = makeBoard({
      tiers: [makeTier('t-s', [1, 2]), makeTier('t-a', [3])],
    });
    const next = boardReducer(state, { type: 'move', serial: 2, toTier: null });

    expect(next.tiers[0]?.cards).toEqual([1]);
    expect(placedSerials(next)).toEqual(new Set([1, 3]));
    expect(next.tiers.every((tier) => !tier.cards.includes(2))).toBe(true);
  });

  it('never creates a duplicate serial', () => {
    const state = makeBoard({ tiers: [makeTier('t-s', [7, 8]), makeTier('t-a', [8])] });
    const next = boardReducer(state, { type: 'move', serial: 8, toTier: 't-a', index: 0 });
    const cards = next.tiers.flatMap((tier) => tier.cards);

    expect(cards.filter((serial) => serial === 8)).toHaveLength(1);
  });
});

describe('tiers', () => {
  it('adds one tier with a free numeric id, the default name and the next palette colour', () => {
    const next = boardReducer(makeBoard(), { type: 'addTier' });

    expect(next.tiers).toHaveLength(7);
    expect(next.tiers[6]).toEqual({
      id: 't-1',
      name: NEW_TIER_NAME,
      color: '#ec4899',
      cards: [],
    });
    expect(TIER_COLORS[6]).toBe('#ec4899');
  });

  it('skips non-numeric ids when scanning and never reuses a number', () => {
    const state = makeBoard({
      tiers: [makeTier('t-s'), makeTier('t-1'), makeTier('t-3')],
    });
    const next = boardReducer(state, { type: 'addTier' });

    expect(next.tiers.map((tier) => tier.id)).toEqual(['t-s', 't-1', 't-3', 't-4']);
  });

  it('refuses a thirteenth tier by returning the same object', () => {
    const state = makeBoard({
      tiers: Array.from({ length: MAX_TIERS }, (_, index) => makeTier(`t-${index + 1}`)),
    });

    expect(boardReducer(state, { type: 'addTier' })).toBe(state);
  });

  it('removes only the tier, leaving its cards to the derived pool', () => {
    const state = makeBoard({
      tiers: [makeTier('t-s', [1, 2]), makeTier('t-a', [3])],
    });
    const next = boardReducer(state, { type: 'removeTier', id: 't-s' });

    expect(next.tiers.map((tier) => tier.id)).toEqual(['t-a']);
    expect(placedSerials(next)).toEqual(new Set([3]));
    // 1 and 2 are no longer in any tier, so the pool shows them again in place.
    expect([...placedSerials(next)].includes(1)).toBe(false);
  });

  it('keeps at least one tier and ignores unknown ids', () => {
    const single = makeBoard({ tiers: [makeTier('t-s', [1])] });

    expect(boardReducer(single, { type: 'removeTier', id: 't-s' })).toBe(single);
    expect(boardReducer(single, { type: 'removeTier', id: 't-missing' })).toBe(single);
  });

  it('renames a tier after trimming, and falls back to the old name when blank', () => {
    const state = makeBoard({ tiers: [makeTier('t-s', [1]), makeTier('t-a')] });

    const renamed = boardReducer(state, { type: 'renameTier', id: 't-a', name: '  神  ' });
    expect(renamed.tiers[1]?.name).toBe('神');

    expect(boardReducer(state, { type: 'renameTier', id: 't-a', name: '   ' })).toBe(state);
    expect(boardReducer(state, { type: 'renameTier', id: 't-a', name: 't-a' })).toBe(state);
    expect(boardReducer(state, { type: 'renameTier', id: 't-missing', name: 'X' })).toBe(state);
  });

  it('accepts only #rgb/#rrggbb colours and keeps the old colour otherwise', () => {
    const state = makeBoard({ tiers: [makeTier('t-s', [1]), makeTier('t-a')] });

    expect(boardReducer(state, { type: 'setTierColor', id: 't-a', color: '#abc' }).tiers[1]?.color)
      .toBe('#abc');
    expect(
      boardReducer(state, { type: 'setTierColor', id: 't-a', color: '#AABBCC' }).tiers[1]?.color,
    ).toBe('#AABBCC');
    expect(boardReducer(state, { type: 'setTierColor', id: 't-a', color: 'red' })).toBe(state);
    expect(boardReducer(state, { type: 'setTierColor', id: 't-a', color: '#12345' })).toBe(state);
    expect(boardReducer(state, { type: 'setTierColor', id: 't-a', color: '#123456' })).toBe(state);
  });

  it('moves a tier by one slot and refuses to move past the ends', () => {
    const state = makeBoard({ tiers: [makeTier('t-s'), makeTier('t-a'), makeTier('t-b')] });

    const down = boardReducer(state, { type: 'moveTier', id: 't-s', delta: 1 });
    expect(down.tiers.map((tier) => tier.id)).toEqual(['t-a', 't-s', 't-b']);

    const up = boardReducer(state, { type: 'moveTier', id: 't-b', delta: -1 });
    expect(up.tiers.map((tier) => tier.id)).toEqual(['t-s', 't-b', 't-a']);

    expect(boardReducer(state, { type: 'moveTier', id: 't-s', delta: -1 })).toBe(state);
    expect(boardReducer(state, { type: 'moveTier', id: 't-b', delta: 1 })).toBe(state);
    expect(boardReducer(state, { type: 'moveTier', id: 't-missing', delta: 1 })).toBe(state);
  });
});

describe('board title', () => {
  it('renames the board after trimming and ignores a blank title', () => {
    const state = makeBoard({ title: '旧标题' });

    expect(boardReducer(state, { type: 'renameBoard', title: '  新标题 ' }).title).toBe('新标题');
    expect(boardReducer(state, { type: 'renameBoard', title: '   ' })).toBe(state);
    expect(boardReducer(state, { type: 'renameBoard', title: '旧标题' })).toBe(state);
  });
});

describe('reset and load', () => {
  it('restores the default tiers and title with a deep copy', () => {
    const state = makeBoard({
      title: '自定义',
      tiers: [makeTier('t-s', [1, 2]), makeTier('t-x')],
    });
    const next = boardReducer(state, { type: 'reset' });

    expect(next.title).toBe(DEFAULT_TITLE);
    expect(next.tiers).toEqual(DEFAULT_TIERS);
    expect(next.tiers).not.toBe(DEFAULT_TIERS);

    next.tiers[0]?.cards.push(99);
    expect(DEFAULT_TIERS[0]?.cards).toEqual([]);
  });

  it('loads a board, deduplicating serials by first occurrence', () => {
    const incoming = makeBoard({
      title: '导入的榜单',
      tiers: [makeTier('t-s', [1, 2]), makeTier('t-a', [2, 3])],
    });
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-01T08:00:00.000Z'));

    const next = boardReducer(makeBoard(), { type: 'load', board: incoming });

    expect(next.title).toBe('导入的榜单');
    expect(next.tiers[0]?.cards).toEqual([1, 2]);
    expect(next.tiers[1]?.cards).toEqual([3]);
    expect(next.updatedAt).toBe('2026-11-01T08:00:00.000Z');
    expect(next).not.toBe(incoming);
  });

  it('ignores an invalid board', () => {
    const state = makeBoard();
    const broken = { ...makeBoard(), version: 2 } as unknown as Board;

    expect(boardReducer(state, { type: 'load', board: broken })).toBe(state);
  });
});

describe('updatedAt', () => {
  it('is stamped with the current ISO time on every effective action', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-01T12:34:56.000Z'));

    const state = makeBoard();
    const actions: Action[] = [
      { type: 'addTier' },
      { type: 'renameTier', id: 't-s', name: 'S+' },
      { type: 'setTierColor', id: 't-s', color: '#000' },
      { type: 'moveTier', id: 't-a', delta: -1 },
      { type: 'renameBoard', title: '新标题' },
      { type: 'move', serial: 1, toTier: 't-s' },
      { type: 'reset' },
    ];

    for (const action of actions) {
      const next = boardReducer(state, action);
      expect(next).not.toBe(state);
      expect(next.updatedAt).toBe('2026-11-01T12:34:56.000Z');
    }
  });

  it('is unchanged when an action is a no-op', () => {
    const state = makeBoard({ updatedAt: '2020-01-01T00:00:00.000Z' });
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-01T12:34:56.000Z'));

    const noOps: Action[] = [
      { type: 'move', serial: 1, toTier: null },
      { type: 'renameTier', id: 't-s', name: ' ' },
      { type: 'setTierColor', id: 't-s', color: 'blue' },
      { type: 'moveTier', id: 't-s', delta: -1 },
      { type: 'renameBoard', title: '' },
      { type: 'removeTier', id: 't-missing' },
    ];

    for (const action of noOps) {
      expect(boardReducer(state, action)).toBe(state);
    }
  });
});

describe('randomized moves', () => {
  it('keeps serials unique and accounted for across 100 seeded moves', () => {
    const expected = new Set(UNIVERSE.slice(0, 30));
    const duplicates: number[] = [];

    const board = randomWalk(20261101, 100, (current, move) => {
      if (move.toTier === null) {
        expected.delete(move.serial);
      } else {
        expected.add(move.serial);
      }

      const seen = new Set<number>();
      for (const tier of current.tiers) {
        for (const serial of tier.cards) {
          if (seen.has(serial)) {
            duplicates.push(serial);
          }
          seen.add(serial);
        }
      }

      const hits = current.tiers.flatMap((tier) => tier.cards).filter((serial) => serial === move.serial);
      expect(hits).toHaveLength(move.toTier === null ? 0 : 1);
      expect(seen.size).toBe(expected.size);
      expect(current.tiers).toHaveLength(DEFAULT_TIERS.length);
    });

    expect(duplicates).toEqual([]);
    expect([...placedSerials(board)].sort((a, b) => a - b)).toEqual(
      [...expected].sort((a, b) => a - b),
    );
    expect(board.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('is reproducible from the same seed, so a failure can be replayed', () => {
    // Freeze the clock so `updatedAt` cannot differ between the two runs.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-01T00:00:00.000Z'));

    expect(JSON.stringify(randomWalk(7, 100))).toBe(JSON.stringify(randomWalk(7, 100)));
    expect(JSON.stringify(randomWalk(7, 100))).not.toBe(JSON.stringify(randomWalk(8, 100)));
  });
});
