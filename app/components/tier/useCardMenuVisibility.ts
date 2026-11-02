import { useCallback, useSyncExternalStore } from 'react';
import {
  getCardMenuSnapshot,
  setSharedCardMenu,
  subscribeCardMenu,
} from '../../lib/tier/cardMenuVisibility';

/** Show/hide the per-card「＋」menu; persisted across reloads. */
export function useCardMenuVisibility(): {
  visible: boolean;
  setVisible: (visible: boolean) => void;
} {
  const visible = useSyncExternalStore(subscribeCardMenu, getCardMenuSnapshot, () => true);

  const setVisible = useCallback((next: boolean) => {
    setSharedCardMenu(next);
  }, []);

  return { visible, setVisible };
}
