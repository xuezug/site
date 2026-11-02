/**
 * Persistence for the tier name-column width (the resizable strip between the
 * tier label and the drop area). Pure helpers so the clamp/storage rules can be
 * tested without a DOM.
 */

export const NAME_WIDTH_KEY = 'bl.tier.nameWidth.v1';
export const NAME_WIDTH_MIN = 56;
export const NAME_WIDTH_MAX = 240;

export function clampNameWidth(px: number): number {
  if (!Number.isFinite(px)) {
    return NAME_WIDTH_MIN;
  }
  return Math.min(NAME_WIDTH_MAX, Math.max(NAME_WIDTH_MIN, Math.round(px)));
}

export function readNameWidth(storage?: Storage): number | null {
  try {
    const target = storage ?? (typeof localStorage === 'undefined' ? undefined : localStorage);
    const raw = target?.getItem(NAME_WIDTH_KEY) ?? null;
    if (raw === null) {
      return null;
    }
    const value = Number.parseInt(raw, 10);
    return Number.isFinite(value) ? clampNameWidth(value) : null;
  } catch {
    return null;
  }
}

export function writeNameWidth(px: number | null, storage?: Storage): void {
  try {
    const target = storage ?? (typeof localStorage === 'undefined' ? undefined : localStorage);
    if (target === undefined) {
      return;
    }
    if (px === null) {
      target.removeItem(NAME_WIDTH_KEY);
    } else {
      target.setItem(NAME_WIDTH_KEY, String(clampNameWidth(px)));
    }
  } catch {
    // Quota or privacy-mode failures must not break the board.
  }
}

// ---------------------------------------------------------------------------
// Shared, hydration-safe snapshot for `useSyncExternalStore`. The server (and
// the hydration pass) sees `null`, so the CSS default renders first; the stored
// value arrives right after hydration without a mismatch warning.
// ---------------------------------------------------------------------------

let snapshot: number | null | undefined;
const listeners = new Set<() => void>();

export function subscribeNameWidth(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getNameWidthSnapshot(): number | null {
  if (snapshot === undefined) {
    snapshot = readNameWidth();
  }
  return snapshot;
}

export function setSharedNameWidth(px: number | null): void {
  snapshot = px === null ? null : clampNameWidth(px);
  writeNameWidth(snapshot);
  for (const listener of listeners) {
    listener();
  }
}
