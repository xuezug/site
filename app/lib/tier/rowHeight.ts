/**
 * Persistence for the tier row height (the vertical room inside every tier
 * row). Pure helpers plus a hydration-safe snapshot shared by the board and the
 * toolbar control.
 */

export const ROW_HEIGHT_KEY = 'bl.tier.rowHeight.v1';
export const ROW_HEIGHT_MIN = 80;
export const ROW_HEIGHT_MAX = 320;
export const ROW_HEIGHT_DEFAULT = 128;
export const ROW_HEIGHT_STEP = 8;

export function clampRowHeight(px: number): number {
  if (!Number.isFinite(px)) {
    return ROW_HEIGHT_DEFAULT;
  }
  return Math.min(ROW_HEIGHT_MAX, Math.max(ROW_HEIGHT_MIN, Math.round(px)));
}

export function readRowHeight(storage?: Storage): number | null {
  try {
    const target = storage ?? (typeof localStorage === 'undefined' ? undefined : localStorage);
    const raw = target?.getItem(ROW_HEIGHT_KEY) ?? null;
    if (raw === null) {
      return null;
    }
    const value = Number.parseInt(raw, 10);
    return Number.isFinite(value) ? clampRowHeight(value) : null;
  } catch {
    return null;
  }
}

export function writeRowHeight(px: number | null, storage?: Storage): void {
  try {
    const target = storage ?? (typeof localStorage === 'undefined' ? undefined : localStorage);
    if (target === undefined) {
      return;
    }
    if (px === null) {
      target.removeItem(ROW_HEIGHT_KEY);
    } else {
      target.setItem(ROW_HEIGHT_KEY, String(clampRowHeight(px)));
    }
  } catch {
    // Quota/privacy failures must not break the board.
  }
}

let snapshot: number | null | undefined;
const listeners = new Set<() => void>();

export function subscribeRowHeight(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getRowHeightSnapshot(): number | null {
  if (snapshot === undefined) {
    snapshot = readRowHeight();
  }
  return snapshot;
}

export function setSharedRowHeight(px: number | null): void {
  snapshot = px === null ? null : clampRowHeight(px);
  writeRowHeight(snapshot);
  for (const listener of listeners) {
    listener();
  }
}
