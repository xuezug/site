import { Link } from 'react-router';
import type { Route } from './+types/home';
import { ATTRIBUTES, FACTIONS } from '../lib/cards/taxonomy';
import { SITE_URL } from '../lib/env';
import type { RouteHandle } from '../lib/seo/head';
import { datasetJsonLd, graphJsonLd, serializeJsonLd, webPageJsonLd } from '../lib/seo/jsonld';
import { homeDescription, SITE_NAME } from '../lib/seo/meta';
import metaJson from '../../src/data/meta.json';

// Counts come from `meta.json` (≈300 bytes) instead of the 254 KB
// `cards.json`: the home page only shows totals, and the full catalogue would
// put that chunk in the initial route bundle. Attribute/faction totals come
// from the small taxonomy module.
const CARD_COUNT = metaJson.cardCount;
const CHARACTER_COUNT = metaJson.characterCount;
const ATTRIBUTE_COUNT = ATTRIBUTES.length;
const FACTION_COUNT = FACTIONS.length;

const DESCRIPTION = homeDescription({
  cardCount: CARD_COUNT,
  characterCount: CHARACTER_COUNT,
});

/** `/` is the only page that also describes the card data set. */
export const handle: RouteHandle = {
  og: { title: SITE_NAME, description: DESCRIPTION, type: 'website' },
};

const SUMMARY = [
  { label: '卡片（含皮肤）', value: CARD_COUNT },
  { label: '角色', value: CHARACTER_COUNT },
  { label: '属性', value: ATTRIBUTE_COUNT },
  { label: '阵营', value: FACTION_COUNT },
];

const HOME_JSON_LD = serializeJsonLd(
  graphJsonLd([
    webPageJsonLd({
      siteUrl: SITE_URL,
      path: '/',
      title: SITE_NAME,
      description: DESCRIPTION,
    }),
    datasetJsonLd({
      siteUrl: SITE_URL,
      cardCount: CARD_COUNT,
      characterCount: CHARACTER_COUNT,
      description: `《血族》${String(CARD_COUNT)} 张卡片（${String(CHARACTER_COUNT)} 位角色）的图标、属性、阵营、职业与星级数据，与站点页面使用同一份导出产物。`,
    }),
  ]),
);

export function meta(_args: Route.MetaArgs) {
  return [
    { title: SITE_NAME },
    { name: 'description', content: DESCRIPTION },
  ];
}

export default function Home() {
  return (
    <div className="flex flex-col gap-12">
      <section className="flex flex-col gap-4">
        <p className="inline-flex w-fit items-center rounded-full border border-[color:var(--bl-border)] px-3 py-1 text-xs text-[var(--bl-muted)]">
          非官方 · 玩家资料站
        </p>
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">血族资源站</h1>
        <p className="max-w-2xl text-base leading-relaxed text-[var(--bl-muted)]">
          《血族》卡牌图鉴、Tier Maker 与版本笔记。{CARD_COUNT}{' '}
          张卡（含皮肤）的图标与属性数据整理自游戏资源，可以快速筛卡查卡，也可以拖成自己的节奏榜。
        </p>
      </section>

      <section aria-labelledby="features-heading" className="flex flex-col gap-4">
        <h2
          id="features-heading"
          className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--bl-muted)]"
        >
          功能入口
        </h2>

        <div className="grid gap-4 sm:grid-cols-2">
          <Link
            to="/tier"
            className="bl-panel group flex flex-col gap-2 p-5 transition-colors hover:border-[color:var(--bl-accent)] hover:bg-[var(--bl-panel-hover)]"
          >
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--bl-accent-text)]">
              Tier Maker
            </span>
            <span className="text-xl font-semibold text-[var(--bl-text)]">节奏榜</span>
            <span className="text-sm leading-relaxed text-[var(--bl-muted)]">
              把 {CARD_COUNT} 张卡排成你的节奏榜
            </span>
            <span
              aria-hidden="true"
              className="mt-1 text-sm font-medium text-[var(--bl-accent-text)] transition-transform group-hover:translate-x-0.5"
            >
              打开节奏榜 →
            </span>
          </Link>

          <Link
            to="/blog"
            className="bl-panel group flex flex-col gap-2 p-5 transition-colors hover:border-[color:var(--bl-accent)] hover:bg-[var(--bl-panel-hover)]"
          >
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--bl-accent-text)]">
              Blog
            </span>
            <span className="text-xl font-semibold text-[var(--bl-text)]">博客</span>
            <span className="text-sm leading-relaxed text-[var(--bl-muted)]">版本笔记与数据说明</span>
            <span
              aria-hidden="true"
              className="mt-1 text-sm font-medium text-[var(--bl-accent-text)] transition-transform group-hover:translate-x-0.5"
            >
              阅读文章 →
            </span>
          </Link>
        </div>
      </section>

      <section aria-labelledby="data-heading" className="bl-panel flex flex-col gap-5 p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 id="data-heading" className="text-sm font-semibold text-[var(--bl-text)]">
            数据摘要
          </h2>
          <a
            href="/data/cards.json"
            download
            className="text-sm font-medium text-[var(--bl-accent-text)] underline-offset-4 hover:underline"
          >
            下载 /data/cards.json
          </a>
        </div>

        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {SUMMARY.map((item) => (
            <div key={item.label} className="flex flex-col gap-1">
              <dt className="text-xs text-[var(--bl-muted)]">{item.label}</dt>
              <dd className="text-2xl font-semibold text-[var(--bl-accent-text)]">{item.value}</dd>
            </div>
          ))}
        </dl>

        <p className="text-xs leading-relaxed text-[var(--bl-muted)]">
          数据以卡（含皮肤）为单位，同一角色的多张皮肤共享一个角色编号；完整字段见{' '}
          <a href="/data/cards.json" className="underline underline-offset-4">
            cards.json
          </a>
          ，属性与阵营的中文标签见{' '}
          <a href="/data/taxonomy.json" className="underline underline-offset-4">
            taxonomy.json
          </a>
          。
        </p>
      </section>

      <script
        type="application/ld+json"
        // Build-time constants only; `serializeJsonLd` escapes `<`.
        dangerouslySetInnerHTML={{ __html: HOME_JSON_LD }}
      />
    </div>
  );
}
