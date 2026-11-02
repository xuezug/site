import { expect, test } from '@playwright/test';
import {
  boxPoint,
  cardName,
  dragToLocator,
  dragToPoint,
  escapeRegExp,
  openTier,
  placeWithMenu,
  placedCards,
  poolCardNames,
  poolCards,
  readStoredBoard,
  resetBoardStorage,
  stubCardIcons,
  tierRow,
} from './support/harness';

/** The default board has exactly these six tiers (design §6.2). */
const DEFAULT_TIER_IDS = ['t-s', 't-a', 't-b', 't-c', 't-d', 't-f'];

test.describe('节奏榜（/tier）', () => {
  test.beforeEach(async ({ page }) => {
    await stubCardIcons(page);
    await resetBoardStorage(page);
  });

  test('加载后显示标题、六个档位与 916 张池卡片', async ({ page }) => {
    await openTier(page);

    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { level: 1 })).toHaveText('节奏榜');

    for (const tierId of DEFAULT_TIER_IDS) {
      await expect(tierRow(page, tierId)).toBeVisible();
    }
    await expect(page.locator('[data-testid^="tier-t-"]')).toHaveCount(6);
    await expect(placedCards(page, 't-s')).toHaveCount(0);

    // The pool is the whole catalogue, skin cards included (design §12.1).
    await expect(page.getByTestId('card-pool')).toBeVisible();
    await expect(poolCards(page)).toHaveCount(916);
    await expect(page.getByTestId('pool-count')).toHaveText('共 916 张 · 全站已上榜 0 张');
  });

  test('放入卡片不撑高档位，拖动锁定不改变内容宽度', async ({ page }) => {
    await openTier(page);
    const row = tierRow(page, 't-s');
    const before = await row.boundingBox();
    expect(before).not.toBeNull();

    await placeWithMenu(page, poolCards(page).first(), 'S');
    await expect(placedCards(page, 't-s')).toHaveCount(1);

    // A placed card must fit the row's existing height (regression: the old
    // 112/144px card made the row jump from 126 to ~182px).
    const after = await row.boundingBox();
    expect(after!.height).toBeCloseTo(before!.height, 1);
    expect(after!.width).toBeCloseTo(before!.width, 1);

    // `body.overflow-hidden` during a drag removes the scrollbar. On classic
    // scrollbar platforms that widens the viewport by ~15px and shifts the
    // page right until drop; the reserved gutter keeps the width stable.
    expect(
      await page.evaluate(() => getComputedStyle(document.documentElement).scrollbarGutter),
    ).toBe('stable');

    const tile = poolCards(page).nth(1);
    await tile.scrollIntoViewIfNeeded();
    const box = await tile.boundingBox();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width / 2 + 20, box!.y - 40, { steps: 5 });
    await expect(page.locator('body.overflow-hidden')).toHaveCount(1);
    const during = await row.boundingBox();
    expect(during!.width).toBeCloseTo(before!.width, 1);
    await page.mouse.up();
  });

  test('名称列可拖动/键盘调整并持久化，颜色控件在设置面板内', async ({ page }) => {
    await openTier(page);
    const row = tierRow(page, 't-s');
    const handle = row.getByRole('separator', { name: '调整 S 名称列宽度' });
    const before = await handle.boundingBox();
    expect(before).not.toBeNull();

    // The colour picker now lives in 设置 instead of the header row.
    const details = row.locator('details');
    await expect(details.getByLabel('S 档颜色')).toHaveCount(1);
    await row.locator('summary').click();
    await expect(details.getByLabel('S 档颜色')).toBeVisible();

    const y = before!.y + before!.height / 2;
    await page.mouse.move(before!.x + 4, y);
    await page.mouse.down();
    await page.mouse.move(before!.x + 4 + 64, y, { steps: 6 });

    // Live preview updates the CSS variable directly; React state (and
    // storage) is only touched on release.
    const during = await handle.boundingBox();
    expect(during!.x - before!.x).toBeGreaterThan(56);
    expect(await page.evaluate(() => localStorage.getItem('bl.tier.nameWidth.v1'))).toBeNull();

    await page.mouse.up();
    const dragged = await handle.boundingBox();
    expect(dragged!.x - before!.x).toBeGreaterThan(56);
    expect(dragged!.x - before!.x).toBeLessThan(72);
    expect(await page.evaluate(() => localStorage.getItem('bl.tier.nameWidth.v1'))).not.toBeNull();

    // Persisted across a reload.
    await page.reload();
    await page.getByTestId('pool-card').first().waitFor();
    const reloaded = await handle.boundingBox();
    expect(reloaded!.x).toBeCloseTo(dragged!.x, 0);

    // Keyboard: 8px per arrow press.
    await handle.focus();
    const beforeKey = (await handle.boundingBox())!.x;
    await page.keyboard.press('ArrowRight');
    expect((await handle.boundingBox())!.x - beforeKey).toBeCloseTo(8, 0);

    // Double-click restores the responsive default (88px on desktop).
    await handle.dblclick();
    expect((await handle.boundingBox())!.x).toBeCloseTo(before!.x, 0);
  });

  test('筛选：火 + 5★ 得 126 张，仅看未上榜排除已上榜卡片', async ({ page }) => {
    await openTier(page);

    await page.getByLabel('属性').selectOption({ label: '火' });
    await page.getByLabel('星级').selectOption({ label: '5 星' });

    await expect(page.getByTestId('pool-count')).toHaveText('筛选出 126 张 · 全站已上榜 0 张');
    await expect(poolCards(page)).toHaveCount(126);

    // Place the first filtered card, then hide it with「仅看未上榜」.
    const name = await placeWithMenu(page, poolCards(page).first(), 'S');
    await expect(page.getByTestId('pool-count')).toHaveText('筛选出 126 张 · 全站已上榜 1 张');
    await expect(placedCards(page, 't-s')).toHaveCount(1);

    await page.getByRole('button', { name: '仅看未上榜' }).click();
    await expect(page.getByTestId('pool-count')).toHaveText('筛选出 125 张 · 全站已上榜 1 张');
    expect(await poolCardNames(page)).not.toContain(name);

    // Placed cards stay in the pool (dimmed) once the switch is off again.
    await page.getByRole('button', { name: '仅看未上榜' }).click();
    await expect(page.getByTestId('pool-count')).toHaveText('筛选出 126 张 · 全站已上榜 1 张');
    expect(await poolCardNames(page)).toContain(name);
    await expect(placedCards(page, 't-s')).toContainText(name);
  });

  test('重置需要确认，重置后可从快照恢复', async ({ page }) => {
    await openTier(page);
    const name = await placeWithMenu(page, poolCards(page).first(), 'S');
    await expect(placedCards(page, 't-s')).toContainText(name);

    await page.getByRole('button', { name: '重置', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '重置榜单' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: '重置', exact: true }).click();
    await expect(dialog).toHaveCount(0);

    // Reset restores the six default tiers and empties every one of them.
    await expect(page.locator('[data-testid^="tier-t-"]')).toHaveCount(6);
    await expect(page.getByTestId('placed-card')).toHaveCount(0);
    await expect(page.getByTestId('pool-count')).toHaveText('共 916 张 · 全站已上榜 0 张');

    // Reset snapshots the board first, so the cards come back from history.
    await page.getByRole('button', { name: '快照历史' }).click();
    const panel = page.getByRole('dialog', { name: '快照历史' });
    await expect(panel.getByRole('button', { name: /恢复快照/ })).toHaveCount(1);
    await panel.getByRole('button', { name: /恢复快照/ }).first().click();
    await expect(panel).toHaveCount(0);
    await expect(placedCards(page, 't-s')).toContainText(name);
  });

  test('键盘：Enter 打开「＋」菜单放入 S，Esc 关闭并把焦点还给按钮', async ({ page }) => {
    await openTier(page);
    const first = poolCards(page).first();
    const name = await cardName(first);

    // The pool activator is not a tab stop: its「＋」button is the keyboard path.
    const activator = first.getByRole('button').first();
    await expect(activator).toHaveAttribute('aria-label', new RegExp(escapeRegExp(name)));
    await expect(activator).toHaveAttribute('aria-describedby', 'tier-dnd-instructions');
    await expect(activator).toHaveAttribute('tabindex', '-1');

    const trigger = first.getByRole('button', { name: `${name} 放入档位` });
    await trigger.focus();
    await page.keyboard.press('Enter');

    const menu = page.getByRole('menu', { name: `${name} 档位菜单` });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitem').first()).toBeFocused();

    // Esc closes without placing anything and hands focus back to the trigger.
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(placedCards(page, 't-s')).toHaveCount(0);

    // Enter re-opens; the first item is「放入 S 档」.
    await page.keyboard.press('Enter');
    await expect(menu.getByRole('menuitem').first()).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(menu).toHaveCount(0);
    await expect(placedCards(page, 't-s')).toContainText(name);
  });

  /**
   * Real pointer drags. The pool starts ~1090px down the page, so the drag
   * tests use a taller 1440×1400 viewport to keep the source card and the S row
   * on screen at the same time — at the default 900px they are ~905px apart and
   * a `mouse.move` sequence cannot scroll mid-drag without relying on dnd-kit's
   * auto-scroll animation.
   */
  test.describe('真实指针拖拽', () => {
    test.use({ viewport: { width: 1440, height: 1400 } });

    test('池中第一张卡拖入 S 档并写入 localStorage，刷新后仍在', async ({ page }) => {
      await openTier(page);
      const source = poolCards(page).first();
      const name = await cardName(source);

      await dragToLocator(page, source, tierRow(page, 't-s'), 0.7, 0.5);

      await expect(placedCards(page, 't-s')).toHaveCount(1);
      await expect(placedCards(page, 't-s')).toContainText(name);

      // The 300ms debounced write lands in localStorage.
      await expect
        .poll(async () => (await readStoredBoard(page))?.tiers[0]?.cards.length ?? 0)
        .toBe(1);

      await page.reload();
      await expect(poolCards(page).first()).toBeVisible();
      await expect(placedCards(page, 't-s')).toContainText(name);
      await expect(page.getByTestId('pool-count')).toHaveText('共 916 张 · 全站已上榜 1 张');
    });

    test('S 拖到 A，再从 A 拖回角色池', async ({ page }) => {
      await openTier(page);
      const name = await placeWithMenu(page, poolCards(page).first(), 'S');
      await expect(placedCards(page, 't-s')).toContainText(name);

      await dragToLocator(page, placedCards(page, 't-s').first(), tierRow(page, 't-a'), 0.7, 0.5);
      await expect(placedCards(page, 't-a')).toContainText(name);
      await expect(placedCards(page, 't-s')).toHaveCount(0);

      // Dropping on the `pool` droppable takes the card off the board. The pool
      // drop zone is the whole 916-card list, so aim just below its top edge.
      const poolTop = await boxPoint(page.getByTestId('pool-dropzone'), 0.5, 0);
      await dragToPoint(page, placedCards(page, 't-a').first(), {
        x: poolTop.x,
        y: poolTop.y + 40,
      });

      await expect(page.getByTestId('placed-card')).toHaveCount(0);
      await expect(page.getByTestId('pool-count')).toHaveText('共 916 张 · 全站已上榜 0 张');
      // Back in the pool it keeps dnd-kit's role/name but is no longer a tab
      // stop, and it no longer labels itself as placed.
      const activator = page.getByLabel(new RegExp(`${escapeRegExp(name)}.*未上榜`));
      await expect(activator).toHaveCount(1);
      await expect(activator).toHaveAttribute('role', 'button');
      await expect(activator).toHaveAttribute('tabindex', '-1');
      await expect(activator).not.toHaveAttribute('aria-disabled', 'true');

      // The「＋」menu is the keyboard path for pool tiles: place it again.
      const tile = page
        .getByTestId('pool-card')
        .filter({ has: page.getByLabel(new RegExp(`${escapeRegExp(name)}.*未上榜`)) })
        .first();
      await tile.getByRole('button', { name: `${name} 放入档位` }).click();
      await page.getByRole('menuitem', { name: '放入 A 档' }).click();
      await expect(placedCards(page, 't-a')).toContainText(name);
    });

    test('已上榜卡片的池中副本拖到角色池不会取消上榜', async ({ page }) => {
      await openTier(page);
      const source = poolCards(page).first();
      const name = await placeWithMenu(page, source, 'S');
      await expect(placedCards(page, 't-s')).toContainText(name);

      // The pool keeps a dimmed copy of the placed card. Dropping that copy on
      // the pool itself must be a no-op: only in-tier cards can be removed.
      const poolTop = await boxPoint(page.getByTestId('pool-dropzone'), 0.5, 0);
      await dragToPoint(page, source, { x: poolTop.x, y: poolTop.y + 40 });

      await expect(placedCards(page, 't-s')).toContainText(name);
      await expect(page.getByTestId('pool-count')).toHaveText('共 916 张 · 全站已上榜 1 张');
      // The pool copy still labels itself as placed in S.
      await expect(
        page.getByLabel(new RegExp(`${escapeRegExp(name)}.*已在 S 档`)),
      ).toHaveCount(1);
    });
  });
});
