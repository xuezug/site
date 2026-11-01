import { expect, test, type APIResponse } from '@playwright/test';

/**
 * Agent-facing surface (design §8/§12.9): machine-readable data endpoints,
 * llms.txt / llms-full.txt, the sitemap, JSON-LD, and a real 404 — never a
 * 200 SPA shell.
 */

type CardRecord = {
  serial: number;
  looks: number;
  name: string;
  star: number;
  maxStar: number;
  attribute: string;
  attributes: string[];
  faction: string;
  career: string;
  careerOptions: string[];
  gender: string;
  iconPath: string;
  uniqueId: number;
  skinOf: number | null;
};

async function textOf(response: APIResponse): Promise<string> {
  expect(response.status()).toBe(200);
  return response.text();
}

test.describe('Agent 站点', () => {
  test('/data/* 数据端点结构正确', async ({ request }) => {
    const cardsResponse = await request.get('/data/cards.json');
    expect(cardsResponse.status()).toBe(200);
    expect(cardsResponse.headers()['content-type']).toContain('application/json');

    const cards = (await cardsResponse.json()) as CardRecord[];
    expect(cards).toHaveLength(916);

    const first = cards[0];
    if (first === undefined) {
      throw new Error('/data/cards.json 为空');
    }
    // Every field of a card record, with the type agents rely on.
    expect(typeof first.serial).toBe('number');
    expect(Number.isSafeInteger(first.serial)).toBe(true);
    expect(typeof first.looks).toBe('number');
    expect(typeof first.name).toBe('string');
    expect(first.name.length).toBeGreaterThan(0);
    expect(typeof first.star).toBe('number');
    expect(typeof first.maxStar).toBe('number');
    expect(first.star).toBeLessThanOrEqual(first.maxStar);
    expect(typeof first.attribute).toBe('string');
    expect(Array.isArray(first.attributes)).toBe(true);
    expect(first.attributes.length).toBeGreaterThan(0);
    expect(first.attributes).toContain(first.attribute);
    expect(typeof first.faction).toBe('string');
    expect(typeof first.career).toBe('string');
    expect(Array.isArray(first.careerOptions)).toBe(true);
    expect(typeof first.gender).toBe('string');
    expect(first.iconPath).toMatch(/^card_icons\/\d+_\d+\.png$/);
    expect(typeof first.uniqueId).toBe('number');
    // `skin_of` is empty for an original card and a serial for a skin.
    expect(first.skinOf === null || typeof first.skinOf === 'number').toBe(true);

    // CSV is the same catalogue: header + one row per card.
    const csv = await textOf(await request.get('/data/cards.csv'));
    const rows = csv
      .replace(/^\uFEFF/, '')
      .split(/\r?\n/)
      .filter((line) => line.trim() !== '');
    expect(rows[0]?.split(',')[0]).toBe('serial');
    expect(rows).toHaveLength(916 + 1);

    const taxonomy = (await (await request.get('/data/taxonomy.json')).json()) as {
      attributes: { id: string; label: string }[];
      factions: { id: string }[];
      careers: { id: string }[];
      stars: number[];
    };
    expect(taxonomy.attributes).toHaveLength(6);
    expect(taxonomy.attributes.map((item) => item.id).sort()).toEqual([
      'dark',
      'fire',
      'light',
      'thunder',
      'water',
      'wood',
    ]);
    expect(taxonomy.factions).toHaveLength(5);
    expect(taxonomy.careers).toHaveLength(5);
    expect(taxonomy.stars).toEqual([1, 2, 3, 4, 5]);

    const schema = (await (await request.get('/data/tier.schema.json')).json()) as {
      $schema: string;
      type: string;
      required: string[];
    };
    expect(schema.$schema).toContain('json-schema.org/draft-07/schema');
    expect(schema.type).toBe('object');
    expect(schema.required).toEqual(
      expect.arrayContaining(['format', 'version', 'title', 'updatedAt', 'tiers']),
    );
  });

  test('llms.txt 与 llms-full.txt 列出全部端点', async ({ request }) => {
    const llms = await textOf(await request.get('/llms.txt'));
    for (const endpoint of [
      '/data/cards.json',
      '/data/cards.csv',
      '/data/taxonomy.json',
      '/data/tier.schema.json',
      '/blog/tier-guide',
      '/llms-full.txt',
    ]) {
      expect(llms).toContain(endpoint);
    }

    const full = await textOf(await request.get('/llms-full.txt'));
    expect(full).toContain('## 卡片全表');
    // 916 rows of the catalogue inside the plain-text bundle.
    expect(full).toContain('阿尔杰塔');
  });

  test('sitemap.xml 覆盖全部路由且标签经过编码', async ({ request }) => {
    const xml = await textOf(await request.get('/sitemap.xml'));

    for (const path of ['/tier', '/blog/card-data', '/blog/tier-guide', '/blog/tag/']) {
      expect(xml).toContain(`https://bl.cracklewis.site${path}`);
    }
    expect(xml).toMatch(/%E[0-9A-F]/);

    const locs = xml.match(/<loc>[^<]+<\/loc>/g) ?? [];
    expect(locs.length).toBeGreaterThanOrEqual(8);
    // Every <loc> is an absolute https URL on the canonical host.
    for (const loc of locs) {
      expect(loc).toMatch(/^<loc>https:\/\/bl\.cracklewis\.site(\/[^<\s]*)?<\/loc>$/);
    }
  });

  test('JSON-LD：首页可解析，文章页含 BlogPosting', async ({ page }) => {
    const parseScripts = async (): Promise<Record<string, unknown>[]> => {
      const texts = await page.locator('script[type="application/ld+json"]').allTextContents();
      expect(texts.length).toBeGreaterThan(0);
      return texts.map((text) => JSON.parse(text) as Record<string, unknown>);
    };

    await page.goto('/');
    const home = await parseScripts();
    expect(home.some((entry) => entry['@context'] === 'https://schema.org')).toBe(true);
    const serializedHome = JSON.stringify(home);
    expect(serializedHome).toContain('Dataset');

    await page.goto('/blog/tier-guide');
    const post = await parseScripts();
    expect(JSON.stringify(post)).toContain('BlogPosting');
    const blogPosting = post.find((entry) => JSON.stringify(entry).includes('BlogPosting'));
    expect(blogPosting?.['@context']).toBe('https://schema.org');
  });

  test('未知路径返回 404 状态与「页面不存在」，且 hydration 后仍是 noindex', async ({ page }) => {
    const response = await page.goto('/nope');
    expect(response?.status()).toBe(404);
    await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toHaveText(
      '页面不存在',
    );

    // After hydration the client router matches the catch-all route, which must
    // keep the 404 document's head: no canonical / og:url for an unknown URL
    // and exactly one `noindex`. (Before the fix the client emitted
    // `canonical=https://…/nope` and dropped the prerendered noindex.)
    await expect(page.locator('meta[name="robots"][content="noindex"]')).toHaveCount(1);
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
    await expect(page.locator('meta[property="og:url"]')).toHaveCount(0);

    // A real page keeps its canonical URL, so the rule is 404-specific.
    await page.goto('/');
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(1);
    await expect(page.locator('meta[name="robots"]')).toHaveCount(0);

    // The preview server (and Cloudflare Pages) must not answer 200 for a
    // missing path, so agents never index an empty shell.
    const plain = await page.request.get('/nope');
    expect(plain.status()).toBe(404);
  });
});
