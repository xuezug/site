/**
 * PNG export (design §6.6).
 *
 * Icons live on R2, so drawing them straight into a canvas would taint it.
 * Instead every placed icon is fetched as a Blob, turned into an object URL and
 * handed to the off-screen `ExportBoard`; `modern-screenshot` then re-embeds the
 * already-local blobs. A failed fetch (CORS is not configured yet — Task 11)
 * degrades to the placeholder tile and never aborts the export.
 *
 * Object URLs are created and revoked within a single call, so repeated
 * exports do not leak them.
 */

import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { createElement } from 'react';
import { domToPng } from 'modern-screenshot';
import { ExportBoard, EXPORT_MIN_WIDTH } from '../../components/tier/ExportBoard';
import { iconUrl } from '../cards/icon';
import type { Card } from '../cards/types';
import { exportFileName, triggerDownload } from './importExport';
import type { Board } from './model';

/** At most this many icon requests run at once during one export. */
export const EXPORT_ICON_CONCURRENCY = 8;

/** A stalled R2 request must degrade to a placeholder, not hang the export. */
export const ICON_TIMEOUT_MS = 5000;

/** Matches the site background so the PNG has no transparent margins. */
export const EXPORT_BACKGROUND = '#0b0d12';

type IconTarget = { serial: number; url: string };

/** Placed cards that have an icon, in board order. */
function iconTargets(board: Board, cards: ReadonlyMap<number, Card>): IconTarget[] {
  const targets: IconTarget[] = [];
  for (const tier of board.tiers) {
    for (const serial of tier.cards) {
      const card = cards.get(serial);
      if (card === undefined) {
        continue;
      }
      const url = iconUrl(card.iconPath);
      if (url === '') {
        continue;
      }
      targets.push({ serial, url });
    }
  }
  return targets;
}

/** Small worker pool: at most `limit` tasks in flight, results ignored. */
async function forEachLimited<T>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(Math.max(limit, 1), items.length) }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      const item = items[index];
      if (item === undefined) {
        return;
      }
      await task(item);
    }
  });
  await Promise.all(workers);
}

/**
 * Abort signal for one icon request. `AbortSignal.timeout` is missing on older
 * Safari, so it is feature-detected; without it a stalled request is simply
 * left to the browser's own network timeout.
 */
export function iconSignal(): AbortSignal | undefined {
  return typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(ICON_TIMEOUT_MS)
    : undefined;
}

/**
 * Fetch every icon into a Blob URL. Failures (including a 5s timeout) leave the
 * serial out of `icons` so the board renders the grey placeholder; this
 * function never rejects.
 */
async function loadIcons(
  targets: readonly IconTarget[],
  icons: Map<number, string>,
  createdUrls: string[],
): Promise<void> {
  await forEachLimited(targets, EXPORT_ICON_CONCURRENCY, async ({ serial, url }) => {
    try {
      const response = await fetch(url, { mode: 'cors', signal: iconSignal() });
      if (!response.ok) {
        return;
      }
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      createdUrls.push(objectUrl);
      icons.set(serial, objectUrl);
    } catch {
      // Placeholder tile: a missing icon must not fail the whole export.
    }
  });
}

function mountHost(): HTMLDivElement {
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.position = 'fixed';
  // Far off-screen rather than `display: none`: layout and computed styles are
  // only meaningful for a laid-out subtree, and animation frames are not
  // blocked, so the page keeps scrolling normally.
  host.style.left = '-99999px';
  host.style.top = '0';
  host.style.width = `${EXPORT_MIN_WIDTH}px`;
  host.style.pointerEvents = 'none';
  document.body.append(host);
  return host;
}

export type ExportPngOptions = {
  /** Called when icons could not be fetched and placeholder tiles were used. */
  onPlaceholder?: (missingCount: number) => void;
};

/**
 * Render the board off-screen, rasterise it at 2× and download the PNG.
 * Icon failures degrade to placeholders and are reported through
 * `onPlaceholder`; only a screenshot failure rejects (usually R2 CORS).
 */
export async function exportPng(
  board: Board,
  cards: Map<number, Card>,
  options: ExportPngOptions = {},
): Promise<void> {
  const icons = new Map<number, string>();
  const objectUrls: string[] = [];
  const targets = iconTargets(board, cards);
  const host = mountHost();
  const root = createRoot(host);

  try {
    await loadIcons(targets, icons, objectUrls);

    const missing = targets.length - icons.size;
    if (missing > 0 && options.onPlaceholder !== undefined) {
      try {
        options.onPlaceholder(missing);
      } catch {
        // A noisy warning callback must not break the export.
      }
    }

    flushSync(() => {
      root.render(createElement(ExportBoard, { board, cards, icons }));
    });

    const dataUrl = await domToPng(host, {
      scale: 2,
      backgroundColor: EXPORT_BACKGROUND,
    });
    triggerDownload(dataUrl, exportFileName('png'));
  } finally {
    root.unmount();
    host.remove();
    for (const url of objectUrls) {
      URL.revokeObjectURL(url);
    }
  }
}
