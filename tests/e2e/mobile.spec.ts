import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  openTier,
  placeWithMenu,
  poolCards,
  readStoredBoard,
  resetBoardStorage,
  stubCardIcons,
  tierRow,
} from './support/harness';

const MOBILE_WIDTH = 375;
const MOBILE = { width: MOBILE_WIDTH, height: 667 };

/** A point inside a card tile, away from the「＋」button in the corner. */
async function cardTouchPoint(card: Locator): Promise<{ x: number; y: number }> {
  const box = await card.boundingBox();
  if (box === null) {
    throw new Error('card tile is not visible');
  }
  return { x: box.x + Math.min(box.width / 2, 24), y: box.y + Math.min(box.height / 2, 24) };
}

/**
 * Real touch gesture through CDP.
 *
 * Playwright's `touchscreen` only exposes `tap`, and dnd-kit's `TouchSensor`
 * needs a *stream* (`touchstart` → hold → `touchmove`), so the raw input events
 * are dispatched on the browser's input pipeline. `holdMs` sits between the two
 * extremes the specs care about: 0 (a scroll starts immediately) and >200
 * (long-press activates the drag, per `TierBoard`'s `delay: 200`).
 */
async function touchGesture(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  options: { holdMs: number; steps?: number },
): Promise<void> {
  const client = await page.context().newCDPSession(page);
  const steps = options.steps ?? 5;

  try {
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: from.x, y: from.y }],
    });

    if (options.holdMs > 0) {
      await page.waitForTimeout(options.holdMs);
    }

    for (let step = 1; step <= steps; step += 1) {
      const ratio = step / steps;
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [
          {
            x: from.x + (to.x - from.x) * ratio,
            y: from.y + (to.y - from.y) * ratio,
          },
        ],
      });
      await page.waitForTimeout(16);
    }

    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally {
    await client.detach();
  }
}

declare global {
  interface Window {
    /** Set as soon as `TierBoard` mounted its drag state during a gesture. */
    __dragSeen?: boolean;
  }
}

/**
 * Watch for the board's drag state. `TierBoard` adds `overflow-hidden` to
 * `<body>` only while a *pointer/touch* drag is active (keyboard drags skip it),
 * so this is the honest "a drag started" signal — the drag overlay itself is
 * transient and the board can end up unchanged even when a drag ran.
 */
async function startDragWatch(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.__dragSeen = false;
    const check = (): void => {
      if (document.body.classList.contains('overflow-hidden')) {
        window.__dragSeen = true;
      }
    };
    check();
    new MutationObserver(check).observe(document.body, {
      attributes: true,
      attributeFilter: ['class'],
    });
  });
}

async function dragSeen(page: Page): Promise<boolean> {
  return page.evaluate(() => window.__dragSeen === true);
}

/**
 * Mobile (design §11/§12.10). `hasTouch` makes the browser advertise touch, so
 * the specs exercise the touch-sized layout and the real touch sensors.
 */
test.use({ viewport: MOBILE, hasTouch: true });

test.describe('移动端 375×667', () => {
  test.beforeEach(async ({ page }) => {
    await stubCardIcons(page);
    await resetBoardStorage(page);
  });

  test('三个页面都没有横向滚动', async ({ page }) => {
    const overflow = async (): Promise<{ doc: number; body: number; inner: number }> =>
      page.evaluate(() => ({
        doc: document.documentElement.scrollWidth,
        body: document.body.scrollWidth,
        inner: window.innerWidth,
      }));

    await page.goto('/tier');
    await page.getByTestId('pool-card').first().waitFor();
    const tier = await overflow();
    expect(tier.inner).toBe(375);
    expect(tier.doc).toBeLessThanOrEqual(375);
    expect(tier.body).toBeLessThanOrEqual(375);

    await page.goto('/blog');
    await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toHaveText('博客');
    const list = await overflow();
    expect(list.inner).toBe(375);
    expect(list.doc).toBeLessThanOrEqual(375);
    expect(list.body).toBeLessThanOrEqual(375);

    await page.goto('/blog/tier-guide');
    await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toBeVisible();
    const post = await overflow();
    expect(post.inner).toBe(375);
    expect(post.doc).toBeLessThanOrEqual(375);
    expect(post.body).toBeLessThanOrEqual(375);
  });

  test('「＋」菜单在左右边缘都不会超出视口', async ({ page }) => {
    await openTier(page);
    const viewport = page.viewportSize();
    if (viewport === null) {
      throw new Error('mobile viewport missing');
    }

    const assertInsideViewport = async (): Promise<void> => {
      const menu = page.getByRole('menu');
      await expect(menu).toBeVisible();
      const box = await menu.boundingBox();
      if (box === null) {
        throw new Error('menu has no box');
      }
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
    };

    const cards = poolCards(page);

    // Leftmost card of the first row: the old `right-0` menu ran off-screen.
    const leftCard = cards.first();
    await leftCard.scrollIntoViewIfNeeded();
    await leftCard.hover();
    await leftCard.getByRole('button', { name: /放入档位/ }).click();
    await assertInsideViewport();
    const leftBox = await page.getByRole('menu').boundingBox();
    const leftCardBox = await leftCard.boundingBox();
    expect(leftBox!.x).toBeCloseTo(leftCardBox!.x, 0);
    await page.keyboard.press('Escape');

    // Rightmost card of the same row (4 columns at 375px).
    const rightCard = cards.nth(3);
    await rightCard.scrollIntoViewIfNeeded();
    await rightCard.hover();
    await rightCard.getByRole('button', { name: /放入档位/ }).click();
    await assertInsideViewport();
    await page.keyboard.press('Escape');
  });

  test('行高面板在 375px 内不溢出', async ({ page }) => {
    await openTier(page);
    await page.locator('summary[aria-label="调节行高"]').click();
    const panel = page.getByTestId('row-height-panel');
    await expect(panel).toBeVisible();
    const box = await panel.boundingBox();
    if (box === null) {
      throw new Error('row-height panel has no box');
    }
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(375);
    expect(box.y + box.height).toBeLessThanOrEqual(667 + 1);
  });

  test('抽屉菜单：Esc 关闭并归还焦点，点击条目完成导航', async ({ page }) => {
    await openTier(page);

    const menuButton = page.getByRole('button', { name: '打开导航菜单' });
    await expect(menuButton).toBeVisible();
    await expect(menuButton).toHaveAttribute('aria-expanded', 'false');

    await menuButton.click();
    const drawer = page.getByRole('dialog', { name: '导航菜单' });
    await expect(drawer).toBeVisible();
    await expect(menuButton).toHaveAttribute('aria-expanded', 'true');
    await expect(drawer.getByRole('link')).toHaveCount(3);

    await page.keyboard.press('Escape');
    await expect(drawer).toHaveCount(0);
    await expect(menuButton).toBeFocused();

    // Navigate from inside the drawer; the drawer closes on click.
    await menuButton.click();
    await drawer.getByRole('link', { name: '节奏榜' }).click();
    await expect(page).toHaveURL(/\/tier$/);
    await expect(drawer).toHaveCount(0);
    await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toHaveText('节奏榜');
  });

  test('池卡片的「＋」菜单在 375px 可用（触屏的拖拽替代路径）', async ({ page }) => {
    await openTier(page);

    const card = poolCards(page).first();
    const name = await placeWithMenu(page, card, 'S');

    await expect(tierRow(page, 't-s')).toContainText(name);
    await expect(page.getByTestId('pool-count')).toHaveText('共 916 张 · 全站已上榜 1 张');

    // The 300ms debounced write is the durable proof the card was placed.
    await expect
      .poll(async () => (await readStoredBoard(page))?.tiers[0]?.cards.length ?? 0)
      .toBe(1);
  });

  test('触摸滑动立即上移：页面滚动且不触发拖拽', async ({ page }) => {
    await openTier(page);

    // The pool starts far below the fold (≈1415px), so bring one tile into view
    // and remember where the page is; the gesture must move it further.
    const card = poolCards(page).first();
    await card.scrollIntoViewIfNeeded();
    const before = await page.evaluate(() => window.scrollY);

    const from = await cardTouchPoint(card);
    await startDragWatch(page);
    await touchGesture(page, from, { x: from.x, y: from.y - 240 }, { holdMs: 0 });

    // The touch became a scroll (finger up ⇒ content up ⇒ scrollY grows) …
    await expect
      .poll(() => page.evaluate(() => window.scrollY))
      .toBeGreaterThan(before + 120);

    // … and no drag ever started: dnd-kit cancels on movement inside the 200ms
    // delay window. If drag-vs-scroll regressed, `__dragSeen` turns true here
    // even when the drop target would have been a no-op.
    expect(await dragSeen(page)).toBe(false);
    await expect(page.getByTestId('placed-card')).toHaveCount(0);
    const board = await readStoredBoard(page);
    expect(board?.tiers.flatMap((tier) => tier.cards) ?? []).toEqual([]);
    await expect(page.getByTestId('pool-count')).toHaveText('共 916 张 · 全站已上榜 0 张');
  });

  test('触摸长按 200ms 后拖动：卡片真的换了档位', async ({ page }) => {
    await openTier(page);
    const name = await placeWithMenu(page, poolCards(page).first(), 'S');
    await expect(tierRow(page, 't-s')).toContainText(name);

    // Both rows fit in the 667px viewport once the S row is in view.
    await page.evaluate(() => window.scrollTo(0, 0));
    const placed = page.getByTestId('placed-card').first();
    const from = await cardTouchPoint(placed);
    const target = await page.getByTestId('tier-t-a').boundingBox();
    if (target === null) {
      throw new Error('A 档不在可视区域');
    }

    // Hold past `delay: 200` so the sensor activates instead of scrolling.
    await startDragWatch(page);
    await touchGesture(
      page,
      from,
      { x: target.x + target.width * 0.6, y: target.y + target.height * 0.5 },
      { holdMs: 260, steps: 6 },
    );

    // A drag really ran (not a scroll that happened to end over nothing) …
    expect(await dragSeen(page)).toBe(true);
    await expect(tierRow(page, 't-a')).toContainText(name);
    await expect(page.getByTestId('tier-t-s').getByTestId('placed-card')).toHaveCount(0);

    // And it is persisted, so the drop really went through the reducer.
    await expect
      .poll(async () => (await readStoredBoard(page))?.tiers[1]?.cards.length ?? 0)
      .toBe(1);
  });
});
