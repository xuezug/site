/**
 * Snapshot history (design §6.5): at most `MAX_SNAPSHOTS` entries, newest
 * first, stored under `bl.tier.snapshots.v1` (FIFO eviction).
 *
 * Snapshots are best-effort: a corrupt entry is skipped on read and a failed
 * write is ignored, because losing a safety copy must never break the board
 * the user is editing.
 */

import { cloneBoard, parseBoard, placedSerials, type Board } from './model';
import { getStorage, SNAPSHOTS_KEY } from './storage';

export type Snapshot = {
  id: string;
  label: string;
  createdAt: string;
  cardCount: number;
  tierCount: number;
  board: Board;
};

export const MAX_SNAPSHOTS = 20;

const DEFAULT_LABEL = '快照';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function createSnapshotId(): string {
  // Reading `globalThis.crypto` itself can throw (blocked/privacy mode), and so
  // can `randomUUID` (needs a secure context); either way we degrade to the
  // timestamp id instead of letting the failure escape `pushSnapshot`.
  try {
    const cryptoApi: Crypto | undefined = globalThis.crypto;
    if (cryptoApi !== undefined && typeof cryptoApi.randomUUID === 'function') {
      return cryptoApi.randomUUID();
    }
  } catch {
    // Fall through to the timestamp-based id below.
  }
  return `snap-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Raw JSON payload; any shape problem degrades to "no snapshots". */
function readSnapshotList(store: Storage): unknown[] {
  let raw: string | null;
  try {
    raw = store.getItem(SNAPSHOTS_KEY);
  } catch {
    return [];
  }
  if (raw === null) {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  return Array.isArray(parsed) ? parsed : [];
}

function parseSnapshot(value: unknown): Snapshot | null {
  if (!isRecord(value)) {
    return null;
  }
  const { id, label, createdAt, cardCount, tierCount } = value;
  if (typeof id !== 'string' || id === '') {
    return null;
  }
  if (typeof label !== 'string' || typeof createdAt !== 'string') {
    return null;
  }
  if (typeof cardCount !== 'number' || !Number.isSafeInteger(cardCount) || cardCount < 0) {
    return null;
  }
  if (typeof tierCount !== 'number' || !Number.isSafeInteger(tierCount) || tierCount < 1) {
    return null;
  }

  const board = parseBoard(value.board);
  if (!board.ok) {
    return null;
  }
  return { id, label, createdAt, cardCount, tierCount, board: board.board };
}

function parseSnapshotList(values: readonly unknown[]): Snapshot[] {
  const snapshots: Snapshot[] = [];
  for (const value of values) {
    const snapshot = parseSnapshot(value);
    if (snapshot !== null) {
      snapshots.push(snapshot);
    }
  }
  return snapshots;
}

function writeSnapshotList(store: Storage, snapshots: readonly Snapshot[]): boolean {
  try {
    store.setItem(SNAPSHOTS_KEY, JSON.stringify(snapshots));
    return true;
  } catch {
    return false;
  }
}

/** Prepend a snapshot of `board`; newest first, oldest evicted past 20. */
export function pushSnapshot(board: Board, label: string, storage?: Storage): void {
  const store = getStorage(storage);
  if (store === null) {
    return;
  }

  const trimmedLabel = label.trim();
  const snapshot: Snapshot = {
    id: createSnapshotId(),
    label: trimmedLabel === '' ? DEFAULT_LABEL : trimmedLabel,
    createdAt: new Date().toISOString(),
    cardCount: placedSerials(board).size,
    tierCount: board.tiers.length,
    board: cloneBoard(board),
  };

  const existing = parseSnapshotList(readSnapshotList(store));
  writeSnapshotList(store, [snapshot, ...existing].slice(0, MAX_SNAPSHOTS));
}

/** Stored snapshots, newest first. Corrupt entries are skipped. */
export function listSnapshots(storage?: Storage): Snapshot[] {
  const store = getStorage(storage);
  if (store === null) {
    return [];
  }
  return parseSnapshotList(readSnapshotList(store));
}

/** Remove one snapshot; unknown ids are a no-op. */
export function removeSnapshot(id: string, storage?: Storage): void {
  const store = getStorage(storage);
  if (store === null) {
    return;
  }

  const existing = parseSnapshotList(readSnapshotList(store));
  const remaining = existing.filter((snapshot) => snapshot.id !== id);
  if (remaining.length === existing.length) {
    return;
  }
  writeSnapshotList(store, remaining);
}
