/**
 * Post-deploy verification for the live site (or a local `npm run preview`).
 *
 * It checks the surfaces Cloudflare Pages is responsible for: directory-index
 * routing (`/tier`, not `/tier/`), the real 404 document, canonical/noindex
 * handling, the agent endpoints, a raw Markdown article, and the R2 CORS header
 * that PNG export needs.
 *
 * Usage (from `site/`):
 *
 *   node scripts/verify-deploy.mjs                       # uses SITE_URL
 *   node scripts/verify-deploy.mjs --base https://bl.cracklewis.site
 *   node scripts/verify-deploy.mjs --base http://127.0.0.1:4173
 *
 * Exits 1 when any hard check fails. The icon/CORS check is a warning only:
 * a missing CORS rule degrades PNG export but does not break the site.
 */

import { resolveSiteUrl } from '../site-url.resolve.ts';

const DEFAULT_ASSET_BASE = 'https://bl-resource.cracklewis.site';
const REQUEST_TIMEOUT_MS = 15_000;

const PAGE_PATHS = ['/', '/tier', '/blog', '/blog/tier-guide'];
const CANONICAL_PATHS = ['/', '/tier', '/blog', '/blog/tier-guide'];
const TAG_PATHS = ['/blog/tag/%E6%95%B0%E6%8D%AE', '/blog/tag/数据'];
const FILE_PATHS = [
  '/data/cards.json',
  '/llms.txt',
  '/sitemap.xml',
  '/blog/tier-guide.md',
];

function parseArgs(argv) {
  const options = { base: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--base') {
      options.base = argv[index + 1] ?? null;
      index += 1;
    } else if (arg.startsWith('--base=')) {
      options.base = arg.slice('--base='.length);
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else {
      throw new Error(`未知参数：${arg}`);
    }
  }
  return options;
}

function trimBase(base) {
  return base.replace(/\/+$/, '');
}

async function request(url, init) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await globalThis.fetch(url, { ...init, signal: controller.signal, redirect: 'follow' });
  } finally {
    clearTimeout(timer);
  }
}

function hasCanonical(html) {
  return /<link rel="canonical" href="[^"]+"/.test(html);
}

function hasNoindex(html) {
  return /<meta name="robots" content="noindex"/.test(html);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log('用法：node scripts/verify-deploy.mjs [--base https://example.com]');
    return 0;
  }

  const fallback = resolveSiteUrl('production', process.env);
  const base = trimBase(options.base ?? fallback.siteUrl);
  if (options.base === null && fallback.source === 'fallback') {
    console.warn(`[verify-deploy] 未提供 --base 且 SITE_URL 未设置，使用回退值 ${base}`);
  }

  const assetBase = trimBase(
    (process.env.VITE_ASSET_BASE_URL ?? '').trim() || DEFAULT_ASSET_BASE,
  );
  const origin = new URL(base).origin;

  const failures = [];
  const warnings = [];
  let checked = 0;

  const hard = (message) => {
    failures.push(message);
    console.log(`  ✗ ${message}`);
  };
  const warn = (message) => {
    warnings.push(message);
    console.log(`  ! ${message}`);
  };
  const pass = (message) => console.log(`  ✓ ${message}`);

  async function fetchPage(pathname) {
    checked += 1;
    try {
      const response = await request(`${base}${pathname}`);
      const html = await response.text();
      return { response, html };
    } catch (error) {
      hard(`GET ${pathname} 请求失败：${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  console.log(`[verify-deploy] base = ${base}（SITE_URL 来源：${fallback.source}）`);

  // 1. Pages that must be served with a 200.
  for (const pathname of [...PAGE_PATHS, ...TAG_PATHS]) {
    const page = await fetchPage(pathname);
    if (page === null) {
      continue;
    }
    const { response, html } = page;
    if (response.status !== 200) {
      hard(`GET ${pathname} 返回 ${response.status}，期望 200`);
      continue;
    }
    if (CANONICAL_PATHS.includes(pathname) || TAG_PATHS.includes(pathname)) {
      if (hasCanonical(html)) {
        pass(`${pathname} → 200，canonical 存在`);
      } else {
        hard(`${pathname} 缺少 <link rel="canonical">`);
      }
    } else {
      pass(`${pathname} → 200`);
    }
  }

  // 2. The 404 documents must not advertise a canonical URL.
  const notFoundPage = await fetchPage('/404');
  if (notFoundPage !== null) {
    const { response, html } = notFoundPage;
    if (response.status !== 200) {
      hard(`GET /404 返回 ${response.status}，期望 200（静态 404 文档）`);
    } else if (hasCanonical(html)) {
      hard('/404 不应声明 canonical');
    } else if (!hasNoindex(html)) {
      hard('/404 缺少 robots=noindex');
    } else {
      pass('/404 → 200，无 canonical，robots=noindex');
    }
  }

  const missing = await fetchPage('/nope');
  if (missing !== null) {
    const { response, html } = missing;
    if (response.status !== 404) {
      hard(`GET /nope 返回 ${response.status}，期望 404`);
    } else if (!html.includes('页面不存在')) {
      hard('/nope 的 404 文档缺少「页面不存在」标题');
    } else if (!/<h1[^>]*>页面不存在<\/h1>/.test(html)) {
      hard('/nope 的 404 文档缺少 404 <h1>');
    } else if (hasCanonical(html)) {
      hard('/nope 不应声明 canonical');
    } else {
      pass('/nope → 404，H1 与 noindex 正确');
    }
  }

  // 3. Agent endpoints and the raw Markdown article.
  for (const pathname of FILE_PATHS) {
    checked += 1;
    try {
      const response = await request(`${base}${pathname}`);
      await response.arrayBuffer();
      if (response.status !== 200) {
        hard(`GET ${pathname} 返回 ${response.status}，期望 200`);
      } else {
        pass(`${pathname} → 200`);
      }
    } catch (error) {
      hard(`GET ${pathname} 请求失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // 4. One real icon with an Origin header: PNG export depends on this.
  checked += 1;
  let iconPath = null;
  try {
    const response = await request(`${base}/data/cards.json`);
    const cards = await response.json();
    iconPath = typeof cards?.[0]?.iconPath === 'string' ? cards[0].iconPath : null;
  } catch {
    // Keep `null`: the icon check below degrades to a warning.
  }

  if (iconPath === null) {
    warn('无法从 /data/cards.json 取到 iconPath，跳过图标 CORS 检查');
  } else {
    const iconUrl = `${assetBase}/${iconPath.replace(/^\/+/, '')}`;
    try {
      const response = await request(iconUrl, { headers: { Origin: origin } });
      await response.arrayBuffer();
      const allowOrigin = response.headers.get('access-control-allow-origin');
      if (response.status !== 200) {
        warn(`GET ${iconUrl} 返回 ${response.status}，无法验证 CORS`);
      } else if (allowOrigin === null) {
        warn(
          `图标 ${iconUrl} 没有 access-control-allow-origin 响应头；` +
            'PNG 导出会降级为占位图（需要给 R2 桶配置 CORS）。',
        );
      } else {
        pass(`图标 CORS：access-control-allow-origin=${allowOrigin}`);
      }
    } catch (error) {
      warn(
        `图标检查无法完成（${error instanceof Error ? error.message : String(error)}）：` +
          '网络不可达时跳过，不影响站点检查结果。',
      );
    }
  }

  console.log(
    `[verify-deploy] ${checked} 项检查，${failures.length} 个失败，${warnings.length} 个警告`,
  );
  if (failures.length > 0) {
    console.error('[verify-deploy] 失败：');
    for (const failure of failures) {
      console.error(`  - ${failure}`);
    }
    return 1;
  }
  return 0;
}

process.exitCode = await main().catch((error) => {
  console.error('[verify-deploy] 执行失败：', error);
  return 1;
});
