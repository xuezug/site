/**
 * Whether the per-card「＋」menu is shown. Drag-and-drop remains available when
 * it is hidden; the toolbar toggle is the accessible way back.
 */

export const CARD_MENU_KEY = 'bl.tier.cardMenu.v1';

export function readCardMenu(storage?: Storage): boolean {
  try {
    const target = storage ?? (typeof localStorage === 'undefined' ? undefined : localStorage);
    return target?.getItem(CARD_MENU_KEY) !== '0';
  } catch {
    return true;
  }
}

export function writeCardMenu(visible: boolean, storage?: Storage): void {
  try {
    const target = storage ?? (typeof localStorage === 'undefined' ? undefined : localStorage);
    target?.setItem(CARD_MENU_KEY, visible ? '1' : '0');
  } catch {
    // Quota/privacy failures must not break the board.
  }
}

let snapshot: boolean | undefined;
const listeners = new Set<() => void>();

export function subscribeCardMenu(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getCardMenuSnapshot(): boolean {
  if (snapshot === undefined) {
    snapshot = readCardMenu();
  }
  return snapshot;
}

export function setSharedCardMenu(visible: boolean): void {
  snapshot = visible;
  writeCardMenu(visible);
  for (const listener of listeners) {
    listener();
  }
}
