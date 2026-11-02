import { useCallback, useSyncExternalStore } from 'react';
import {
  clampRowHeight,
  getRowHeightSnapshot,
  setSharedRowHeight,
  subscribeRowHeight,
} from '../../lib/tier/rowHeight';

/**
 * Shared tier-row height. `null` means the CSS default (128px); the value is
 * persisted so a custom height survives reloads.
 */
export function useRowHeight(): {
  height: number | null;
  setHeight: (px: number | null) => void;
} {
  const height = useSyncExternalStore(subscribeRowHeight, getRowHeightSnapshot, () => null);

  const setHeight = useCallback((px: number | null) => {
    setSharedRowHeight(px === null ? null : clampRowHeight(px));
  }, []);

  return { height, setHeight };
}
