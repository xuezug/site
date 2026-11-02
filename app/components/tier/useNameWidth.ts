import { useCallback, useState, useSyncExternalStore } from 'react';
import {
  clampNameWidth,
  getNameWidthSnapshot,
  setSharedNameWidth,
  subscribeNameWidth,
} from '../../lib/tier/nameWidth';

/**
 * Shared name-column width for every tier row.
 *
 * `null` means "use the responsive CSS default" (64px on phones, 88px from
 * `md`); a number pins all rows to that pixel width. The value is persisted so
 * a wide column survives reloads.
 */
export function useNameWidth(): {
  width: number | null;
  setWidth: (px: number | null) => void;
} {
  const stored = useSyncExternalStore(
    subscribeNameWidth,
    getNameWidthSnapshot,
    () => null,
  );
  // Live drag value wins until it is committed; resetting clears both.
  const [override, setOverride] = useState<number | null>(null);
  const width = override ?? stored;

  const setWidth = useCallback((px: number | null) => {
    const next = px === null ? null : clampNameWidth(px);
    setOverride(next);
    // Write immediately: a drag can be followed by a reload before any
    // debounce timer fires.
    setSharedNameWidth(next);
  }, []);

  return { width, setWidth };
}
