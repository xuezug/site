import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveSiteUrl } from '../site-url.resolve.ts';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(rootDir, 'dist');

/** Data contract from design §8/§12: every route ships the whole catalogue. */
const EXPECTED_CARD_COUNT = 916;

/** Design §8 target for the single-file agent dump. */
const LLMS_FULL_MAX_BYTES = 400 * 1024;

/** Files this task owns; `data/*` is produced by `sync-data`. */
const ARTIFACTS = [
  'llms.txt',
  'llms-full.txt',
  'sitemap.xml',
  'robots.txt',
  'blog/index.json',
  'data/tier.schema.json',
  'data/tier-default.json',
];

function fail(message) {
  throw new Error(`[assert-build] ${message}`);
}

async function readOptional(relativePath) {
  try {
    return await readFile(path.join(distDir, relativePath), 'utf8');
  } catch {
    return null;
  }
}

async function requireNonEmpty(relativePath) {
  const filePath = path.join(distDir, relativePath);
  let stats;
  try {
    stats = await stat(filePath);
  } catch {
    fail(`dist/${relativePath} is missing; run \`npm run build\` first.`);
  }
  if (!stats.isFile() || stats.size === 0) {
    fail(`dist/${relativePath} is empty.`);
  }
  return stats.size;
}

function parseJson(relativePath, source) {
  try {
    return JSON.parse(source);
  } catch (error) {
    fail(`dist/${relativePath} is not valid JSON (${error.message}).`);
  }
}

function locsOf(sitemap) {
  return [...sitemap.matchAll(/<loc>([^<]*)<\/loc>/g)].map((match) => match[1]);
}

async function checkArtifacts(siteUrl) {
  const sizes = new Map();
  for (const relativePath of ARTIFACTS) {
    sizes.set(relativePath, await requireNonEmpty(relativePath));
  }

  if (sizes.get('llms-full.txt') > LLMS_FULL_MAX_BYTES) {
    fail(
      `dist/llms-full.txt is ${sizes.get('llms-full.txt')} bytes, over the ` +
        `${LLMS_FULL_MAX_BYTES}-byte budget.`,
    );
  }

  const robots = await readOptional('robots.txt');
  if (robots === null || !robots.includes(`Sitemap: ${siteUrl}/sitemap.xml`)) {
    fail('dist/robots.txt does not point at the sitemap URL.');
  }

  return sizes;
}

async function checkCards() {
  const source = await readOptional('data/cards.json');
  if (source === null) {
    fail('dist/data/cards.json is missing; `sync-data` did not run.');
  }

  const cards = parseJson('data/cards.json', source);
  if (!Array.isArray(cards)) {
    fail('dist/data/cards.json is not an array.');
  }
  if (cards.length !== EXPECTED_CARD_COUNT) {
    fail(
      `dist/data/cards.json has ${cards.length} records, expected ${EXPECTED_CARD_COUNT}.`,
    );
  }

  const metaSource = await readOptional('data/meta.json');
  if (metaSource === null) {
    fail('dist/data/meta.json is missing; `sync-data` did not run.');
  }
  const meta = parseJson('data/meta.json', metaSource);
  if (typeof meta?.cardCount !== 'number' || meta.cardCount !== cards.length) {
    fail(
      `dist/data/meta.json says ${String(meta?.cardCount)} cards but cards.json has ` +
        `${cards.length}; re-run \`npm run data\`.`,
    );
  }

  return cards.length;
}

async function checkBlogIndex(siteUrl) {
  const source = await readOptional('blog/index.json');
  if (source === null) {
    fail('dist/blog/index.json is missing.');
  }

  const entries = parseJson('blog/index.json', source);
  if (!Array.isArray(entries) || entries.length === 0) {
    fail('dist/blog/index.json must be a non-empty array.');
  }

  for (const entry of entries) {
    for (const key of ['slug', 'title', 'date', 'tags', 'summary', 'readingMinutes']) {
      if (entry[key] === undefined) {
        fail(`dist/blog/index.json entry "${entry.slug}" is missing "${key}".`);
      }
    }
    if (entry.url !== `${siteUrl}/blog/${entry.slug}`) {
      fail(`dist/blog/index.json has a wrong url for "${entry.slug}".`);
    }
    if (entry.markdown !== `${siteUrl}/blog/${entry.slug}.md`) {
      fail(`dist/blog/index.json has a wrong markdown url for "${entry.slug}".`);
    }
    await requireNonEmpty(`blog/${entry.slug}.md`);
  }

  return entries;
}

async function checkSitemap(siteUrl, entries) {
  const sitemap = await readOptional('sitemap.xml');
  if (sitemap === null) {
    fail('dist/sitemap.xml is missing.');
  }
  if (!sitemap.startsWith('<?xml version="1.0" encoding="UTF-8"?>')) {
    fail('dist/sitemap.xml is missing the XML declaration.');
  }

  const locs = locsOf(sitemap);
  if (locs.length === 0) {
    fail('dist/sitemap.xml contains no <loc> entries.');
  }

  for (const loc of locs) {
    if (!loc.startsWith(`${siteUrl}/`) && loc !== siteUrl) {
      fail(`dist/sitemap.xml has a loc outside SITE_URL: ${loc}`);
    }
    if (loc.includes('/404') || loc.includes('__spa-fallback')) {
      fail(`dist/sitemap.xml must not list ${loc}.`);
    }
  }

  const set = new Set(locs);
  for (const required of ['', '/tier', '/blog']) {
    const url = `${siteUrl}${required}`;
    if (!set.has(url)) {
      fail(`dist/sitemap.xml is missing ${url}.`);
    }
  }

  const tags = new Set(entries.flatMap((entry) => entry.tags));
  for (const entry of entries) {
    const url = `${siteUrl}/blog/${entry.slug}`;
    if (!set.has(url)) {
      fail(`dist/sitemap.xml is missing the article ${url}.`);
    }
  }
  for (const tag of tags) {
    const url = `${siteUrl}/blog/tag/${encodeURIComponent(tag)}`;
    if (!set.has(url)) {
      fail(`dist/sitemap.xml is missing the tag page ${url}.`);
    }
  }

  return { locs: locs.length, tags: tags.size, posts: entries.length };
}

async function checkLlmsTxt(siteUrl, cardCount) {
  const llms = await readOptional('llms.txt');
  if (llms === null) {
    fail('dist/llms.txt is missing.');
  }

  const required = [
    '/data/cards.json',
    '/data/cards.csv',
    '/data/taxonomy.json',
    '/data/meta.json',
    '/data/tier.schema.json',
    '/data/tier-default.json',
    '/blog/index.json',
    '/llms-full.txt',
  ];
  for (const endpoint of required) {
    if (!llms.includes(`${siteUrl}${endpoint}`)) {
      fail(`dist/llms.txt does not link ${endpoint} as an absolute URL.`);
    }
  }
  if (!llms.includes(String(cardCount))) {
    fail('dist/llms.txt does not mention the card count.');
  }
  for (const placeholder of ['TODO', '建设中']) {
    if (llms.includes(placeholder)) {
      fail(`dist/llms.txt still contains the placeholder "${placeholder}".`);
    }
  }
}

async function checkPrerenderedPages(entries) {
  const home = await readOptional('index.html');
  if (home === null) {
    fail('dist/index.html is missing.');
  }
  for (const type of ['WebPage', 'Dataset']) {
    if (!home.includes(`"@type":"${type}"`)) {
      fail(`dist/index.html has no ${type} JSON-LD.`);
    }
  }

  const tier = await readOptional(path.join('tier', 'index.html'));
  if (tier === null) {
    fail('dist/tier/index.html is missing.');
  }
  const images = (tier.match(/<img\b/g) ?? []).length;
  if (images !== EXPECTED_CARD_COUNT) {
    fail(`dist/tier/index.html renders ${images} <img> tags, expected ${EXPECTED_CARD_COUNT}.`);
  }

  for (const entry of entries) {
    const html = await readOptional(path.join('blog', entry.slug, 'index.html'));
    if (html === null) {
      fail(`dist/blog/${entry.slug}/index.html is missing.`);
    }
    if (!html.includes('application/ld+json') || !html.includes('BlogPosting')) {
      fail(`dist/blog/${entry.slug}/index.html has no BlogPosting JSON-LD.`);
    }
    if (!/rel="alternate"[^>]*text\/markdown/.test(html)) {
      fail(`dist/blog/${entry.slug}/index.html has no Markdown alternate link.`);
    }
    for (const tag of entry.tags) {
      await requireNonEmpty(path.join('blog', 'tag', tag, 'index.html'));
    }
  }

  return images;
}

async function main() {
  const { siteUrl, source } = resolveSiteUrl('production', process.env);

  let html;
  try {
    html = await readFile(path.join(distDir, 'index.html'), 'utf8');
  } catch {
    throw new Error('[assert-build] dist/index.html is missing; run `npm run build` first.');
  }

  const ogUrl = html.match(/<meta property="og:url" content="([^"]+)"/)?.[1];
  if (!ogUrl) {
    throw new Error('[assert-build] dist/index.html has no og:url meta tag.');
  }
  if (ogUrl !== siteUrl) {
    throw new Error(
      `[assert-build] prerendered og:url is "${ogUrl}" but SITE_URL resolves to ` +
        `"${siteUrl}" (source: ${source}). Check the define in vite.config.ts.`,
    );
  }

  const notFound = await readFile(path.join(distDir, '404.html'), 'utf8').catch(() => '');
  if (!notFound.includes('<h1')) {
    throw new Error('[assert-build] dist/404.html is missing or empty.');
  }

  const sizes = await checkArtifacts(siteUrl);
  const cardCount = await checkCards();
  const entries = await checkBlogIndex(siteUrl);
  const sitemap = await checkSitemap(siteUrl, entries);
  await checkLlmsTxt(siteUrl, cardCount);
  const images = await checkPrerenderedPages(entries);

  console.log(
    `[assert-build] dist/index.html og:url = ${ogUrl} (source: ${source}); ` +
      'dist/404.html is prerendered.',
  );
  console.log(
    `[assert-build] ${String(ARTIFACTS.length)} artifacts, ${String(cardCount)} cards, ` +
      `${String(images)} tier images, sitemap: ${String(sitemap.locs)} urls ` +
      `(${String(sitemap.posts)} posts / ${String(sitemap.tags)} tags); ` +
      `llms-full.txt = ${String(sizes.get('llms-full.txt'))} bytes.`,
  );
}

await main();
