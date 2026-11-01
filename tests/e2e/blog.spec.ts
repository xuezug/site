import { expect, test } from '@playwright/test';

/**
 * Blog (design §7/§12.8): list → detail → tag, plus the two no-JS promises —
 * article text is in the prerendered HTML, and every post links to a raw
 * Markdown file that needs no client runtime.
 */
test.describe('博客', () => {
  test('列表 → 第一篇详情：标题、日期与正文', async ({ page }) => {
    await page.goto('/blog');
    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { level: 1 })).toHaveText('博客');

    const articles = main.getByRole('article');
    expect(await articles.count()).toBeGreaterThanOrEqual(2);

    const first = articles.first();
    const title = (await first.getByRole('heading', { level: 2 }).textContent())?.trim() ?? '';
    expect(title.length).toBeGreaterThan(0);

    await first.getByRole('link').first().click();
    await expect(page).toHaveURL(/\/blog\/[^/]+$/);

    await expect(main.getByRole('heading', { level: 1 })).toHaveText(title);
    const time = main.locator('time').first();
    await expect(time).toHaveAttribute('datetime', /^\d{4}-\d{2}-\d{2}$/);
    await expect(time).not.toBeEmpty();

    const slug = new URL(page.url()).pathname.replace('/blog/', '');
    const keyword = slug === 'card-data' ? 'taxonomy.json' : '节奏榜';
    const body = main.locator('.bl-prose');
    await expect(body).toBeVisible();
    await expect(body).toContainText(keyword);
    expect((await body.innerText()).length).toBeGreaterThan(300);
  });

  test('详情页标签 → 标签页列出文章', async ({ page }) => {
    await page.goto('/blog/tier-guide');
    const main = page.getByRole('main');

    await main
      .getByRole('list', { name: '标签' })
      .getByRole('link', { name: '节奏榜', exact: true })
      .click();

    await expect(page).toHaveURL(/\/blog\/tag\//);
    await expect(main.getByRole('heading', { level: 1 })).toHaveText('标签：节奏榜');
    await expect(main).toContainText('共 1 篇文章');

    const links = main.getByRole('article').getByRole('link');
    expect(await links.count()).toBeGreaterThanOrEqual(1);
    await expect(links.first()).toBeVisible();
    await links.first().click();
    await expect(page).toHaveURL(/\/blog\/tier-guide$/);
    await expect(main.getByRole('heading', { level: 1 })).toHaveText('节奏榜使用说明');
  });

  test('禁用 JavaScript 时正文仍可读（预渲染 HTML）', async ({ browser, baseURL }) => {
    const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
    try {
      // No JS means no R2 icon fetch loop; abort them so the run stays offline.
      await context.route('**/card_icons/*.png', (route) => route.abort());
      const page = await context.newPage();

      await page.goto('/blog/tier-guide');

      const main = page.getByRole('main');
      await expect(main.getByRole('heading', { level: 1 })).toHaveText('节奏榜使用说明');
      await expect(page.getByText('节奏榜').first()).toBeVisible();
      const body = main.locator('.bl-prose');
      await expect(body).toContainText('拖拽');
      expect((await body.innerText()).length).toBeGreaterThan(300);

      // The layout is prerendered too, so navigation is usable without JS.
      await expect(main.getByRole('link', { name: '← 返回博客列表' })).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test('alternate Markdown 链接指向可访问的 /blog/<slug>.md', async ({ page, request }) => {
    await page.goto('/blog/tier-guide');

    const alternate = page.locator('link[rel="alternate"][type="text/markdown"]');
    await expect(alternate).toHaveCount(1);
    await expect(alternate).toHaveAttribute('href', '/blog/tier-guide.md');

    // A plain GET: the raw file is static, no client runtime involved.
    const response = await request.get('/blog/tier-guide.md');
    expect(response.status()).toBe(200);
    const markdown = await response.text();
    expect(markdown).toContain('title: 节奏榜使用说明');
    expect(markdown).toContain('## 把卡片放进档位');
  });
});
