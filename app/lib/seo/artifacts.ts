/**
 * Pure builders for the Agent-facing static artifacts (design §8).
 *
 * Every builder takes already-resolved data and returns a string: no `fs`, no
 * `import.meta.env`, no `Date.now()` hidden inside. That keeps the Vite plugin,
 * the unit tests and any maintenance script byte-identical, and lets the tests
 * run without a build.
 *
 * The plugin (`plugins/agent-artifacts.ts`) is the only thing that reads files.
 */

import { DEFAULT_TIERS, DEFAULT_TITLE } from '../tier/model';
import { sortPosts, type Post } from '../blog/content';
import type { Card } from '../cards/types';
import { SITE_NAME } from './meta';

/**
 * Asset host used for card icons in `llms-full.txt`. Mirrors the fallback in
 * `app/lib/env.ts` (which cannot be imported here: it reads `__SITE_URL__`,
 * a define that only exists inside the bundled app).
 */
export const DEFAULT_ASSET_BASE = 'https://bl-resource.cracklewis.site';

/** One entry of `taxonomy.json`. */
export type TaxonomyEntry = {
  id: string;
  label: string;
  /** Only present on attributes. */
  color?: string;
  /** Only present on attributes. */
  gameId?: number;
};

/** The subset of `taxonomy.json` the artifacts need. */
export type Taxonomy = {
  attributes: readonly TaxonomyEntry[];
  factions: readonly TaxonomyEntry[];
  careers: readonly TaxonomyEntry[];
  genders: readonly TaxonomyEntry[];
  stars: readonly number[];
};

/** A data endpoint listed in `llms.txt` / `llms-full.txt`. */
export type LlmsEndpoint = {
  path: string;
  description: string;
};

/* -------------------------------------------------------------------------- */
/* Shared helpers                                                             */
/* -------------------------------------------------------------------------- */

function trimBase(base: string): string {
  return base.replace(/\/+$/, '');
}

/**
 * Absolute URL for a site path. `/` yields the bare site URL (no trailing
 * slash), matching the canonical URL the home page declares.
 */
function absoluteUrl(siteUrl: string, sitePath: string): string {
  const base = trimBase(siteUrl);
  if (sitePath === '' || sitePath === '/') {
    return base;
  }
  return `${base}${sitePath.startsWith('/') ? sitePath : `/${sitePath}`}`;
}

function iconUrl(assetBase: string, iconPath: string): string {
  if (iconPath === '') {
    return '';
  }
  return `${trimBase(assetBase)}/${iconPath.replace(/^\/+/, '')}`;
}

/** The five characters XML requires escaping, in a single pass. */
function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&apos;';
    }
  });
}

/** `markdown` cell text: one line, `|` escaped so the table cannot break. */
function tableCell(value: string): string {
  return value.replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim();
}

function labelOf(entries: readonly TaxonomyEntry[], id: string): string {
  return entries.find((entry) => entry.id === id)?.label ?? id;
}

/** Post date used for `lastmod`: the edit date when present, else the date. */
function postLastmod(post: Post): string {
  return post.updated ?? post.date;
}

/** Latest `lastmod` among the posts carrying `tag`, or `undefined`. */
function tagLastmod(posts: readonly Post[], tag: string): string | undefined {
  let latest: string | undefined;
  for (const post of posts) {
    if (!post.tags.includes(tag)) {
      continue;
    }
    const value = postLastmod(post);
    if (latest === undefined || value > latest) {
      latest = value;
    }
  }
  return latest;
}

/**
 * Raw Markdown body without the leading frontmatter block. The builders show
 * the frontmatter fields explicitly instead, so a `---` fence in the body is
 * never reinterpreted.
 */
function markdownBody(source: string): string {
  const match = /^---\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n?/.exec(source);
  const body = match === null ? source : source.slice(match[0].length);
  return body.replace(/^\s+/, '').replace(/\s+$/, '');
}

/** Paths that must never appear in the sitemap. */
function isExcludedPath(sitePath: string): boolean {
  return sitePath === '/404' || sitePath.includes('__spa-fallback') || sitePath.startsWith('/404/');
}

function normalizePath(sitePath: string): string {
  return sitePath.startsWith('/') ? sitePath : `/${sitePath}`;
}

/* -------------------------------------------------------------------------- */
/* sitemap.xml                                                                */
/* -------------------------------------------------------------------------- */

export type SitemapStaticPath = {
  path: string;
  /** `YYYY-MM-DD`; the build date for prerendered pages. */
  lastmod?: string;
};

export type SitemapInput = {
  siteUrl: string;
  staticPaths: readonly SitemapStaticPath[];
  posts: readonly Post[];
  /** Decoded tag names; the URL form is `encodeURIComponent(tag)`. */
  tags: readonly string[];
};

/**
 * Every indexable route, in page order: static pages, tag pages, articles.
 * Drafts are the caller's responsibility (`loadPosts` already dropped them).
 */
export function buildSitemap(input: SitemapInput): string {
  const entries: { path: string; lastmod?: string }[] = [];

  for (const entry of input.staticPaths) {
    const sitePath = normalizePath(entry.path);
    if (isExcludedPath(sitePath)) {
      continue;
    }
    entries.push({ path: sitePath, ...(entry.lastmod === undefined ? {} : { lastmod: entry.lastmod }) });
  }

  for (const tag of input.tags) {
    const lastmod = tagLastmod(input.posts, tag);
    entries.push({
      path: `/blog/tag/${encodeURIComponent(tag)}`,
      ...(lastmod === undefined ? {} : { lastmod }),
    });
  }

  for (const post of input.posts) {
    entries.push({ path: `/blog/${post.slug}`, lastmod: postLastmod(post) });
  }

  const seen = new Set<string>();
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ];

  for (const entry of entries) {
    if (seen.has(entry.path)) {
      continue;
    }
    seen.add(entry.path);

    const loc = escapeXml(absoluteUrl(input.siteUrl, entry.path));
    const lastmod = entry.lastmod === undefined ? '' : `<lastmod>${escapeXml(entry.lastmod)}</lastmod>`;
    lines.push(`  <url><loc>${loc}</loc>${lastmod}</url>`);
  }

  lines.push('</urlset>', '');

  return lines.join('\n');
}

/* -------------------------------------------------------------------------- */
/* robots.txt                                                                 */
/* -------------------------------------------------------------------------- */

export function buildRobotsTxt(input: { siteUrl: string }): string {
  return [
    'User-agent: *',
    'Allow: /',
    'Disallow: /404',
    'Disallow: /__spa-fallback',
    '',
    `Sitemap: ${absoluteUrl(input.siteUrl, '/sitemap.xml')}`,
    '',
  ].join('\n');
}

/* -------------------------------------------------------------------------- */
/* llms.txt                                                                   */
/* -------------------------------------------------------------------------- */

export type LlmsTxtInput = {
  siteUrl: string;
  posts: readonly Post[];
  endpoints: readonly LlmsEndpoint[];
  siteName?: string;
  cardCount?: number;
  characterCount?: number;
};

function siteIntro(input: { cardCount?: number; characterCount?: number }): string {
  const base = '《血族》卡牌图鉴、Tier Maker 节奏榜与版本笔记。';

  if (input.cardCount === undefined) {
    return base;
  }

  const characters =
    input.characterCount === undefined ? '' : ` / ${String(input.characterCount)} 个角色`;
  return `${base}共 ${String(input.cardCount)} 张卡${characters}。`;
}

function endpointLines(siteUrl: string, endpoints: readonly LlmsEndpoint[]): string[] {
  return endpoints.map((endpoint) => {
    const link = `[${endpointLabel(endpoint.path)}](${absoluteUrl(siteUrl, endpoint.path)})`;
    return `- ${link}：${endpoint.description}`;
  });
}

/** Readable label for an endpoint without asking the caller for a title. */
function endpointLabel(endpointPath: string): string {
  const file = endpointPath.replace(/^\/+/, '');
  switch (file) {
    case 'data/cards.json':
      return '卡片数据';
    case 'data/cards.csv':
      return '卡片 CSV';
    case 'data/taxonomy.json':
      return '分类枚举';
    case 'data/meta.json':
      return '数据元信息';
    case 'data/tier.schema.json':
      return '榜单 JSON Schema';
    case 'data/tier-default.json':
      return '默认榜单';
    case 'blog/index.json':
      return '博客索引';
    case 'llms-full.txt':
      return '全文数据';
    case 'sitemap.xml':
      return '站点地图';
    default:
      return file;
  }
}

/** Short, agent-readable index: purpose, endpoints, pages, articles, citation. */
export function buildLlmsTxt(input: LlmsTxtInput): string {
  const siteName = input.siteName ?? SITE_NAME;
  const articles = sortPosts(input.posts);

  const lines: string[] = [
    `# ${siteName}`,
    '',
    `> ${siteIntro(input)}`,
    '',
    '## 数据端点',
    ...endpointLines(input.siteUrl, input.endpoints),
    '',
    '## 页面',
    `- [首页](${absoluteUrl(input.siteUrl, '/')})：站点简介、数据摘要与入口`,
    `- [节奏榜](${absoluteUrl(input.siteUrl, '/tier')})：拖拽排序，数据仅存本机浏览器`,
    `- [博客](${absoluteUrl(input.siteUrl, '/blog')})：版本笔记与数据说明`,
  ];

  if (articles.length > 0) {
    lines.push('', '## 文章');
    for (const post of articles) {
      lines.push(
        `- [${post.title}](${absoluteUrl(input.siteUrl, `/blog/${post.slug}`)})：${post.summary}`,
      );
      lines.push(`  - 原文：${absoluteUrl(input.siteUrl, `/blog/${post.slug}.md`)}`);
    }
  }

  lines.push(
    '',
    '## 引用',
    `- ${siteName}是《血族》非官方玩家资料站，卡片、图标与名称的版权归游戏方所有。`,
    `- 引用卡片数据时请注明来源（${siteName}，${trimBase(input.siteUrl)}）并保留字段名。`,
    '- 图标由独立的资源域名提供，随游戏版本更新；可以缓存，但不建议长期镜像。',
    `- 需要一次性读取全部内容时使用 [全文数据](${absoluteUrl(input.siteUrl, '/llms-full.txt')})。`,
    '',
  );

  return lines.join('\n');
}

/* -------------------------------------------------------------------------- */
/* llms-full.txt                                                              */
/* -------------------------------------------------------------------------- */

export type LlmsFullInput = {
  siteUrl: string;
  posts: readonly Post[];
  cards: readonly Card[];
  taxonomy: Taxonomy;
  assetBase?: string;
  siteName?: string;
  /** Reuses the same endpoint list as `llms.txt` when provided. */
  endpoints?: readonly LlmsEndpoint[];
};

const CARD_TABLE_HEADER = [
  '| serial | 名称 | 星级 | 主属性 | 阵营 | 职业 | 图标 |',
  '| --- | --- | --- | --- | --- | --- | --- |',
];

function cardRows(cards: readonly Card[], assetBase: string, taxonomy: Taxonomy): string[] {
  return cards.map((card) => {
    const icon = iconUrl(assetBase, card.iconPath);
    const cells = [
      String(card.serial),
      tableCell(card.name),
      String(card.star),
      tableCell(labelOf(taxonomy.attributes, card.attribute)),
      tableCell(labelOf(taxonomy.factions, card.faction)),
      tableCell(labelOf(taxonomy.careers, card.career)),
      icon === '' ? '—' : icon,
    ];
    return `| ${cells.join(' | ')} |`;
  });
}

function taxonomyLines(taxonomy: Taxonomy): string[] {
  const join = (entries: readonly TaxonomyEntry[]): string =>
    entries.map((entry) => `${entry.id} ${entry.label}`).join('、');

  const stars =
    taxonomy.stars.length === 0
      ? ''
      : `${String(Math.min(...taxonomy.stars))}–${String(Math.max(...taxonomy.stars))}`;

  return [
    `- 属性：${join(taxonomy.attributes)}`,
    `- 阵营：${join(taxonomy.factions)}`,
    `- 职业：${join(taxonomy.careers)}`,
    `- 性别：${join(taxonomy.genders)}`,
    `- 星级：${stars}`,
  ];
}

function postSections(input: { siteUrl: string; posts: readonly Post[] }): string[] {
  const lines: string[] = [];

  for (const post of sortPosts(input.posts)) {
    lines.push(
      `### ${post.title}`,
      '',
      `- slug：${post.slug}`,
      `- date：${post.date}`,
      `- updated：${post.updated ?? post.date}`,
      `- tags：${post.tags.join('、')}`,
      `- readingMinutes：${String(post.readingMinutes)}`,
      `- url：${absoluteUrl(input.siteUrl, `/blog/${post.slug}`)}`,
      `- markdown：${absoluteUrl(input.siteUrl, `/blog/${post.slug}.md`)}`,
      '',
      markdownBody(post.source),
      '',
    );
  }

  return lines;
}

/**
 * Everything an agent needs in one file: the site description, the full card
 * table, the taxonomy and every article's raw Markdown.
 */
export function buildLlmsFull(input: LlmsFullInput): string {
  const siteName = input.siteName ?? SITE_NAME;
  const assetBase = input.assetBase ?? DEFAULT_ASSET_BASE;

  const characterCount = new Set(input.cards.map((card) => card.uniqueId)).size;
  const lines: string[] = [
    `# ${siteName}`,
    '',
    `> ${siteIntro({ cardCount: input.cards.length, characterCount })}`,
    '',
    '本站是完全静态的《血族》玩家资料站：所有路由在构建期预渲染为 HTML，数据以 JSON / CSV 端点和本文件提供，无需执行 JavaScript。',
    '',
    '## 数据端点',
  ];

  if (input.endpoints !== undefined && input.endpoints.length > 0) {
    lines.push(...endpointLines(input.siteUrl, input.endpoints));
  } else {
    lines.push(
      `- [卡片数据](${absoluteUrl(input.siteUrl, '/data/cards.json')})：${String(input.cards.length)} 条 JSON 记录`,
      `- [卡片 CSV](${absoluteUrl(input.siteUrl, '/data/cards.csv')})：同样的数据，列名为英文`,
      `- [分类枚举](${absoluteUrl(input.siteUrl, '/data/taxonomy.json')})：属性、阵营、职业、性别、星级的 id 与中文标签`,
      `- [数据元信息](${absoluteUrl(input.siteUrl, '/data/meta.json')})：条数、生成时间与字段版本`,
    );
  }

  lines.push(
    '',
    '## 卡片全表',
    '',
    `共 ${String(input.cards.length)} 行，按 serial 升序。图标列为绝对 URL，可直接下载。`,
    '',
    ...CARD_TABLE_HEADER,
    ...cardRows(input.cards, assetBase, input.taxonomy),
    '',
    '## 分类',
    '',
    ...taxonomyLines(input.taxonomy),
    '',
    '## 文章全文',
    '',
    ...postSections({ siteUrl: input.siteUrl, posts: input.posts }),
  );

  return `${lines.join('\n').replace(/\n+$/, '')}\n`;
}

/* -------------------------------------------------------------------------- */
/* blog/index.json                                                            */
/* -------------------------------------------------------------------------- */

export type BlogIndexEntry = {
  slug: string;
  title: string;
  date: string;
  updated: string | null;
  tags: string[];
  summary: string;
  readingMinutes: number;
  url: string;
  markdown: string;
};

export function buildBlogIndex(input: { siteUrl: string; posts: readonly Post[] }): string {
  const entries: BlogIndexEntry[] = sortPosts(input.posts).map((post) => ({
    slug: post.slug,
    title: post.title,
    date: post.date,
    updated: post.updated ?? null,
    tags: [...post.tags],
    summary: post.summary,
    readingMinutes: post.readingMinutes,
    url: absoluteUrl(input.siteUrl, `/blog/${post.slug}`),
    markdown: absoluteUrl(input.siteUrl, `/blog/${post.slug}.md`),
  }));

  return `${JSON.stringify(entries, null, 2)}\n`;
}

/* -------------------------------------------------------------------------- */
/* tier.schema.json / tier-default.json                                       */
/* -------------------------------------------------------------------------- */

/** JSON Schema draft-07 description of the `format: "bl-tier"` file (§6.6). */
export const TIER_SCHEMA: Readonly<Record<string, unknown>> = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: '《血族》资源站 Tier Maker 榜单文件',
  description:
    '节奏榜导出/导入文件（format "bl-tier"、version 1）。卡片只保存 serial 与可读的 name，展示以本站 /data/cards.json 为准。未知字段会被忽略。',
  type: 'object',
  required: ['format', 'version', 'title', 'updatedAt', 'tiers'],
  properties: {
    format: {
      const: 'bl-tier',
      description: '固定值，用于识别文件类型。',
    },
    version: {
      const: 1,
      description: '文件格式版本。',
    },
    title: {
      type: 'string',
      description: '榜单标题，默认「我的节奏榜」。',
    },
    updatedAt: {
      type: 'string',
      format: 'date-time',
      description: '导出时间（ISO 8601）；导入时会重新写入当前时间。',
    },
    tiers: {
      type: 'array',
      description: '档位列表，顺序即显示顺序，1–12 个。',
      minItems: 1,
      maxItems: 12,
      items: {
        type: 'object',
        description: '未知字段会被忽略',
        required: ['id', 'name', 'color', 'cards'],
        properties: {
          id: {
            type: 'string',
            minLength: 1,
            description: '档位标识，同一文件内唯一。',
          },
          name: {
            type: 'string',
            minLength: 1,
            description: '档位名称，如 S / A / B。',
          },
          color: {
            type: 'string',
            pattern: '^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$',
            description: '档位颜色，#rgb 或 #rrggbb。',
          },
          cards: {
            type: 'array',
            description: '档位内的卡片，按显示顺序排列。',
            items: {
              type: 'object',
              description: '未知字段会被忽略',
              required: ['serial'],
              properties: {
                serial: {
                  type: 'integer',
                  minimum: 1,
                  description: '卡片编号，对应 /data/cards.json 的 serial。',
                },
                name: {
                  type: 'string',
                  description: '可读快照，可为空；展示以本地数据为准。',
                },
              },
            },
          },
        },
      },
    },
  },
};

export type DefaultTierFile = {
  format: 'bl-tier';
  version: 1;
  title: string;
  updatedAt: string;
  tiers: { id: string; name: string; color: string; cards: { serial: number; name: string }[] }[];
};

/**
 * Placeholder timestamp for the downloadable starter file: a template has no
 * meaningful export time, and the importer stamps `updatedAt` itself.
 */
export const DEFAULT_TIER_UPDATED_AT = '1970-01-01T00:00:00.000Z';

/** The default six-tier board (S A B C D F) as a `bl-tier` file. */
export function defaultTierFile(updatedAt: string = DEFAULT_TIER_UPDATED_AT): DefaultTierFile {
  return {
    format: 'bl-tier',
    version: 1,
    title: DEFAULT_TITLE,
    updatedAt,
    tiers: DEFAULT_TIERS.map((tier) => ({
      id: tier.id,
      name: tier.name,
      color: tier.color,
      cards: [],
    })),
  };
}
