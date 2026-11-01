/**
 * Blog Markdown pipeline (design §7).
 *
 * `content/blog/**\/*.md` is compiled at build time into a `Post[]` payload that
 * the client imports as `virtual:blog-posts`. The same `loadPosts()` helper is
 * reused by `react-router.config.ts` to enumerate prerender paths, so the
 * content is parsed in exactly one place.
 *
 * The plugin never ships Shiki, unified or `fs` to the browser: only the
 * already-rendered HTML and metadata cross the virtual-module boundary. In
 * development the module is invalidated whenever a content file changes.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import rehypeAutolinkHeadings from 'rehype-autolink-headings';
import rehypePrettyCode from 'rehype-pretty-code';
import rehypeSlug from 'rehype-slug';
import rehypeStringify from 'rehype-stringify';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';
import type { Element, ElementContent, Root, Text } from 'hast';
import type { Plugin } from 'vite';
import { sortPosts, type Post, type PostHeading } from '../app/lib/blog/content';

export const BLOG_VIRTUAL_MODULE_ID = 'virtual:blog-posts';

const RESOLVED_VIRTUAL_MODULE_ID = `\0${BLOG_VIRTUAL_MODULE_ID}`;

/** Matches the SITE_URL fallback used by `site-url.resolve.ts`. */
const DEFAULT_SITE_URL = 'https://bl.cracklewis.site';

const SLUG_PATTERN = /^[a-z0-9-]+$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
/** Optional date prefix on content file names, e.g. `oc-261101-guide.md`. */
const FILE_DATE_PREFIX = /^oc-\d{6}-/;

/**
 * `site/content/blog` relative to the project root. Resolved lazily (not from
 * `import.meta.url`) so Vite's config bundler and Vitest agree on the path.
 */
export const DEFAULT_CONTENT_DIR = path.resolve(process.cwd(), 'content', 'blog');

export type LoadPostsOptions = {
  /** Include `draft: true` posts. The Vite plugin enables this outside production. */
  includeDrafts?: boolean;
  /** Override the content directory (used by tests with a temp dir). */
  contentDir?: string;
  /**
   * Absolute site URL; links pointing at it keep opening in the same tab, all
   * other `http(s)` links get `target="_blank" rel="noreferrer"`.
   */
  siteUrl?: string;
};

type Frontmatter = {
  title: string;
  date: string;
  updated?: string;
  tags: string[];
  summary: string;
  slug?: string;
  draft: boolean;
};

type CompiledMarkdown = {
  html: string;
  headings: PostHeading[];
};

/* -------------------------------------------------------------------------- */
/* Frontmatter                                                                */
/* -------------------------------------------------------------------------- */

function readString(
  filePath: string,
  data: Record<string, unknown>,
  key: string,
  required: true,
): string;
function readString(
  filePath: string,
  data: Record<string, unknown>,
  key: string,
  required: false,
): string | undefined;
function readString(
  filePath: string,
  data: Record<string, unknown>,
  key: string,
  required: boolean,
): string | undefined {
  const value = data[key];

  if (value === undefined || value === null) {
    if (required) {
      throw new Error(`${filePath}: frontmatter "${key}" is required`);
    }
    return undefined;
  }

  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${filePath}: frontmatter "${key}" must be a non-empty string`);
  }

  return value.trim();
}

function assertDate(filePath: string, key: string, value: string): void {
  if (!DATE_PATTERN.test(value)) {
    throw new Error(`${filePath}: frontmatter "${key}" must use YYYY-MM-DD, got "${value}"`);
  }

  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`${filePath}: frontmatter "${key}" is not a real calendar date: "${value}"`);
  }
}

/**
 * Literal text of one frontmatter line. Needed because YAML turns an unquoted
 * `2026-02-30` into a `Date` — and silently rolls it over to March 2 — so the
 * original spelling is the only way to reject impossible dates.
 */
function rawFrontmatterValue(rawMatter: string, key: string): string | undefined {
  const match = new RegExp(`^${key}:[ \\t]*(.*)$`, 'm').exec(rawMatter);
  const value = (match?.[1] ?? '').trim().replace(/^['"]|['"]$/g, '');
  return value === '' ? undefined : value;
}

/**
 * `date`/`updated` as a `YYYY-MM-DD` string. YAML turns an unquoted ISO date
 * into a `Date` (UTC midnight), so both forms are accepted and normalised.
 */
function readDate(
  filePath: string,
  data: Record<string, unknown>,
  rawMatter: string,
  key: string,
  required: true,
): string;
function readDate(
  filePath: string,
  data: Record<string, unknown>,
  rawMatter: string,
  key: string,
  required: false,
): string | undefined;
function readDate(
  filePath: string,
  data: Record<string, unknown>,
  rawMatter: string,
  key: string,
  required: boolean,
): string | undefined {
  const value = data[key];

  if (value === undefined || value === null) {
    if (required) {
      throw new Error(`${filePath}: frontmatter "${key}" is required`);
    }
    return undefined;
  }

  let date: string;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new Error(`${filePath}: frontmatter "${key}" is not a valid date`);
    }
    // Prefer the literal text so an impossible date cannot be silently fixed.
    date = rawFrontmatterValue(rawMatter, key) ?? value.toISOString().slice(0, 10);
  } else if (typeof value === 'string' && value.trim() !== '') {
    date = value.trim();
  } else {
    throw new Error(`${filePath}: frontmatter "${key}" must be a YYYY-MM-DD string`);
  }

  assertDate(filePath, key, date);
  return date;
}

/** Characters that would break a prerender path or its encoded URL. */
const INVALID_TAG_CHARS = /[/?#%\\]/;

function readTags(filePath: string, data: Record<string, unknown>): string[] {
  const value = data.tags;

  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`${filePath}: frontmatter "tags" must be an array of strings`);
  }

  const tags: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string' || entry.trim() === '') {
      throw new Error(`${filePath}: frontmatter "tags" must contain non-empty strings`);
    }
    const tag = entry.trim();
    if (INVALID_TAG_CHARS.test(tag)) {
      throw new Error(
        `${filePath}: frontmatter tag "${tag}" must not contain "/", "?", "#", "%" or a ` +
          'backslash; those characters break the tag URL and its prerender path',
      );
    }
    // Keep author order, drop accidental repetitions.
    if (!tags.includes(tag)) {
      tags.push(tag);
    }
  }

  return tags;
}

function readFrontmatter(filePath: string, rawData: unknown, rawMatter: string): Frontmatter {
  if (typeof rawData !== 'object' || rawData === null || Array.isArray(rawData)) {
    throw new Error(`${filePath}: frontmatter must be a YAML mapping`);
  }
  const data = rawData as Record<string, unknown>;

  const title = readString(filePath, data, 'title', true);
  const date = readDate(filePath, data, rawMatter, 'date', true);

  const updated = readDate(filePath, data, rawMatter, 'updated', false);

  const summary = readString(filePath, data, 'summary', true);

  const slug = readString(filePath, data, 'slug', false);
  if (slug !== undefined && !SLUG_PATTERN.test(slug)) {
    throw new Error(
      `${filePath}: frontmatter "slug" must match [a-z0-9-]+, got "${slug}"`,
    );
  }

  const rawDraft = data.draft;
  if (rawDraft !== undefined && rawDraft !== null && typeof rawDraft !== 'boolean') {
    throw new Error(`${filePath}: frontmatter "draft" must be a boolean`);
  }

  return {
    title,
    date,
    ...(updated === undefined ? {} : { updated }),
    tags: readTags(filePath, data),
    summary,
    ...(slug === undefined ? {} : { slug }),
    draft: rawDraft === true,
  };
}

/** File name without `.md` and the optional `oc-YYMMDD-` prefix. */
function slugFromFilename(filePath: string): string {
  const base = path.basename(filePath).replace(/\.md$/i, '');
  const candidate = base.replace(FILE_DATE_PREFIX, '');

  if (!SLUG_PATTERN.test(candidate)) {
    throw new Error(
      `${filePath}: cannot derive an ASCII slug from "${base}"; ` +
        'rename the file or add an explicit "slug" to the frontmatter',
    );
  }

  return candidate;
}

/* -------------------------------------------------------------------------- */
/* Reading time                                                               */
/* -------------------------------------------------------------------------- */

const CJK_PATTERN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g;
const LATIN_WORD_PATTERN = /[A-Za-z]+(?:['’-][A-Za-z]+)*/g;

/**
 * Chinese is counted per character (400/min), other text per Latin word
 * (200/min). The two rates are added, then rounded up — 400 CJK characters is
 * exactly one minute, 401 needs two.
 */
export function estimateReadingMinutes(markdown: string): number {
  const cjkCount = markdown.match(CJK_PATTERN)?.length ?? 0;
  const wordCount = markdown.match(LATIN_WORD_PATTERN)?.length ?? 0;

  return Math.max(1, Math.ceil(cjkCount / 400 + wordCount / 200));
}

/* -------------------------------------------------------------------------- */
/* Markdown → HTML                                                            */
/* -------------------------------------------------------------------------- */

function textContent(node: Element | Text | Root): string {
  if (node.type === 'text') {
    return node.value;
  }
  if (!('children' in node)) {
    return '';
  }
  return node.children.map((child) => textContent(child as Element | Text)).join('');
}

function walkElement(node: Element | Root, visit: (element: Element) => void): void {
  for (const child of node.children) {
    if (child.type !== 'element') {
      continue;
    }
    visit(child);
    walkElement(child, visit);
  }
}

/** Collect `h2`/`h3` (with their `rehype-slug` ids) before anchors are added. */
function collectHeadings(store: PostHeading[]) {
  return (tree: Root): void => {
    walkElement(tree, (element) => {
      if (element.tagName !== 'h2' && element.tagName !== 'h3') {
        return;
      }
      const id = element.properties.id;
      if (typeof id !== 'string' || id === '') {
        return;
      }
      const text = textContent(element).trim();
      if (text === '') {
        return;
      }
      store.push({ id, text, level: element.tagName === 'h2' ? 2 : 3 });
    });
  };
}

function anchorContent(): ElementContent {
  return {
    type: 'element',
    tagName: 'span',
    properties: { className: ['bl-heading-anchor-mark'] },
    children: [{ type: 'text', value: '#' }],
  };
}

function normalizeSiteUrl(siteUrl: string): string {
  return siteUrl.replace(/\/+$/, '');
}

/** `http(s)`, `mailto`, and site-relative URLs; everything else is unsafe. */
function isSafeUrl(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed === '') {
    return true;
  }
  if (
    trimmed.startsWith('/') ||
    trimmed.startsWith('#') ||
    trimmed.startsWith('./') ||
    trimmed.startsWith('../') ||
    trimmed.startsWith('?')
  ) {
    return true;
  }

  // A scheme-looking prefix that `URL` cannot parse is still suspicious.
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) {
    try {
      const { protocol } = new URL(trimmed);
      return protocol === 'http:' || protocol === 'https:' || protocol === 'mailto:';
    } catch {
      return false;
    }
  }

  // No scheme: a plain relative path.
  return true;
}

/**
 * Drop `href`/`src` values with unsafe protocols (`javascript:`, `data:`, …).
 *
 * `remark-rehype` already discards raw HTML, but the installed
 * `mdast-util-to-hast` v11 does not sanitise URL protocols, so this local pass
 * is the sanitizer boundary for author-written links and images.
 */
function sanitizeUrls() {
  return (tree: Root): void => {
    walkElement(tree, (element) => {
      if (element.tagName !== 'a' && element.tagName !== 'img') {
        return;
      }
      const key = element.tagName === 'a' ? 'href' : 'src';
      const value = element.properties[key];
      if (typeof value === 'string' && !isSafeUrl(value)) {
        delete element.properties[key];
      }
    });
  };
}

/** Add `target="_blank" rel="noreferrer"` to links that leave the site. */
function externalLinks(options: { siteUrl: string }) {
  const siteUrl = normalizeSiteUrl(options.siteUrl);

  return (tree: Root): void => {
    walkElement(tree, (element) => {
      if (element.tagName !== 'a') {
        return;
      }
      const href = element.properties.href;
      if (typeof href !== 'string' || !href.startsWith('http') || href.startsWith(siteUrl)) {
        return;
      }
      element.properties.target = '_blank';
      element.properties.rel = ['noreferrer'];
    });
  };
}

async function compileMarkdown(markdown: string, siteUrl: string): Promise<CompiledMarkdown> {
  const headings: PostHeading[] = [];
  const file = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype)
    .use(rehypeSlug)
    .use(collectHeadings, headings)
    .use(rehypeAutolinkHeadings, {
      behavior: 'append',
      properties: {
        className: ['bl-heading-anchor'],
        // hast types `aria-hidden` as the string form, not a boolean.
        ariaHidden: 'true',
        tabIndex: -1,
      },
      content: anchorContent,
    })
    .use(rehypePrettyCode, {
      // Shiki runs at build time; the stylesheet supplies the block background.
      theme: 'github-dark',
      keepBackground: false,
    })
    .use(externalLinks, { siteUrl })
    .use(sanitizeUrls)
    .use(rehypeStringify)
    .process(markdown);

  return { html: String(file), headings };
}

/* -------------------------------------------------------------------------- */
/* Loading                                                                    */
/* -------------------------------------------------------------------------- */

function listMarkdownFiles(dir: string): string[] {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    return [];
  }

  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) {
      continue;
    }
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listMarkdownFiles(entryPath));
    } else if (entry.isFile() && /\.md$/i.test(entry.name)) {
      files.push(entryPath);
    }
  }

  // Deterministic order so duplicate-slug errors and output stay stable.
  return files.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

/**
 * Read, validate and compile every Markdown file in `contentDir`.
 *
 * Throws on invalid frontmatter, an underivable slug and duplicate slugs, so a
 * broken post fails `npm run build` instead of disappearing silently.
 */
export async function loadPosts(options: LoadPostsOptions = {}): Promise<Post[]> {
  const contentDir = options.contentDir ?? DEFAULT_CONTENT_DIR;
  const includeDrafts = options.includeDrafts ?? false;
  const siteUrl = normalizeSiteUrl(options.siteUrl ?? DEFAULT_SITE_URL);

  const seenSlugs = new Map<string, string>();
  const posts: Post[] = [];

  for (const filePath of listMarkdownFiles(contentDir)) {
    const source = readFileSync(filePath, 'utf8');
    const parsed = matter(source);
    const frontmatter = readFrontmatter(filePath, parsed.data, parsed.matter);
    const slug = frontmatter.slug ?? slugFromFilename(filePath);

    const previous = seenSlugs.get(slug);
    if (previous !== undefined) {
      throw new Error(`${filePath}: duplicate slug "${slug}" (already used by ${previous})`);
    }
    seenSlugs.set(slug, filePath);

    // Drafts are still validated above (duplicate slugs must fail even in
    // development) but skipped from the production payload.
    if (frontmatter.draft && !includeDrafts) {
      continue;
    }

    const compiled = await compileMarkdown(parsed.content, siteUrl);

    posts.push({
      slug,
      title: frontmatter.title,
      date: frontmatter.date,
      ...(frontmatter.updated === undefined ? {} : { updated: frontmatter.updated }),
      tags: frontmatter.tags,
      summary: frontmatter.summary,
      draft: frontmatter.draft,
      html: compiled.html,
      headings: compiled.headings,
      readingMinutes: estimateReadingMinutes(parsed.content),
      source,
    });
  }

  return sortPosts(posts);
}

/* -------------------------------------------------------------------------- */
/* Vite plugin                                                                */
/* -------------------------------------------------------------------------- */

export type BlogContentPluginOptions = {
  contentDir?: string;
  siteUrl?: string;
};

function isInsideDir(dir: string, file: string): boolean {
  const relative = path.relative(dir, file);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

/**
 * Exposes the compiled posts as `virtual:blog-posts` (default export).
 * Drafts stay visible in `npm run dev` and are removed from the build payload.
 */
export function blogContent(options: BlogContentPluginOptions = {}): Plugin {
  const contentDir = options.contentDir ?? DEFAULT_CONTENT_DIR;
  const siteUrl = options.siteUrl ?? DEFAULT_SITE_URL;
  let includeDrafts = false;

  return {
    name: 'bl-blog-content',
    enforce: 'pre',

    configResolved(config) {
      // Production builds drop drafts; dev and tests keep them visible.
      includeDrafts = config.mode !== 'production';
    },

    resolveId(id) {
      return id === BLOG_VIRTUAL_MODULE_ID ? RESOLVED_VIRTUAL_MODULE_ID : null;
    },

    async load(id) {
      if (id !== RESOLVED_VIRTUAL_MODULE_ID) {
        return null;
      }

      const posts = await loadPosts({ includeDrafts, contentDir, siteUrl });
      // JSON is valid JS; `source`/`html` are strings, so no escaping hazards.
      return `export default ${JSON.stringify(posts)};\n`;
    },

    configureServer(server) {
      // `.md` files are read through `fs`, never imported, so Vite does not
      // watch them by default.
      server.watcher.add(contentDir);
    },

    handleHotUpdate(context) {
      if (!isInsideDir(contentDir, context.file)) {
        return;
      }

      const virtualModule = context.server.moduleGraph.getModuleById(RESOLVED_VIRTUAL_MODULE_ID);
      if (virtualModule !== undefined) {
        context.server.moduleGraph.invalidateModule(virtualModule);
      }

      // No HMR boundary in Markdown content: reload instead of propagating.
      context.server.ws.send({ type: 'full-reload' });
      return [];
    },
  };
}

export default blogContent;
