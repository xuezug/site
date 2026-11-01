import { useCallback } from 'react';
import type { Route } from './+types/tier';
import { TierBoard } from '../components/tier/TierBoard';
import { useBoard } from '../components/tier/useBoard';
import type { Card } from '../lib/cards/types';
import type { RouteHandle } from '../lib/seo/head';
import { SITE_NAME, TIER_DESCRIPTION } from '../lib/seo/meta';
import cardsJson from '../../src/data/cards.json';

// The export artifact is widened by `resolveJsonModule`; the shape itself is
// guaranteed by the export script (see Task 3 tests).
const CARDS = cardsJson as Card[];
const CARDS_BY_ID = new Map(CARDS.map((card) => [card.serial, card]));

/** Per-route OG, so `/tier` does not inherit the site-wide default title. */
export const handle: RouteHandle = {
  og: { title: '节奏榜', description: TIER_DESCRIPTION, type: 'website' },
};

export function meta(_args: Route.MetaArgs) {
  return [
    { title: `Tier Maker · ${SITE_NAME}` },
    { name: 'description', content: TIER_DESCRIPTION },
  ];
}

export default function Tier() {
  const {
    board,
    dispatch,
    restoreSnapshot,
    saveSnapshot,
    saveError,
    remoteUpdateAt,
    acknowledgeRemoteUpdate,
  } = useBoard(CARDS_BY_ID);

  const handleReset = useCallback(() => {
    // Snapshot first: the hook still sees the pre-reset board here.
    saveSnapshot('重置前');
    dispatch({ type: 'reset' });
  }, [dispatch, saveSnapshot]);

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h1 className="text-3xl font-bold">节奏榜</h1>
        <p className="text-sm leading-relaxed text-[var(--bl-muted)]">
          把卡片拖进档位，或用卡片右下角的「＋」按钮选择档位。改动会自动保存在本机浏览器。
        </p>
      </header>

      <TierBoard
        cards={CARDS}
        board={board}
        dispatch={dispatch}
        onSnapshot={saveSnapshot}
        onRestore={restoreSnapshot}
        onReset={handleReset}
        saveError={saveError}
        remoteUpdateAt={remoteUpdateAt}
        onRemoteUpdateAcknowledged={acknowledgeRemoteUpdate}
      />
    </div>
  );
}
