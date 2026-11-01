/**
 * Page titles and descriptions, in one place.
 *
 * Search engines and agents both read `<meta name="description">`, so every
 * route needs its own sentence: no two routes share one, and each stays inside
 * `DESCRIPTION_MIN`–`DESCRIPTION_MAX` characters (the usual Chinese snippet
 * range). The values are plain strings — no `Date`, no `fs` — so the routes and
 * the tests agree on the exact text.
 */

import type { Post } from '../blog/content';

export const SITE_NAME = '血族资源站';

/** Inclusive range every generated description stays within. */
export const DESCRIPTION_MIN = 80;
export const DESCRIPTION_MAX = 160;

/**
 * Site-wide fallback description (`root.tsx` default OG and the `WebSite`
 * JSON-LD). Deliberately number-free so it never goes stale.
 */
export const SITE_DESCRIPTION =
  '血族资源站是《血族》非官方玩家资料站，整理卡片图标、属性、阵营与职业数据，提供可拖拽排序的 Tier Maker 节奏榜、数据 JSON / CSV 端点、榜单文件格式说明与版本笔记。';

/** Home page: same idea as `SITE_DESCRIPTION`, with the current data counts. */
export function homeDescription(input: {
  cardCount: number;
  characterCount: number;
}): string {
  return (
    `血族资源站是《血族》非官方玩家资料站，收录 ${String(input.cardCount)} 张卡片（含皮肤）` +
    `与 ${String(input.characterCount)} 位角色的图标、属性、阵营和职业数据，可以筛选查卡、` +
    '拖拽生成 Tier Maker 节奏榜，并下载 JSON / CSV 数据端点。'
  );
}

/** `/tier` — what the board does, and where the data lives. */
export const TIER_DESCRIPTION =
  '把《血族》全部卡片拖进 S、A、B、C、D、F 等档位，自由增删档位、重命名与换色，随时保存快照、导入导出 JSON 或导出 PNG；所有改动只保存在本机浏览器，不会上传服务器。';

/** `/blog` — the three content families the list currently contains. */
export const BLOG_DESCRIPTION =
  '血族资源站的博客栏目：节奏榜的拖拽、快照、导入导出与 PNG 使用说明，卡片数据字段解释与数据端点速查，以及《血族》各版本的节奏变化、活动观察与数据维护记录，全部静态生成。';

/** `/blog/tag/:tag` — the title form is「标签：X」, so the text names the tag too. */
export function tagDescription(tag: string, count: number): string {
  return (
    `血族资源站「${tag}」标签下共有 ${String(count)} 篇文章，` +
    '涵盖节奏榜用法、卡片数据字段与版本笔记等内容，可逐篇阅读全文，也可以直接获取每篇文章的原文 Markdown，便于离线阅读与引用。'
  );
}

const POST_DESCRIPTION_SUFFIX =
  '属于血族资源站的版本笔记与数据说明，提供原文 Markdown 与卡片数据端点，便于引用与二次加工。';

const POST_DESCRIPTION_PADDING = '更多《血族》卡片数据与节奏榜说明见血族资源站首页。';

/** Cut on a character boundary and keep the ellipsis inside the limit. */
export function clampDescription(text: string, max: number = DESCRIPTION_MAX): string {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

/**
 * Article description: the authored summary plus the reading time and the
 * publishing context, clamped to `DESCRIPTION_MAX`. OG/Twitter still use the
 * bare summary (see the route `handle`), which stays quotable.
 */
export function postDescription(post: Pick<Post, 'summary' | 'readingMinutes'>): string {
  let text = `${post.summary}本文约 ${String(post.readingMinutes)} 分钟读完，${POST_DESCRIPTION_SUFFIX}`;

  if (text.length < DESCRIPTION_MIN) {
    text = `${text}${POST_DESCRIPTION_PADDING}`;
  }

  return clampDescription(text);
}
