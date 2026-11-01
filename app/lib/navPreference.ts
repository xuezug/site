const COLLAPSE_KEY = 'bl.nav.collapsed.v1';
const COLLAPSE_EVENT = 'bl:nav-collapsed-change';

/** Used only when localStorage cannot be touched at all (blocked storage). */
let storageAvailable = true;
let memoryValue = false;

function read(): boolean {
  if (!storageAvailable) {
    return memoryValue;
  }

  try {
    return window.localStorage.getItem(COLLAPSE_KEY) === '1';
  } catch {
    storageAvailable = false;
    return memoryValue;
  }
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(COLLAPSE_EVENT, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(COLLAPSE_EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
}

/**
 * Sidebar collapse preference, exposed as an external store so it can be read
 * with `useSyncExternalStore`: the prerendered HTML and hydration use the
 * server snapshot (expanded), then React switches to the stored value.
 */
export const collapsedPreference = {
  subscribe,
  getSnapshot: read,
  getServerSnapshot: (): boolean => false,
  set(collapsed: boolean): void {
    memoryValue = collapsed;
    try {
      window.localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0');
    } catch {
      // Not persisted, but the in-memory value keeps the toggle working.
      storageAvailable = false;
    }
    window.dispatchEvent(new Event(COLLAPSE_EVENT));
  },
};
