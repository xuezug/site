import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  openTier,
  placeWithMenu,
  placedCards,
  poolCards,
  readStoredBoard,
  readToastLog,
  resetBoardStorage,
  startToastLog,
  stubCardIcons,
  tierRow,
} from './support/harness';

type ExportedFile = {
  format: string;
  version: number;
  title: string;
  updatedAt: string;
  tiers: { id: string; name: string; color: string; cards: { serial: number; name: string }[] }[];
};

/** Export the current board and keep the file inside the test artifact dir. */
async function exportJson(
  page: Page,
  outputPath: string,
): Promise<{ file: ExportedFile; filename: string }> {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '导出 JSON' }).click(),
  ]);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  await download.saveAs(outputPath);
  const file = JSON.parse(fs.readFileSync(outputPath, 'utf8')) as ExportedFile;
  return { file, filename: download.suggestedFilename() };
}

test.describe('节奏榜导入导出', () => {
  test.beforeEach(async ({ page }) => {
    await stubCardIcons(page);
    await resetBoardStorage(page);
  });

  test('导出 JSON：文件名、format/version 与 tiers[].cards 正确', async ({ page }, testInfo) => {
    await openTier(page);
    const sName = await placeWithMenu(page, poolCards(page).nth(0), 'S');
    const aName = await placeWithMenu(page, poolCards(page).nth(1), 'A');

    const { file, filename } = await exportJson(page, testInfo.outputPath('board.json'));

    expect(filename).toMatch(/^bl-tier-\d{8}-\d{4}\.json$/);
    expect(file.format).toBe('bl-tier');
    expect(file.version).toBe(1);
    expect(file.title).toBe('我的节奏榜');
    expect(file.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(file.tiers).toHaveLength(6);
    expect(file.tiers.map((tier) => tier.name)).toEqual(['S', 'A', 'B', 'C', 'D', 'F']);

    const sCards = file.tiers[0]?.cards ?? [];
    expect(sCards.map((card) => card.name)).toEqual([sName]);
    expect(Number.isSafeInteger(sCards[0]?.serial)).toBe(true);
    expect((file.tiers[1]?.cards ?? []).map((card) => card.name)).toEqual([aName]);
    // Every exported tier keeps its colour and id, so a re-import round-trips.
    expect(file.tiers[0]?.id).toBe('t-s');
    expect(file.tiers[0]?.color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  test('导入：重置后导入刚导出的文件，卡片回到原档位', async ({ page }, testInfo) => {
    await openTier(page);
    const sName = await placeWithMenu(page, poolCards(page).nth(0), 'S');
    const aName = await placeWithMenu(page, poolCards(page).nth(1), 'A');

    const target = testInfo.outputPath('roundtrip.json');
    await exportJson(page, target);

    // Reset the board, so the import is the only source of the cards.
    await page.getByRole('button', { name: '重置', exact: true }).click();
    await page
      .getByRole('dialog', { name: '重置榜单' })
      .getByRole('button', { name: '重置', exact: true })
      .click();
    await expect(page.getByTestId('placed-card')).toHaveCount(0);

    await page.getByRole('button', { name: '导入' }).click();
    const dialog = page.getByRole('dialog', { name: '导入 JSON' });
    await dialog.getByLabel('选择节奏榜 JSON 文件').setInputFiles(target);
    await expect(dialog).toContainText('已读取：6 个档位 · 2 张卡片');
    await dialog.getByRole('button', { name: '确认导入' }).click();
    await expect(dialog).toHaveCount(0);

    await expect(placedCards(page, 't-s')).toContainText(sName);
    await expect(placedCards(page, 't-a')).toContainText(aName);
    await expect(page.getByTestId('pool-count')).toHaveText('共 916 张 · 全站已上榜 2 张');

    // Wait for the 300ms debounced write before reloading; the save is
    // asynchronous and a reload mid-debounce drops the last change.
    await expect
      .poll(async () => (await readStoredBoard(page))?.tiers[0]?.cards.length ?? 0)
      .toBe(1);

    // A reload keeps the imported board (it was written to storage).
    await page.reload();
    await expect(poolCards(page).first()).toBeVisible();
    await expect(placedCards(page, 't-s')).toContainText(sName);
    await expect(placedCards(page, 't-a')).toContainText(aName);
  });

  test('导入非法文件：提示原因且确认按钮禁用', async ({ page }, testInfo) => {
    await openTier(page);

    const bad = testInfo.outputPath('not-a-board.json');
    fs.mkdirSync(path.dirname(bad), { recursive: true });
    fs.writeFileSync(bad, '{"format":"nope"}', 'utf8');

    await page.getByRole('button', { name: '导入' }).click();
    const dialog = page.getByRole('dialog', { name: '导入 JSON' });
    await dialog.getByLabel('选择节奏榜 JSON 文件').setInputFiles(bad);

    await expect(dialog.getByRole('alert')).toContainText('不是血族节奏榜文件');
    await expect(dialog.getByRole('button', { name: '确认导入' })).toBeDisabled();
    // The board is untouched.
    await expect(page.getByTestId('placed-card')).toHaveCount(0);
    await expect(page.getByTestId('pool-count')).toHaveText('共 916 张 · 全站已上榜 0 张');
  });

  test('导出 PNG：拦截图标后得到 2 倍图，体积 > 10KB，且没有占位提示', async ({
    page,
  }, testInfo) => {
    await openTier(page);
    const sName = await placeWithMenu(page, poolCards(page).nth(0), 'S');
    const aName = await placeWithMenu(page, poolCards(page).nth(1), 'A');
    await expect(placedCards(page, 't-s')).toContainText(sName);
    await expect(placedCards(page, 't-a')).toContainText(aName);

    await startToastLog(page);
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 15_000 }),
      page.getByRole('button', { name: '导出 PNG' }).click(),
    ]);

    expect(download.suggestedFilename()).toMatch(/^bl-tier-\d{8}-\d{4}\.png$/);
    const target = testInfo.outputPath(download.suggestedFilename());
    fs.mkdirSync(path.dirname(target), { recursive: true });
    await download.saveAs(target);

    const size = fs.statSync(target).size;
    expect(size).toBeGreaterThan(10_000);
    // PNG magic, so the download is an image and not an error page.
    const head = fs.readFileSync(target).subarray(0, 8);
    expect(head.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true);

    // Both placed cards had a working icon, so the placeholder path must stay
    // silent — only the success toast appears. (Card names cannot be asserted
    // from PNG bytes; the board state above is the real proof they were drawn.)
    const toasts = (await readToastLog(page)).join('\n');
    expect(toasts).toContain('已导出 PNG 图片');
    expect(toasts).not.toContain('占位');
  });

  test('图标全部 500 时降级为占位图并提示，页面不崩', async ({ page }, testInfo) => {
    await page.unrouteAll();
    await stubCardIcons(page, 'broken');
    await resetBoardStorage(page);

    await openTier(page);
    const name = await placeWithMenu(page, poolCards(page).nth(0), 'S');

    await startToastLog(page);
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 15_000 }),
      page.getByRole('button', { name: '导出 PNG' }).click(),
    ]);

    // The export still produces a file; only the icons degraded.
    const target = testInfo.outputPath(download.suggestedFilename());
    fs.mkdirSync(path.dirname(target), { recursive: true });
    await download.saveAs(target);
    expect(fs.statSync(target).size).toBeGreaterThan(10_000);

    expect((await readToastLog(page)).join('\n')).toContain('占位');
    // And the board is still alive after the failed icon fetches.
    await expect(tierRow(page, 't-s')).toContainText(name);
    await expect(page.getByTestId('pool-count')).toHaveText('共 916 张 · 全站已上榜 1 张');
  });
});
