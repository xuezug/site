/**
 * JSON-LD builders (design §8).
 *
 * Plain objects only: the routes serialise them with `serializeJsonLd`, which
 * escapes `<` so author-written text can never close the `<script>` element.
 */

import type { Post } from '../blog/content';
import { postHref } from '../blog/content';
import { SITE_NAME } from './meta';

export type JsonLd = Record<string, unknown>;

function absoluteUrl(siteUrl: string, sitePath: string): string {
  const base = siteUrl.replace(/\/+$/, '');
  if (sitePath === '' || sitePath === '/') {
    return base;
  }
  return `${base}${sitePath.startsWith('/') ? sitePath : `/${sitePath}`}`;
}

/**
 * `JSON.stringify` with every `<` escaped. Keeps `</script>` and `<!--` inside
 * strings from terminating the script element early while staying valid JSON.
 */
export function serializeJsonLd(value: JsonLd): string {
  return JSON.stringify(value).replaceAll('<', '\\u003c');
}

function organization(siteUrl: string): JsonLd {
  return { '@type': 'Organization', name: SITE_NAME, url: absoluteUrl(siteUrl, '/') };
}

/** Site-wide `WebSite` node, rendered by `root.tsx` on every page. */
export function websiteJsonLd(input: { siteUrl: string; description: string }): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SITE_NAME,
    url: absoluteUrl(input.siteUrl, '/'),
    description: input.description,
    inLanguage: 'zh-CN',
  };
}

/** Per-page `WebPage` node; home pairs it with `datasetJsonLd`. */
export function webPageJsonLd(input: {
  siteUrl: string;
  path: string;
  title: string;
  description: string;
}): JsonLd {
  return {
    '@type': 'WebPage',
    name: input.title,
    description: input.description,
    url: absoluteUrl(input.siteUrl, input.path),
    inLanguage: 'zh-CN',
    isPartOf: {
      '@type': 'WebSite',
      name: SITE_NAME,
      url: absoluteUrl(input.siteUrl, '/'),
    },
  };
}

/** The card catalogue as a free `Dataset` (home page only). */
export function datasetJsonLd(input: {
  siteUrl: string;
  cardCount: number;
  characterCount: number;
  description: string;
}): JsonLd {
  const cardsUrl = absoluteUrl(input.siteUrl, '/data/cards.json');

  return {
    '@type': 'Dataset',
    name: '《血族》卡片数据',
    description: input.description,
    url: cardsUrl,
    keywords: ['血族', '卡牌', '图鉴', 'Tier Maker', '节奏榜', '游戏数据'],
    isAccessibleForFree: true,
    inLanguage: 'zh-CN',
    creator: organization(input.siteUrl),
    variableMeasured: ['serial', 'name', 'star', 'attribute', 'faction', 'career', 'iconPath'],
    distribution: [
      {
        '@type': 'DataDownload',
        contentUrl: cardsUrl,
        encodingFormat: 'application/json',
      },
      {
        '@type': 'DataDownload',
        contentUrl: absoluteUrl(input.siteUrl, '/data/cards.csv'),
        encodingFormat: 'text/csv',
      },
    ],
  };
}

/** Article structured data, one node per `/blog/:slug` page. */
export function blogPostingJsonLd(input: { siteUrl: string; post: Post }): JsonLd {
  const { post } = input;

  return {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title,
    datePublished: post.date,
    dateModified: post.updated ?? post.date,
    author: organization(input.siteUrl),
    publisher: organization(input.siteUrl),
    mainEntityOfPage: absoluteUrl(input.siteUrl, postHref(post.slug)),
    url: absoluteUrl(input.siteUrl, postHref(post.slug)),
    inLanguage: 'zh-CN',
    keywords: post.tags.join(','),
    description: post.summary,
    ...(post.readingMinutes > 0 ? { timeRequired: `PT${String(post.readingMinutes)}M` } : {}),
  };
}

/** One `<script type="application/ld+json">` containing several nodes. */
export function graphJsonLd(nodes: readonly JsonLd[]): JsonLd {
  return { '@context': 'https://schema.org', '@graph': nodes };
}
