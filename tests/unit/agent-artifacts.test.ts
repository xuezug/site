import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import posts from 'virtual:blog-posts';
import type { Post } from '../../app/lib/blog/content';
import type { Card } from '../../app/lib/cards/types';
import { parseFile, tierFileSchema } from '../../app/lib/tier/importExport';
import {
  buildBlogIndex,
  buildLlmsFull,
  buildLlmsTxt,
  buildRobotsTxt,
  buildSitemap,
  DEFAULT_ASSET_BASE,
  defaultTierFile,
  TIER_SCHEMA,
  type Taxonomy,
} from '../../app/lib/seo/artifacts';
import {
  blogPostingJsonLd,
  datasetJsonLd,
  graphJsonLd,
  serializeJsonLd,
  webPageJsonLd,
  websiteJsonLd,
} from '../../app/lib/seo/jsonld';
import {
  BLOG_DESCRIPTION,
  clampDescription,
  DESCRIPTION_MAX,
  DESCRIPTION_MIN,
  homeDescription,
  postDescription,
  SITE_DESCRIPTION,
  SITE_NAME,
  tagDescription,
  TIER_DESCRIPTION,
} from '../../app/lib/seo/meta';
import { ARTIFACT_PATHS, buildArtifacts, dataEndpoints, resolveBuildDate } from '../../plugins/agent-artifacts';
import cardsJson from '../../src/data/cards.json';
import taxonomyJson from '../../src/data/taxonomy.json';

const SITE_URL = 'https://example.com';
const PUBLIC_DIR = path.resolve(process.cwd(), 'public');

// The export artifacts are widened by `resolveJsonModule`; the shapes are
// guaranteed by the data tests (see `cards.test.ts`).
const CARDS = cardsJson as Card[];
const TAXONOMY = taxonomyJson as Taxonomy;

function makePost(overrides: Partial<Post> = {}): Post {
  return {
    slug: 'tier-guide',
    title: '节奏榜使用说明',
    date: '2026-11-01',
    tags: ['节奏榜'],
    summary: '从拖拽排位到快照、导入导出与 PNG，一篇说明节奏榜的全部操作。',
    draft: false,
    html: '<p>正文</p>',
    headings: [],
    readingMinutes: 4,
    source:
      '---\ntitle: 节奏榜使用说明\ndate: 2026-11-01\nsummary: 摘要\n---\n\n## 打开节奏榜\n\n正文段落。\n',
    ...overrides,
  };
}

/** Everything between a `## heading` and the next `## heading`. */
function section(markdown: string, heading: string): string {
  const start = markdown.indexOf(`\n${heading}\n`);
  expect(start, `missing section ${heading}`).toBeGreaterThanOrEqual(0);
  const rest = markdown.slice(start + heading.length + 2);
  const next = rest.indexOf('\n## ');
  return next === -1 ? rest : rest.slice(0, next);
}

/**
 * Everything from `heading` to the end of the document. Article bodies contain
 * their own `##` headings, so the article section cannot be sliced at the next
 * one.
 */
function tail(markdown: string, heading: string): string {
  const start = markdown.indexOf(`\n${heading}\n`);
  expect(start, `missing section ${heading}`).toBeGreaterThanOrEqual(0);
  return markdown.slice(start);
}

describe('buildSitemap', () => {
  it('lists static pages, tag pages and articles with lastmod', () => {
    const sitemap = buildSitemap({
      siteUrl: SITE_URL,
      staticPaths: [
        { path: '/', lastmod: '2026-11-02' },
        { path: '/tier', lastmod: '2026-11-02' },
        { path: '/blog', lastmod: '2026-11-02' },
      ],
      posts: [
        makePost({ slug: 'tier-guide', date: '2026-11-01', updated: '2026-11-03' }),
        makePost({ slug: 'card-data', date: '2026-10-01', tags: ['数据'] }),
      ],
      tags: ['节奏榜', '数据'],
    });

    expect(sitemap).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(sitemap).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');

    for (const required of ['', '/tier', '/blog']) {
      expect(sitemap).toContain(`<loc>${SITE_URL}${required}</loc>`);
    }

    // Updated posts use `updated`, the rest fall back to `date`.
    expect(sitemap).toContain(
      `<loc>${SITE_URL}/blog/tier-guide</loc><lastmod>2026-11-03</lastmod>`,
    );
    expect(sitemap).toContain(`<loc>${SITE_URL}/blog/card-data</loc><lastmod>2026-10-01</lastmod>`);

    // Tag URLs match the page links: percent-encoded, never raw Chinese.
    expect(sitemap).toContain(
      `<loc>${SITE_URL}/blog/tag/${encodeURIComponent('节奏榜')}</loc><lastmod>2026-11-03</lastmod>`,
    );
    expect(sitemap).toContain(`<loc>${SITE_URL}/blog/tag/${encodeURIComponent('数据')}</loc>`);
  });

  it('never lists /404 or the SPA fallback and escapes XML metacharacters', () => {
    const sitemap = buildSitemap({
      siteUrl: `${SITE_URL}/`,
      staticPaths: [
        { path: '/404' },
        { path: '/__spa-fallback' },
        { path: '/search?q=a&b=<c>"d"', lastmod: '2026-11-02' },
      ],
      posts: [],
      tags: [],
    });

    expect(sitemap).not.toContain('/404');
    expect(sitemap).not.toContain('__spa-fallback');
    expect(sitemap).toContain(
      '<loc>https://example.com/search?q=a&amp;b=&lt;c&gt;&quot;d&quot;</loc>',
    );
  });

  it('ends the document with the closing element and a newline', () => {
    const sitemap = buildSitemap({ siteUrl: SITE_URL, staticPaths: [], posts: [], tags: [] });
    expect(sitemap.endsWith('</urlset>\n')).toBe(true);
  });
});

describe('buildRobotsTxt', () => {
  it('allows every crawler and points at the sitemap', () => {
    const robots = buildRobotsTxt({ siteUrl: SITE_URL });

    expect(robots).toContain('User-agent: *');
    expect(robots).toContain('Allow: /');
    // Neither the 404 page nor a SPA catch-all should be crawled.
    expect(robots).toContain('Disallow: /404');
    expect(robots).toContain('Disallow: /__spa-fallback');
    expect(robots).toContain(`Sitemap: ${SITE_URL}/sitemap.xml`);
  });
});

describe('buildLlmsTxt', () => {
  const endpoints = dataEndpoints({ siteUrl: SITE_URL, cardCount: 916, characterCount: 406 });

  it('lists every endpoint as an absolute URL', () => {
    const llms = buildLlmsTxt({ siteUrl: SITE_URL, posts: [makePost()], endpoints });

    expect(llms.startsWith(`# ${SITE_NAME}`)).toBe(true);
    expect(llms).toContain('916');
    expect(llms).toContain('406');
    for (const endpoint of endpoints) {
      expect(llms).toContain(`](${SITE_URL}${endpoint.path})`);
      expect(llms).toContain(endpoint.description);
    }
    // The field guide link inside a description must be absolute too.
    expect(llms).toContain(`${SITE_URL}/blog/card-data`);
    expect(endpoints.map((endpoint) => endpoint.path)).toContain('/sitemap.xml');
    expect(llms).toContain('UTF-8 编码（带 BOM）');
  });

  it('links each article and its raw Markdown', () => {
    const llms = buildLlmsTxt({ siteUrl: SITE_URL, posts: [makePost()], endpoints });

    expect(llms).toContain(`[节奏榜使用说明](${SITE_URL}/blog/tier-guide)`);
    expect(llms).toContain(`原文：${SITE_URL}/blog/tier-guide.md`);
    // Every page link is absolute, so an agent can fetch it directly.
    expect(llms).toContain(`- [首页](${SITE_URL})`);
    expect(llms).toContain(`- [节奏榜](${SITE_URL}/tier)`);
    expect(llms).toContain(`- [博客](${SITE_URL}/blog)`);
  });

  it('contains no placeholder text', () => {
    const llms = buildLlmsTxt({ siteUrl: SITE_URL, posts: [makePost()], endpoints });

    for (const placeholder of ['TODO', '建设中', '待补充']) {
      expect(llms).not.toContain(placeholder);
    }
  });
});

describe('buildLlmsFull', () => {
  const llmsFull = () =>
    buildLlmsFull({
      siteUrl: SITE_URL,
      posts: [makePost()],
      cards: CARDS,
      taxonomy: TAXONOMY,
      assetBase: DEFAULT_ASSET_BASE,
    });

  it('renders one table row per card', () => {
    const markdown = llmsFull();
    const table = section(markdown, '## 卡片全表');
    const rows = table.split('\n').filter((line) => /^\| \d+ \|/.test(line));

    expect(rows).toHaveLength(916);
    expect(CARDS).toHaveLength(916);
    expect(table).toContain('| serial | 名称 | 星级 | 主属性 | 阵营 | 职业 | 图标 |');
    expect(table).toContain('| --- | --- | --- | --- | --- | --- | --- |');
  });

  it('resolves labels and absolute icon URLs', () => {
    const markdown = llmsFull();
    const first = CARDS[0];

    expect(
      markdown,
    ).toContain(
      `| ${String(first?.serial)} | ${first?.name} | ${String(first?.star)} | 暗 | 异族 | 法师 | ${DEFAULT_ASSET_BASE}/card_icons/1_10261.png |`,
    );
    expect(markdown).toContain('| 图标 |');
  });

  it('includes the taxonomy and the full article text', () => {
    const markdown = llmsFull();

    expect(section(markdown, '## 分类')).toContain('water 水');
    expect(section(markdown, '## 分类')).toContain('alien 异族');

    const articles = tail(markdown, '## 文章全文');
    expect(articles).toContain('### 节奏榜使用说明');
    expect(articles).toContain('## 打开节奏榜');
    expect(articles).toContain('正文段落。');
    expect(articles).toContain(`url：${SITE_URL}/blog/tier-guide`);
    // Frontmatter is surfaced as metadata, not repeated as raw YAML.
    expect(articles).not.toContain('title: 节奏榜使用说明\ndate:');
  });

  it('stays inside the 400 KB budget', () => {
    expect(Buffer.byteLength(llmsFull(), 'utf8')).toBeLessThanOrEqual(400 * 1024);
  });
});

describe('buildBlogIndex', () => {
  it('emits every field the agent contract promises', () => {
    const index = JSON.parse(
      buildBlogIndex({
        siteUrl: SITE_URL,
        posts: [makePost(), makePost({ slug: 'card-data', date: '2026-10-01', updated: '2026-11-02' })],
      }),
    ) as Record<string, unknown>[];

    expect(index).toHaveLength(2);
    // Newest first.
    expect(index[0]?.slug).toBe('tier-guide');
    expect(index[0]).toEqual({
      slug: 'tier-guide',
      title: '节奏榜使用说明',
      date: '2026-11-01',
      updated: null,
      tags: ['节奏榜'],
      summary: '从拖拽排位到快照、导入导出与 PNG，一篇说明节奏榜的全部操作。',
      readingMinutes: 4,
      url: `${SITE_URL}/blog/tier-guide`,
      markdown: `${SITE_URL}/blog/tier-guide.md`,
    });
    expect(index[1]?.updated).toBe('2026-11-02');
  });
});

describe('tier.schema.json / tier-default.json', () => {
  const schema = TIER_SCHEMA as {
    $schema: string;
    additionalProperties?: boolean;
    properties: Record<string, Record<string, unknown>>;
  };

  it('is a draft-07 schema for the bl-tier format', () => {
    expect(JSON.parse(JSON.stringify(TIER_SCHEMA))).toEqual(TIER_SCHEMA);
    expect(schema.$schema).toBe('http://json-schema.org/draft-07/schema#');
    // Unknown keys are stripped by the importer, so the schema must not reject
    // them: `additionalProperties: false` would disagree with the parser.
    expect(schema.additionalProperties).toBeUndefined();
    expect(TIER_SCHEMA.description).toContain('未知字段会被忽略');

    const format = schema.properties.format;
    const version = schema.properties.version;
    const tiers = schema.properties.tiers;
    expect(format?.const).toBe('bl-tier');
    expect(version?.const).toBe(1);
    expect(tiers?.minItems).toBe(1);
    expect(tiers?.maxItems).toBe(12);
  });

  it('documents that unknown fields are ignored', () => {
    const tiers = schema.properties.tiers as {
      items: {
        additionalProperties?: boolean;
        description?: string;
        required: string[];
        properties: Record<string, Record<string, unknown>>;
      };
    };
    const tier = tiers.items;
    expect(tier.additionalProperties).toBeUndefined();
    expect(tier.description).toBe('未知字段会被忽略');
    expect(tier.properties.color?.pattern).toBe('^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$');
    expect(tier.properties.id?.minLength).toBe(1);
    expect(tier.properties.name?.minLength).toBe(1);

    const cards = tier.properties.cards as {
      items: {
        additionalProperties?: boolean;
        description?: string;
        properties: Record<string, Record<string, unknown>>;
      };
    };
    expect(cards.items.additionalProperties).toBeUndefined();
    expect(cards.items.description).toBe('未知字段会被忽略');
    expect(cards.items.properties.serial?.type).toBe('integer');
    expect(cards.items.properties.serial?.minimum).toBe(1);
    expect(cards.items.properties.name?.type).toBe('string');
  });

  it('ships a six-tier default file the importer accepts', () => {
    const file = defaultTierFile();

    expect(file.tiers).toHaveLength(6);
    expect(file.tiers.map((tier) => tier.name)).toEqual(['S', 'A', 'B', 'C', 'D', 'F']);
    expect(tierFileSchema.safeParse(file).success).toBe(true);
    expect(parseFile(file)).toMatchObject({ ok: true, warnings: [] });
  });

  it('keeps the checked-in public copies in sync', () => {
    const schemaFile = JSON.parse(
      readFileSync(path.join(PUBLIC_DIR, 'data', 'tier.schema.json'), 'utf8'),
    );
    const defaultFile = JSON.parse(
      readFileSync(path.join(PUBLIC_DIR, 'data', 'tier-default.json'), 'utf8'),
    );

    expect(schemaFile).toEqual(TIER_SCHEMA);
    expect(defaultFile).toEqual(defaultTierFile());
  });
});

describe('page descriptions', () => {
  const descriptions = [
    SITE_DESCRIPTION,
    homeDescription({ cardCount: 916, characterCount: 406 }),
    TIER_DESCRIPTION,
    BLOG_DESCRIPTION,
    tagDescription('数据', 1),
    tagDescription('节奏榜', 2),
    ...posts.map((post) => postDescription(post)),
  ];

  it('stays within the snippet range on every route', () => {
    for (const description of descriptions) {
      expect(description.length).toBeGreaterThanOrEqual(DESCRIPTION_MIN);
      expect(description.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
    }
  });

  it('is unique per route', () => {
    expect(new Set(descriptions).size).toBe(descriptions.length);
    expect(TIER_DESCRIPTION).not.toBe(BLOG_DESCRIPTION);
  });

  it('names the tag and its post count on tag pages', () => {
    const description = tagDescription('数据', 3);
    expect(description).toContain('「数据」');
    expect(description).toContain('3 篇文章');
  });

  it('clamps an over-long summary instead of overflowing', () => {
    const description = postDescription({ summary: '很长的摘要'.repeat(40), readingMinutes: 12 });

    expect(description.length).toBe(DESCRIPTION_MAX);
    expect(description.endsWith('…')).toBe(true);
    expect(clampDescription('short')).toBe('short');
  });
});

describe('JSON-LD', () => {
  it('serialises to parseable JSON and escapes `<`', () => {
    const node = webPageJsonLd({
      siteUrl: SITE_URL,
      path: '/blog/</script>',
      title: '</script><script>alert(1)</script>',
      description: '描述',
    });
    const serialised = serializeJsonLd(node);

    expect(serialised).not.toContain('</script>');
    expect(serialised).toContain('\\u003c');
    expect(JSON.parse(serialised)).toEqual(node);
  });

  it('describes the card catalogue as a free Dataset', () => {
    const dataset = datasetJsonLd({
      siteUrl: SITE_URL,
      cardCount: 916,
      characterCount: 406,
      description: '卡片数据',
    });

    expect(dataset['@type']).toBe('Dataset');
    expect(dataset.url).toBe(`${SITE_URL}/data/cards.json`);
    expect(dataset.isAccessibleForFree).toBe(true);
    expect(dataset.keywords).toContain('图鉴');
    expect((dataset.creator as Record<string, unknown>).name).toBe(SITE_NAME);
  });

  it('keeps the WebSite, WebPage and BlogPosting nodes intact', () => {
    const website = websiteJsonLd({ siteUrl: SITE_URL, description: SITE_DESCRIPTION });
    expect(website['@type']).toBe('WebSite');
    expect(website.url).toBe(SITE_URL);

    const graph = graphJsonLd([
      webPageJsonLd({ siteUrl: SITE_URL, path: '/', title: SITE_NAME, description: 'x' }),
      datasetJsonLd({ siteUrl: SITE_URL, cardCount: 1, characterCount: 1, description: 'x' }),
    ]);
    expect(JSON.parse(serializeJsonLd(graph))['@graph']).toHaveLength(2);

    const post = makePost();
    const article = blogPostingJsonLd({ siteUrl: SITE_URL, post });
    expect(article['@type']).toBe('BlogPosting');
    expect(article.headline).toBe(post.title);
    expect(article.mainEntityOfPage).toBe(`${SITE_URL}/blog/tier-guide`);
    expect(article.dateModified).toBe(post.date);
    expect(article.timeRequired).toBe('PT4M');
  });
});

describe('agentArtifacts plugin', () => {
  it('resolves a reproducible build date from BUILD_DATE or SOURCE_DATE_EPOCH', () => {
    expect(resolveBuildDate({})).toBeUndefined();
    expect(resolveBuildDate({ BUILD_DATE: '2026-11-02' })).toBe('2026-11-02');
    // 2026-11-02T00:00:00Z
    expect(resolveBuildDate({ SOURCE_DATE_EPOCH: '1793577600' })).toBe('2026-11-02');
    // BUILD_DATE wins when both are set.
    expect(
      resolveBuildDate({ BUILD_DATE: '2026-11-01', SOURCE_DATE_EPOCH: '1793577600' }),
    ).toBe('2026-11-01');
    expect(() => resolveBuildDate({ BUILD_DATE: '02-11-2026' })).toThrow('BUILD_DATE');
    expect(() => resolveBuildDate({ SOURCE_DATE_EPOCH: 'soon' })).toThrow('SOURCE_DATE_EPOCH');
  });

  it('advertises unique, root-relative endpoints', () => {
    const endpoints = dataEndpoints({ siteUrl: SITE_URL, cardCount: 916, characterCount: 406 });
    const paths = endpoints.map((endpoint) => endpoint.path);

    expect(new Set(paths).size).toBe(paths.length);
    for (const endpointPath of paths) {
      expect(endpointPath.startsWith('/')).toBe(true);
      expect(endpointPath).not.toContain('//');
    }
  });

  it('never emits a file that `public/` already provides', () => {
    for (const artifactPath of ARTIFACT_PATHS) {
      expect(artifactPath.startsWith('data/')).toBe(false);
    }
  });

  it('builds every artifact from the real content and data', async () => {
    const bundle = await buildArtifacts({ siteUrl: SITE_URL, buildDate: '2026-11-02' });

    for (const artifactPath of ARTIFACT_PATHS) {
      const source = bundle[artifactPath];
      expect(source, artifactPath).toBeTruthy();
      expect(source?.length ?? 0, artifactPath).toBeGreaterThan(0);
    }

    const slugs = posts.map((post) => post.slug);
    for (const slug of slugs) {
      expect(bundle[`blog/${slug}.md`]).toContain('---');
      const post = posts.find((candidate) => candidate.slug === slug);
      expect(bundle[`blog/${slug}.md`]).toBe(post?.source);
    }

    const index = JSON.parse(bundle['blog/index.json'] ?? '[]') as { slug: string }[];
    expect(index.map((entry) => entry.slug).sort()).toEqual([...slugs].sort());

    const sitemap = bundle['sitemap.xml'] ?? '';
    for (const slug of slugs) {
      expect(sitemap).toContain(`<loc>${SITE_URL}/blog/${slug}</loc>`);
    }

    const llmsFull = bundle['llms-full.txt'] ?? '';
    expect(llmsFull.split('\n').filter((line) => /^\| \d+ \|/.test(line))).toHaveLength(916);
  });
});
