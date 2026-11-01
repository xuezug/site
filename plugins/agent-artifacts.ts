/**
 * Agent/SEO static artifacts (design §8).
 *
 * Everything an agent can read without executing JavaScript is emitted from
 * one place: `llms.txt`, `llms-full.txt`, `sitemap.xml`, `robots.txt`,
 * `blog/index.json` and one `blog/<slug>.md` per published post.
 *
 * `/data/*` is *not* produced here: `scripts/sync-data.mjs` copies `src/data/*`
 * into `public/data/` (and the checked-in `tier.schema.json` /
 * `tier-default.json` live there too), so emitting them again would overwrite
 * Vite's public-directory copy. Data is read straight from `src/data` because
 * `public/` files are not part of the Rollup bundle at `generateBundle` time.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';
import { collectTags } from '../app/lib/blog/content';
import type { Card } from '../app/lib/cards/types';
import {
  buildBlogIndex,
  buildLlmsFull,
  buildLlmsTxt,
  buildRobotsTxt,
  buildSitemap,
  DEFAULT_ASSET_BASE,
  type LlmsEndpoint,
  type Taxonomy,
} from '../app/lib/seo/artifacts';
import { DEFAULT_CONTENT_DIR, loadPosts } from './blog-content';

/** `site/src/data`, resolved from the Vite root like the content directory. */
export const DEFAULT_DATA_DIR = path.resolve(process.cwd(), 'src', 'data');

/** Files this plugin owns, relative to the build output root. */
export const ARTIFACT_PATHS = [
  'llms.txt',
  'llms-full.txt',
  'sitemap.xml',
  'robots.txt',
  'blog/index.json',
] as const;

type DataMeta = {
  cardCount?: number;
  characterCount?: number;
};

export type AgentArtifactsOptions = {
  /** Absolute site URL, already resolved by `resolveSiteUrl`. */
  siteUrl: string;
  contentDir?: string;
  dataDir?: string;
  /** Card-icon host; defaults to the same URL as `app/lib/env.ts`. */
  assetBase?: string;
  /** `YYYY-MM-DD` for the static pages' `lastmod`; defaults to today (UTC). */
  buildDate?: string;
};

/**
 * Reproducible `lastmod` override for the sitemap's static pages.
 *
 * - `BUILD_DATE=YYYY-MM-DD` wins (used by CI when the commit date is known).
 * - otherwise `SOURCE_DATE_EPOCH` (seconds since the Unix epoch, the standard
 *   reproducible-build variable) is converted to a UTC date.
 * - with neither set the caller falls back to today, so normal builds are
 *   unchanged.
 */
export function resolveBuildDate(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const explicit = env.BUILD_DATE?.trim();
  if (explicit !== undefined && explicit !== '') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(explicit)) {
      throw new Error(`[agent-artifacts] BUILD_DATE must be YYYY-MM-DD, got "${explicit}".`);
    }
    return explicit;
  }

  const epoch = env.SOURCE_DATE_EPOCH?.trim();
  if (epoch !== undefined && epoch !== '') {
    const seconds = Number(epoch);
    if (!Number.isSafeInteger(seconds) || seconds < 0) {
      throw new Error(
        `[agent-artifacts] SOURCE_DATE_EPOCH must be a non-negative integer, got "${epoch}".`,
      );
    }
    return new Date(seconds * 1000).toISOString().slice(0, 10);
  }

  return undefined;
}

export type ArtifactBundle = Record<string, string>;

function readJson<T>(filePath: string): T {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as T;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`[agent-artifacts] cannot read ${filePath}: ${reason}`, { cause: error });
  }
}

/** Every data endpoint advertised to agents, with a one-line description. */
export function dataEndpoints(input: {
  siteUrl: string;
  cardCount: number;
  characterCount: number;
}): LlmsEndpoint[] {
  const base = input.siteUrl.replace(/\/+$/, '');
  return [
    {
      path: '/data/cards.json',
      description: `${String(input.cardCount)} 条卡片 JSON 记录（${String(input.characterCount)} 位角色），字段说明见 ${base}/blog/card-data`,
    },
    {
      path: '/data/cards.csv',
      description: '同一份数据的 CSV 版本，列名为英文，UTF-8 编码（带 BOM）',
    },
    {
      path: '/data/taxonomy.json',
      description: '属性、阵营、职业、性别、星级的 id 与中文标签',
    },
    {
      path: '/data/meta.json',
      description: '条数、生成时间、字段版本与数据来源',
    },
    {
      path: '/data/tier.schema.json',
      description: '节奏榜文件（format "bl-tier"、version 1）的 JSON Schema，便于生成或校验榜单',
    },
    {
      path: '/data/tier-default.json',
      description: '默认 6 档榜单（S A B C D F），可直接导入 /tier',
    },
    {
      path: '/blog/index.json',
      description: '博客文章元数据列表，含摘要、阅读时长与每篇原文 Markdown 的地址',
    },
    {
      path: '/llms-full.txt',
      description: `站点说明 + ${String(input.cardCount)} 行卡片全表 + 全部文章正文（Markdown）`,
    },
    {
      path: '/sitemap.xml',
      description: '全部可索引路由的站点地图（不含 /404 与 SPA 回退）',
    },
  ];
}

function withTrailingNewline(source: string): string {
  return source.endsWith('\n') ? source : `${source}\n`;
}

/**
 * Build every artifact in memory. Pure apart from the reads of `contentDir`
 * and `dataDir`, which makes it testable without starting Vite.
 */
export async function buildArtifacts(options: AgentArtifactsOptions): Promise<ArtifactBundle> {
  const siteUrl = options.siteUrl.replace(/\/+$/, '');
  const contentDir = options.contentDir ?? DEFAULT_CONTENT_DIR;
  const dataDir = options.dataDir ?? DEFAULT_DATA_DIR;
  const assetBase =
    options.assetBase === undefined || options.assetBase.trim() === ''
      ? DEFAULT_ASSET_BASE
      : options.assetBase;
  const buildDate = options.buildDate ?? resolveBuildDate() ?? new Date().toISOString().slice(0, 10);

  const posts = await loadPosts({ includeDrafts: false, contentDir, siteUrl });
  const cards = readJson<Card[]>(path.join(dataDir, 'cards.json'));
  const taxonomy = readJson<Taxonomy>(path.join(dataDir, 'taxonomy.json'));
  const meta = readJson<DataMeta>(path.join(dataDir, 'meta.json'));

  const cardCount = cards.length;
  const characterCount = new Set(cards.map((card) => card.uniqueId)).size;
  if (meta.cardCount !== undefined && meta.cardCount !== cardCount) {
    throw new Error(
      `[agent-artifacts] src/data/meta.json says ${String(meta.cardCount)} cards ` +
        `but cards.json has ${String(cardCount)}; re-run \`npm run data\`.`,
    );
  }

  const endpoints = dataEndpoints({ siteUrl, cardCount, characterCount });
  const tags = collectTags(posts).map((tag) => tag.tag);

  const bundle: ArtifactBundle = {
    'llms.txt': buildLlmsTxt({
      siteUrl,
      posts,
      endpoints,
      cardCount,
      characterCount,
    }),
    'llms-full.txt': buildLlmsFull({ siteUrl, posts, cards, taxonomy, assetBase, endpoints }),
    'sitemap.xml': buildSitemap({
      siteUrl,
      staticPaths: [
        { path: '/', lastmod: buildDate },
        { path: '/tier', lastmod: buildDate },
        { path: '/blog', lastmod: buildDate },
      ],
      posts,
      tags,
    }),
    'robots.txt': buildRobotsTxt({ siteUrl }),
    'blog/index.json': buildBlogIndex({ siteUrl, posts }),
  };

  for (const post of posts) {
    bundle[`blog/${post.slug}.md`] = withTrailingNewline(post.source);
  }

  return bundle;
}

/**
 * Emits the artifacts into the client build. React Router runs a second build
 * for prerendering; its output is removed by `scripts/postbuild.mjs`, so the
 * files are written once, into the output that becomes `dist/`.
 */
export function agentArtifacts(options: AgentArtifactsOptions): Plugin {
  return {
    name: 'bl-agent-artifacts',
    apply: 'build',

    async generateBundle() {
      const environment = this.environment;
      if (environment !== undefined && environment.name !== 'client') {
        return;
      }

      const bundle = await buildArtifacts(options);
      for (const [fileName, source] of Object.entries(bundle)) {
        this.emitFile({ type: 'asset', fileName, source });
      }

      const count = Object.keys(bundle).length;
      console.log(`[agent-artifacts] emitted ${String(count)} files for ${options.siteUrl}`);
    },
  };
}

export default agentArtifacts;
