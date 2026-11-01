/**
 * localStorage persistence for the current tier board (design §6.5).
 *
 * Debouncing (300ms) belongs to the hook in Task 6; this module only reads,
 * validates and writes. Every failure path is silent from the caller's point of
 * view: `loadBoard` falls back to the default board with a Chinese message and
 * `saveBoard` reports `false` instead of throwing.
 */

import { createDefaultBoard, parseBoard, type Board, type BoardIssue } from './model';

/** Current board (design §6.5). */
export const CURRENT_BOARD_KEY = 'bl.tier.current.v1';

/** Snapshot history (design §6.5); owned by `snapshots.ts`. */
export const SNAPSHOTS_KEY = 'bl.tier.snapshots.v1';

const STORAGE_MISSING = '浏览器存储不可用，已使用默认榜单（本次修改不会被保存）';
const STORAGE_READ_FAILED = '读取本地存储失败，已使用默认榜单';
const CORRUPT_JSON = '本地榜单数据已损坏（JSON 解析失败），已恢复默认榜单';
const UNSUPPORTED_VERSION = '本地榜单版本不受支持，已恢复默认榜单';
const INVALID_TIERS = '本地榜单档位数据不正确（应为 1–12 个档位），已恢复默认榜单';
const INVALID_TIER = '本地榜单档位数据不正确，已恢复默认榜单';
const DUPLICATE_TIER_ID = '本地榜单档位 id 重复，已恢复默认榜单';
const INVALID_SHAPE = '本地榜单数据格式不正确，已恢复默认榜单';

function isStorageLike(value: unknown): value is Storage {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Partial<Storage>;
  return typeof candidate.getItem === 'function' && typeof candidate.setItem === 'function';
}

/**
 * Resolve the injected storage, defaulting to `globalThis.localStorage`.
 * Accessing `localStorage` itself can throw when storage is blocked, hence the
 * try/catch and the `null` result.
 */
export function getStorage(storage?: Storage): Storage | null {
  if (storage !== undefined) {
    return storage;
  }
  try {
    const candidate: unknown = globalThis.localStorage;
    return isStorageLike(candidate) ? candidate : null;
  } catch {
    return null;
  }
}

function describeIssue(issue: BoardIssue): string {
  switch (issue) {
    case 'version':
      return UNSUPPORTED_VERSION;
    case 'tiers':
      return INVALID_TIERS;
    case 'tier':
      return INVALID_TIER;
    case 'duplicate-tier-id':
      return DUPLICATE_TIER_ID;
    default:
      return INVALID_SHAPE;
  }
}

/** Read + validate the stored board, falling back to the default board. */
export function loadBoard(storage?: Storage): { board: Board; error?: string } {
  const store = getStorage(storage);
  if (store === null) {
    return { board: createDefaultBoard(), error: STORAGE_MISSING };
  }

  let raw: string | null;
  try {
    raw = store.getItem(CURRENT_BOARD_KEY);
  } catch {
    return { board: createDefaultBoard(), error: STORAGE_READ_FAILED };
  }

  // Nothing saved yet: a fresh board, not an error.
  if (raw === null) {
    return { board: createDefaultBoard() };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { board: createDefaultBoard(), error: CORRUPT_JSON };
  }

  const result = parseBoard(parsed);
  if (!result.ok) {
    return { board: createDefaultBoard(), error: describeIssue(result.issue) };
  }
  return { board: result.board };
}

/** Persist the board. Returns `false` when storage is missing or the write fails. */
export function saveBoard(board: Board, storage?: Storage): boolean {
  const store = getStorage(storage);
  if (store === null) {
    return false;
  }
  try {
    store.setItem(CURRENT_BOARD_KEY, JSON.stringify(board));
    return true;
  } catch {
    return false;
  }
}
