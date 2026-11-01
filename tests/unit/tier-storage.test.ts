import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_TIERS,
  DEFAULT_TITLE,
  type Board,
  type Tier,
} from '../../app/lib/tier/model';
import {
  CURRENT_BOARD_KEY,
  SNAPSHOTS_KEY,
  loadBoard,
  saveBoard,
} from '../../app/lib/tier/storage';
import {
  MAX_SNAPSHOTS,
  listSnapshots,
  pushSnapshot,
  removeSnapshot,
} from '../../app/lib/tier/snapshots';

class MemoryStorage implements Storage {
  private readonly items = new Map<string, string>();
  failRead = false;
  failWrite = false;

  get length(): number {
    return this.items.size;
  }

  clear(): void {
    this.items.clear();
  }

  getItem(key: string): string | null {
    if (this.failRead) {
      throw new Error('storage read blocked');
    }
    return this.items.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.items.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.items.delete(key);
  }

  setItem(key: string, value: string): void {
    if (this.failWrite) {
      throw new DOMException('quota exceeded', 'QuotaExceededError');
    }
    this.items.set(key, value);
  }
}

function makeTier(id: string, cards: number[] = []): Tier {
  return { id, name: id, color: '#123456', cards };
}

function makeBoard(overrides: Partial<Board> = {}): Board {
  return {
    version: 1,
    title: DEFAULT_TITLE,
    tiers: [makeTier('t-s', [1, 2]), makeTier('t-a', [3])],
    updatedAt: '2026-11-01T00:00:00.000Z',
    ...overrides,
  };
}

function storeRaw(storage: Storage, key: string, value: unknown): void {
  storage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
}

function expectDefaultBoard(board: Board): void {
  expect(board.version).toBe(1);
  expect(board.title).toBe(DEFAULT_TITLE);
  expect(board.tiers).toEqual(DEFAULT_TIERS);
  expect(board.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('loadBoard', () => {
  it('round-trips a saved board', () => {
    const storage = new MemoryStorage();
    const board = makeBoard();

    expect(saveBoard(board, storage)).toBe(true);
    expect(storage.getItem(CURRENT_BOARD_KEY)).toBe(JSON.stringify(board));

    const loaded = loadBoard(storage);
    expect(loaded.error).toBeUndefined();
    expect(loaded.board).toEqual(board);
  });

  it('returns a default board without an error when nothing is saved yet', () => {
    const loaded = loadBoard(new MemoryStorage());

    expect(loaded.error).toBeUndefined();
    expectDefaultBoard(loaded.board);
  });

  it('falls back to the default board when the JSON is corrupt', () => {
    const storage = new MemoryStorage();
    storeRaw(storage, CURRENT_BOARD_KEY, '{not json');

    const loaded = loadBoard(storage);
    expectDefaultBoard(loaded.board);
    expect(loaded.error).toMatch(/损坏/);
  });

  it('falls back when the version is not 1', () => {
    const storage = new MemoryStorage();
    storeRaw(storage, CURRENT_BOARD_KEY, { ...makeBoard(), version: 2 });

    const loaded = loadBoard(storage);
    expectDefaultBoard(loaded.board);
    expect(loaded.error).toMatch(/版本/);
  });

  it.each([
    ['an empty tier list', { ...makeBoard(), tiers: [] }],
    ['more than twelve tiers', {
      ...makeBoard(),
      tiers: Array.from({ length: 13 }, (_, index) => makeTier(`t-${index + 1}`)),
    }],
    ['a non-string title', { ...makeBoard(), title: 42 }],
    ['a missing updatedAt', { ...makeBoard(), updatedAt: undefined }],
    ['an invalid tier colour', {
      ...makeBoard(),
      tiers: [{ ...makeTier('t-s'), color: 'red' }],
    }],
    ['a non-numeric card', {
      ...makeBoard(),
      tiers: [{ ...makeTier('t-s'), cards: ['1'] }],
    }],
    ['a tier without a name', {
      ...makeBoard(),
      tiers: [{ ...makeTier('t-s'), name: '  ' }],
    }],
    ['duplicate tier ids', {
      ...makeBoard(),
      tiers: [makeTier('t-s'), makeTier('t-s')],
    }],
  ])('falls back when the stored board has %s', (_label, raw) => {
    const storage = new MemoryStorage();
    storeRaw(storage, CURRENT_BOARD_KEY, raw);

    const loaded = loadBoard(storage);
    expectDefaultBoard(loaded.board);
    expect(loaded.error).toBeTruthy();
  });

  it('keeps the first occurrence of a duplicated serial instead of failing', () => {
    const storage = new MemoryStorage();
    storeRaw(storage, CURRENT_BOARD_KEY, {
      ...makeBoard(),
      tiers: [makeTier('t-s', [1, 2]), makeTier('t-a', [2, 3])],
    });

    const loaded = loadBoard(storage);
    expect(loaded.error).toBeUndefined();
    expect(loaded.board.tiers[0]?.cards).toEqual([1, 2]);
    expect(loaded.board.tiers[1]?.cards).toEqual([3]);
  });

  it('falls back when reading storage throws', () => {
    const storage = new MemoryStorage();
    storage.failRead = true;

    const loaded = loadBoard(storage);
    expectDefaultBoard(loaded.board);
    expect(loaded.error).toMatch(/读取/);
  });

  it('falls back when localStorage is unavailable', () => {
    vi.stubGlobal('localStorage', undefined);

    const loaded = loadBoard();
    expectDefaultBoard(loaded.board);
    expect(loaded.error).toMatch(/不可用/);
  });
});

describe('saveBoard', () => {
  it('reports a failed write instead of throwing, keeping the previous board', () => {
    const storage = new MemoryStorage();
    const boardA = makeBoard({ title: '已有榜单' });
    const boardB = makeBoard({ title: '写不进去的榜单', tiers: [makeTier('t-s', [9])] });

    expect(saveBoard(boardA, storage)).toBe(true);
    storage.failWrite = true;

    expect(() => saveBoard(boardB, storage)).not.toThrow();
    expect(saveBoard(boardB, storage)).toBe(false);
    expect(storage.getItem(CURRENT_BOARD_KEY)).toBe(JSON.stringify(boardA));
    expect(loadBoard(storage).board.title).toBe('已有榜单');
  });

  it('returns false when localStorage is unavailable', () => {
    vi.stubGlobal('localStorage', undefined);

    expect(saveBoard(makeBoard())).toBe(false);
  });

  it('uses globalThis.localStorage by default', () => {
    window.localStorage.clear();

    expect(saveBoard(makeBoard())).toBe(true);
    expect(window.localStorage.getItem(CURRENT_BOARD_KEY)).toBe(JSON.stringify(makeBoard()));
  });
});

describe('snapshots', () => {
  it('prepends a snapshot with counts and a detached board copy', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-01T09:30:00.000Z'));
    const storage = new MemoryStorage();
    const board = makeBoard();

    pushSnapshot(board, '  重置前  ', storage);
    const [snapshot] = listSnapshots(storage);

    expect(snapshot).toBeDefined();
    expect(snapshot?.label).toBe('重置前');
    expect(snapshot?.createdAt).toBe('2026-11-01T09:30:00.000Z');
    expect(snapshot?.cardCount).toBe(3);
    expect(snapshot?.tierCount).toBe(2);
    expect(snapshot?.board).toEqual(board);
    expect(typeof snapshot?.id).toBe('string');
    expect(snapshot?.id).not.toBe('');

    board.tiers[0]?.cards.push(99);
    expect(listSnapshots(storage)[0]?.board.tiers[0]?.cards).toEqual([1, 2]);
  });

  it('falls back to a timestamp id when crypto.randomUUID is unavailable', () => {
    vi.stubGlobal('crypto', {});
    const storage = new MemoryStorage();

    pushSnapshot(makeBoard(), '没有 crypto', storage);
    const [snapshot] = listSnapshots(storage);

    expect(snapshot?.id).toMatch(/^snap-/);
    expect(snapshot?.label).toBe('没有 crypto');
  });

  it('falls back to a timestamp id when reading globalThis.crypto throws', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      get() {
        throw new Error('crypto blocked');
      },
    });

    try {
      const storage = new MemoryStorage();

      expect(() => pushSnapshot(makeBoard(), 'crypto 抛错', storage)).not.toThrow();
      expect(listSnapshots(storage)[0]?.id).toMatch(/^snap-/);
    } finally {
      if (original === undefined) {
        Reflect.deleteProperty(globalThis, 'crypto');
      } else {
        Object.defineProperty(globalThis, 'crypto', original);
      }
    }
  });

  it('falls back to a default label when the label is blank', () => {
    const storage = new MemoryStorage();
    pushSnapshot(makeBoard(), '   ', storage);

    expect(listSnapshots(storage)[0]?.label).toBe('快照');
  });

  it('keeps the newest 20 snapshots, newest first', () => {
    const storage = new MemoryStorage();

    for (let index = 0; index < MAX_SNAPSHOTS + 2; index += 1) {
      pushSnapshot(makeBoard(), `第 ${index} 次`, storage);
    }

    const snapshots = listSnapshots(storage);
    expect(snapshots).toHaveLength(MAX_SNAPSHOTS);
    expect(snapshots[0]?.label).toBe(`第 ${MAX_SNAPSHOTS + 1} 次`);
    expect(snapshots.at(-1)?.label).toBe('第 2 次');
    expect(new Set(snapshots.map((snapshot) => snapshot.id)).size).toBe(MAX_SNAPSHOTS);
  });

  it('skips corrupt entries and keeps the rest in order', () => {
    const storage = new MemoryStorage();
    const valid = {
      id: 'good',
      label: '正常',
      createdAt: '2026-11-01T00:00:00.000Z',
      cardCount: 3,
      tierCount: 2,
      board: makeBoard(),
    };
    storeRaw(storage, SNAPSHOTS_KEY, [
      { label: '缺少 id' },
      valid,
      { ...valid, id: 'bad-board', board: { ...makeBoard(), tiers: [] } },
      'garbage',
      null,
      { ...valid, id: 'bad-count', cardCount: '3' },
    ]);

    const snapshots = listSnapshots(storage);
    expect(snapshots.map((snapshot) => snapshot.id)).toEqual(['good']);
  });

  it('returns an empty list for corrupt or non-array payloads', () => {
    const storage = new MemoryStorage();
    expect(listSnapshots(storage)).toEqual([]);

    storeRaw(storage, SNAPSHOTS_KEY, '{oops');
    expect(listSnapshots(storage)).toEqual([]);

    storeRaw(storage, SNAPSHOTS_KEY, { not: 'an array' });
    expect(listSnapshots(storage)).toEqual([]);
  });

  it('starts a fresh history when the stored payload is corrupt', () => {
    const storage = new MemoryStorage();
    storeRaw(storage, SNAPSHOTS_KEY, '{oops');

    pushSnapshot(makeBoard(), '新快照', storage);
    expect(listSnapshots(storage).map((snapshot) => snapshot.label)).toEqual(['新快照']);
  });

  it('removes one snapshot and ignores unknown ids', () => {
    const storage = new MemoryStorage();
    pushSnapshot(makeBoard(), '第一个', storage);
    pushSnapshot(makeBoard(), '第二个', storage);

    const [newest, oldest] = listSnapshots(storage);
    expect(oldest).toBeDefined();

    removeSnapshot(oldest?.id ?? '', storage);
    expect(listSnapshots(storage).map((snapshot) => snapshot.label)).toEqual(['第二个']);

    const before = storage.getItem(SNAPSHOTS_KEY);
    removeSnapshot('missing-id', storage);
    expect(storage.getItem(SNAPSHOTS_KEY)).toBe(before);

    removeSnapshot(newest?.id ?? '', storage);
    expect(listSnapshots(storage)).toEqual([]);
  });

  it('does nothing when storage is unavailable', () => {
    vi.stubGlobal('localStorage', undefined);

    expect(() => pushSnapshot(makeBoard(), '快照')).not.toThrow();
    expect(listSnapshots()).toEqual([]);
    expect(() => removeSnapshot('x')).not.toThrow();
  });
});
