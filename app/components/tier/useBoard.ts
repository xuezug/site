import { useCallback, useEffect, useRef, useState } from 'react';
import type { Card } from '../../lib/cards/types';
import { createDefaultBoard, type Board } from '../../lib/tier/model';
import { boardReducer, type Action } from '../../lib/tier/reducer';
import { listSnapshots, pushSnapshot } from '../../lib/tier/snapshots';
import { CURRENT_BOARD_KEY, loadBoard, saveBoard } from '../../lib/tier/storage';

/** Design §6.5: debounce writes to the current board. */
export const SAVE_DEBOUNCE_MS = 300;

/** Label used by the toolbar's「保存快照」button. */
export const DEFAULT_SNAPSHOT_LABEL = '手动快照';

const SAVE_FAILED = '保存失败：浏览器存储不可用或空间已满，本次改动只保留在当前页面';

export type BoardApi = {
  board: Board;
  dispatch: (action: Action) => void;
  restoreSnapshot: (id: string) => void;
  saveSnapshot: (label?: string) => void;
  /** Load or save problem, phrased for the user; `null` while storage is healthy. */
  saveError: string | null;
  /** `updatedAt` of a board just applied from another tab, else `null`. */
  remoteUpdateAt: string | null;
  /** Marks the cross-tab notice as shown, so it fires exactly once. */
  acknowledgeRemoteUpdate: () => void;
};

/**
 * Owns the tier board state and its localStorage side effects (design §6.5).
 *
 * - The first render always uses the default board so prerendered HTML and the
 *   hydration pass match; stored data is applied from an effect.
 * - Every change is written 300ms after it settles (never during render). The
 *   latest board also lives in a ref, so an edit made in the last 300ms is
 *   flushed when the page unmounts instead of being dropped.
 * - A failed load is reported once and the default board is used; that first
 *   fallback is not written back, so a corrupt payload is not silently
 *   replaced. The message is cleared by the next successful save (one error
 *   state for load and save failures).
 * - `cardsById` guards `move` actions: a serial missing from `cards.json`
 *   (stale storage, future imports) can never enter a tier.
 * - A `storage` event for `bl.tier.current.v1` from another tab is adopted when
 *   it validates and carries a new `updatedAt`; the timestamp is exposed once
 *   as `remoteUpdateAt` so the board can show a sync toast.
 */
export function useBoard(cardsById: ReadonlyMap<number, Card>): BoardApi {
  const [board, setBoard] = useState<Board>(() => createDefaultBoard());
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [remoteUpdateAt, setRemoteUpdateAt] = useState<string | null>(null);

  const boardRef = useRef(board);
  const cardsRef = useRef(cardsById);
  const dirty = useRef(false);
  const skipNextSave = useRef(false);
  /** Last remote timestamp applied, so one write cannot notify twice. */
  const lastRemoteAt = useRef<string | null>(null);

  useEffect(() => {
    cardsRef.current = cardsById;
  }, [cardsById]);

  useEffect(() => {
    const loaded = loadBoard();
    boardRef.current = loaded.board;
    skipNextSave.current = loaded.error !== undefined;
    // localStorage is only readable after mount: reading it during render
    // would either run on the server (no storage) or mismatch the prerendered
    // HTML. Applying the stored board in an effect is the hydration-safe path.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- post-hydration load
    setBoard(loaded.board);
    setError(loaded.error ?? null);
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) {
      return;
    }
    if (skipNextSave.current) {
      skipNextSave.current = false;
      return;
    }

    const timer = setTimeout(() => {
      if (saveBoard(board)) {
        setError(null);
      } else {
        setError(SAVE_FAILED);
      }
    }, SAVE_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [board, ready]);

  // Flush the pending write when the page goes away; clearing the debounce
  // timer alone would lose an edit made shortly before navigation.
  useEffect(
    () => () => {
      if (dirty.current) {
        saveBoard(boardRef.current);
      }
    },
    [],
  );

  const commit = useCallback((next: Board) => {
    boardRef.current = next;
    dirty.current = true;
    setBoard(next);
  }, []);

  const dispatch = useCallback(
    (action: Action) => {
      if (action.type === 'move' && !cardsRef.current.has(action.serial)) {
        return;
      }
      const next = boardReducer(boardRef.current, action);
      if (next !== boardRef.current) {
        commit(next);
      }
    },
    [commit],
  );

  // Cross-tab sync: `storage` fires only in the *other* tabs, so this tab can
  // adopt what they wrote without echo loops (the write-back below just gets
  // ignored there when the content already matches).
  useEffect(() => {
    const handleStorage = (event: StorageEvent): void => {
      if (event.key !== CURRENT_BOARD_KEY || event.newValue === null) {
        return;
      }
      // `loadBoard` validates the whole payload; a malformed or foreign value
      // reported an error and is dropped without touching the board.
      const loaded = loadBoard();
      if (loaded.error !== undefined) {
        return;
      }
      if (loaded.board.updatedAt === boardRef.current.updatedAt) {
        return;
      }
      if (loaded.board.updatedAt === lastRemoteAt.current) {
        return;
      }
      lastRemoteAt.current = loaded.board.updatedAt;
      const before = boardRef.current;
      dispatch({ type: 'load', board: loaded.board });
      // Only announce a real change. The debounced write-back of the applied
      // board reaches the originating tab as another `storage` event whose
      // content matches, so notifying there would be a false "synced" toast.
      if (boardRef.current !== before) {
        setRemoteUpdateAt(loaded.board.updatedAt);
      }
    };

    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [dispatch]);

  const acknowledgeRemoteUpdate = useCallback(() => {
    setRemoteUpdateAt(null);
  }, []);

  const saveSnapshot = useCallback((label: string = DEFAULT_SNAPSHOT_LABEL) => {
    pushSnapshot(boardRef.current, label);
  }, []);

  const restoreSnapshot = useCallback(
    (id: string) => {
      const snapshot = listSnapshots().find((candidate) => candidate.id === id);
      if (snapshot === undefined) {
        return;
      }
      const next = boardReducer(boardRef.current, { type: 'load', board: snapshot.board });
      if (next !== boardRef.current) {
        commit(next);
      }
    },
    [commit],
  );

  return {
    board,
    dispatch,
    restoreSnapshot,
    saveSnapshot,
    saveError: error,
    remoteUpdateAt,
    acknowledgeRemoteUpdate,
  };
}
