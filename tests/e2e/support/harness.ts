/**
 * Shared helpers for the Playwright specs (Task 12).
 *
 * Two rules live here so every spec follows them:
 *
 * - **Offline**: every `card_icons/*.png` request is intercepted. `ok` serves
 *   the 1×1 `fixtures/tiny.png`, `broken` answers 500 (the PNG CORS fallback),
 *   so a run never touches R2.
 * - **Clean state**: `resetBoardStorage()` clears the board/snapshot keys
 *   before the document loads, so tests never inherit a neighbour's board.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Locator, Page } from '@playwright/test';

export const SITE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const FIXTURES_DIR = path.join(SITE_ROOT, 'tests', 'e2e', 'fixtures');

const TINY_PNG = fs.readFileSync(path.join(FIXTURES_DIR, 'tiny.png'));

/** Indexed keys of the board/snapshot store (`app/lib/tier/storage.ts`). */
export const BOARD_KEY = 'bl.tier.current.v1';
export const SNAPSHOTS_KEY = 'bl.tier.snapshots.v1';

export type IconMode = 'ok' | 'broken';

/**
 * Answer every icon request locally. `broken` mimics icons blocked at the
 * network/CORS layer, which must degrade to placeholder tiles instead of
 * failing the export. The export fetches carry a `?v=` cache key, so the
 * pattern must allow a query string.
 */
export async function stubCardIcons(page: Page, mode: IconMode = 'ok'): Promise<void> {
  await page.route(/\/card_icons\/[^?]+\.png(?:\?.*)?$/, (route) =>
    mode === 'ok'
      ? route.fulfill({ status: 200, contentType: 'image/png', body: TINY_PNG })
      : route.fulfill({ status: 500, contentType: 'text/plain', body: 'icon unavailable' }),
  );
}

/**
 * Wipe the persisted board before the document's own scripts run.
 *
 * Only the *first* document of the context is cleared: `sessionStorage`
 * survives a `page.reload()`, so the "still there after refresh" case keeps the
 * board it is supposed to verify. (Playwright already gives every test a fresh
 * context; this keeps the intent explicit and survives a reused context.)
 */
export async function resetBoardStorage(page: Page): Promise<void> {
  await page.addInitScript(
    ([boardKey, snapshotsKey]) => {
      try {
        if (sessionStorage.getItem('bl.e2e.cleared') === '1') {
          return;
        }
        sessionStorage.setItem('bl.e2e.cleared', '1');
        localStorage.removeItem(boardKey ?? '');
        localStorage.removeItem(snapshotsKey ?? '');
      } catch {
        // Storage can be blocked; the specs then simply start from defaults.
      }
    },
    [BOARD_KEY, SNAPSHOTS_KEY],
  );
}

export type StoredTier = { id: string; name: string; color: string; cards: number[] };
export type StoredBoard = { version: number; title: string; tiers: StoredTier[]; updatedAt: string };

/** The board as persisted by the 300ms debounce, or `null` before any edit. */
export async function readStoredBoard(page: Page): Promise<StoredBoard | null> {
  return page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    if (raw === null) {
      return null;
    }
    try {
      return JSON.parse(raw) as StoredBoard;
    } catch {
      return null;
    }
  }, BOARD_KEY);
}

/** `/tier`, with the pool rendered. */
export async function openTier(page: Page): Promise<void> {
  await page.goto('/tier');
  await page.getByTestId('pool-card').first().waitFor();
}

export function tierRow(page: Page, tierId: string): Locator {
  return page.getByTestId(`tier-${tierId}`);
}

/** Cards currently sitting in one tier (`t-s`, `t-a`, …). */
export function placedCards(page: Page, tierId: string): Locator {
  return tierRow(page, tierId).getByTestId('placed-card');
}

export function poolCards(page: Page): Locator {
  return page.getByTestId('pool-card');
}

/** Visible card name of a tile (the `<p>` under the image). */
export async function cardName(card: Locator): Promise<string> {
  // `textContent`, not `innerText`: pool tiles use `content-visibility: auto`,
  // so off-screen tiles have no laid-out text to measure.
  const name = (await card.locator('p').first().textContent())?.trim() ?? '';
  if (name === '') {
    throw new Error('card tile has no visible name');
  }
  return name;
}

/** Every card name currently rendered in the pool, in display order. */
export async function poolCardNames(page: Page): Promise<string[]> {
  return (await poolCards(page).locator('p').allTextContents()).map((name) => name.trim());
}

/** Card names may contain `.` (`Ms.徐`), so never interpolate them raw. */
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The「＋」menu (design §6.3). Opening it moves focus to the first item, so the
 * same helper drives both the pointer and the keyboard path.
 */
export async function openCardMenu(page: Page, card: Locator): Promise<Locator> {
  const name = await cardName(card);
  await card.getByRole('button', { name: `${name} 放入档位` }).click();
  const menu = page.getByRole('menu', { name: `${name} 档位菜单` });
  await menu.waitFor();
  return menu;
}

/** Non-drag placement: 「＋」→ 「放入 X 档」. */
export async function placeWithMenu(
  page: Page,
  card: Locator,
  tierName: string,
): Promise<string> {
  const name = await cardName(card);
  const menu = await openCardMenu(page, card);
  await menu.getByRole('menuitem', { name: `放入 ${tierName} 档` }).click();
  await menu.waitFor({ state: 'detached' });
  return name;
}

/** A point inside `locator`'s box, as fractions of its width/height. */
export async function boxPoint(
  locator: Locator,
  fx: number,
  fy: number,
): Promise<{ x: number; y: number }> {
  const box = await locator.boundingBox();
  if (box === null) {
    throw new Error('drop target is not visible');
  }
  return { x: box.x + box.width * fx, y: box.y + box.height * fy };
}

/**
 * Real pointer drag, as dnd-kit's `MouseSensor` needs it: the first move has to
 * clear the 5px activation constraint, then the pointer travels to the target
 * in several steps (dnd-kit recomputes collisions per pointer move) before the
 * release.
 */
export async function dragToPoint(
  page: Page,
  from: Locator,
  target: { x: number; y: number },
): Promise<void> {
  await from.scrollIntoViewIfNeeded();
  const box = await from.boundingBox();
  if (box === null) {
    throw new Error('drag source is not visible');
  }

  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  // Clear the activation distance before heading for the drop target.
  await page.mouse.move(startX + 8, startY + 8, { steps: 4 });
  await page.mouse.move(target.x, target.y, { steps: 16 });
  // A last 1px nudge makes dnd-kit settle the collision on the final cell.
  await page.mouse.move(target.x + 1, target.y + 1, { steps: 2 });
  await page.mouse.up();
}

/** Drag `from` onto another element, using a point inside its box. */
export async function dragToLocator(
  page: Page,
  from: Locator,
  to: Locator,
  fx = 0.5,
  fy = 0.5,
): Promise<void> {
  await from.scrollIntoViewIfNeeded();
  await dragToPoint(page, from, await boxPoint(to, fx, fy));
}

declare global {
  interface Window {
    /** Toast texts observed by `startToastLog`, oldest first. */
    __e2eToasts?: string[];
  }
}

/**
 * Record every toast (`role="status"`) from now on.
 *
 * Toasts disappear after 3s, which is shorter than a PNG render on a slow
 * machine, so the specs read this list afterwards instead of racing a locator.
 */
export async function startToastLog(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.__e2eToasts = [];
    const record = (): void => {
      for (const element of document.querySelectorAll('[role="status"]')) {
        const text = (element.textContent ?? '').trim();
        if (text !== '' && window.__e2eToasts?.includes(text) !== true) {
          window.__e2eToasts?.push(text);
        }
      }
    };
    record();
    new MutationObserver(record).observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  });
}

/** Everything `startToastLog` has seen so far. */
export async function readToastLog(page: Page): Promise<string[]> {
  return page.evaluate(() => window.__e2eToasts ?? []);
}

/** `dist/` path of a URL the preview server exposes (directory indexes included). */
export function distFileFor(urlPath: string): string {
  const clean = decodeURIComponent(urlPath.split('?')[0] ?? '/');
  const candidate = path.join(SITE_ROOT, 'dist', ...clean.split('/').filter((part) => part !== ''));
  if (clean.endsWith('/') || fs.statSync(candidate).isDirectory()) {
    return path.join(candidate, 'index.html');
  }
  return candidate;
}
