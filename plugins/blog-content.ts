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

/** A local image referenced by a post, copied next to the prerendered page. */
export type PostAsset = {
  /** Absolute path on disk. */
  sourcePath: string;
  /** POSIX path relative to the post folder, e.g. `images/cover.png`. */
  relativePath: string;
  /** Output path relative to the site root, e.g. `blog/tier-guide/cover.png`. */
  outputPath: string;
  /** Root-relative URL path, e.g. `/blog/tier-guide/cover.png`. */
  url: string;
};

export type LoadPostsResult = {
  posts: Post[];
  assets: PostAsset[];
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

/** File/folder name without the optional `oc-YYMMDD-` prefix. */
function slugFromName(filePath: string, name: string, kind: 'file' | 'folder'): string {
  const candidate = name.replace(FILE_DATE_PREFIX, '');

  if (!SLUG_PATTERN.test(candidate)) {
    throw new Error(
      `${filePath}: cannot derive an ASCII slug from "${name}"; ` +
        `rename the ${kind} or add an explicit "slug" to the frontmatter`,
    );
  }

  return candidate;
}

type PostSource = {
  filePath: string;
  /** Folder that owns relative image assets; null for legacy flat posts. */
  assetDir: string | null;
  /**
   * Slug derived from the file or folder name. Lazy because an explicit
   * frontmatter `slug` must allow non-ASCII file names.
   */
  defaultSlug: () => string;
};

/**
 * Two layouts are accepted:
 * - `content/blog/<slug>/index.md` plus images next to it (preferred);
 * - `content/blog/<slug>.md` for posts without local images (legacy).
 *
 * Top-level directories without `index.md` are ignored, and directories
 * starting with `_` are reserved (shared assets, scratch notes).
 */
function listPostSources(dir: string): PostSource[] {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    return [];
  }

  const entries = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => !entry.name.startsWith('.'))
    .sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));

  const sources: PostSource[] = [];
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);

    if (entry.isFile() && /\.md$/i.test(entry.name)) {
      sources.push({
        filePath: entryPath,
        assetDir: null,
        defaultSlug: () => slugFromName(entryPath, entry.name.replace(/\.md$/i, ''), 'file'),
      });
      continue;
    }

    if (!entry.isDirectory() || entry.name.startsWith('_')) {
      continue;
    }

    const indexFile = path.join(entryPath, 'index.md');
    if (!existsSync(indexFile) || !statSync(indexFile).isFile()) {
      // Not a post folder (shared assets, leftovers, …).
      continue;
    }

    sources.push({
      filePath: indexFile,
      assetDir: entryPath,
      defaultSlug: () => slugFromName(indexFile, entry.name, 'folder'),
    });
  }

  return sources;
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

type AssetContext = {
  filePath: string;
  slug: string;
  assetDir: string | null;
  siteUrl: string;
  assets: Map<string, PostAsset>;
  /** Original Markdown URL → absolute URL, used to rewrite `post.source`. */
  rewrites: Map<string, string>;
};

type MdastNode = {
  type: string;
  url?: string;
  identifier?: string;
  children?: MdastNode[];
};

function visitMdast(node: MdastNode, visit: (node: MdastNode) => void): void {
  visit(node);
  for (const child of node.children ?? []) {
    visitMdast(child, visit);
  }
}

/** `./cover.png` and `images/a b.png`; not `/root.png`, `#frag` or a scheme. */
function isRelativeImageTarget(url: string): boolean {
  const value = url.trim();
  if (value === '' || value.startsWith('/') || value.startsWith('#') || value.startsWith('?')) {
    return false;
  }
  // `data:`, `https:`, `mailto:`, … plus Windows drive letters (C:\…).
  return !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value);
}

function splitUrlSuffix(url: string): { pathPart: string; suffix: string } {
  const index = url.search(/[?#]/);
  return index === -1
    ? { pathPart: url, suffix: '' }
    : { pathPart: url.slice(0, index), suffix: url.slice(index) };
}

function encodeRelativePath(relativePath: string): string {
  return relativePath.split('/').map(encodeURIComponent).join('/');
}

/**
 * Resolve a relative image against the post folder, register it for copying
 * and return the URL used in HTML (`/blog/<slug>/…`).
 *
 * Referencing a missing file or escaping the post folder fails the build, so a
 * typo cannot silently ship a broken image.
 */
function resolveImageAsset(target: string, context: AssetContext): { url: string; absoluteUrl: string } {
  if (context.assetDir === null) {
    throw new Error(
      `${context.filePath}: relative image "${target}" requires the post to live in ` +
        'content/blog/<slug>/index.md; move the Markdown file into its own folder',
    );
  }

  const { pathPart, suffix } = splitUrlSuffix(target.trim());
  if (pathPart === '') {
    throw new Error(`${context.filePath}: image "${target}" has no file name`);
  }

  const normalized = pathPart.replace(/\\/g, '/');
  const resolved = path.resolve(context.assetDir, normalized);
  const relative = path.relative(context.assetDir, resolved);

  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`${context.filePath}: image "${target}" points outside the post folder`);
  }
  if (!existsSync(resolved) || !statSync(resolved).isFile()) {
    throw new Error(`${context.filePath}: image "${target}" not found (expected ${resolved})`);
  }

  const relativePath = relative.split(path.sep).join('/');
  const url = `/blog/${context.slug}/${encodeRelativePath(relativePath)}`;
  const outputPath = `blog/${context.slug}/${relativePath}`;

  context.assets.set(outputPath, {
    sourcePath: resolved,
    relativePath,
    outputPath,
    url,
  });

  return { url: `${url}${suffix}`, absoluteUrl: `${context.siteUrl}${url}${suffix}` };
}

/**
 * Rewrite `image` nodes (and definitions used by `imageReference` nodes) before
 * `remark-rehype` turns them into `<img src>`. Code blocks are not touched
 * because only image AST nodes are visited.
 */
function rewriteRelativeImages(context: AssetContext) {
  return (tree: MdastNode): void => {
    const imageReferences = new Set<string>();
    visitMdast(tree, (node) => {
      if (node.type === 'imageReference' && typeof node.identifier === 'string') {
        imageReferences.add(node.identifier);
      }
    });

    visitMdast(tree, (node) => {
      const isImage = node.type === 'image';
      const isImageDefinition =
        node.type === 'definition' &&
        typeof node.identifier === 'string' &&
        imageReferences.has(node.identifier);

      if ((!isImage && !isImageDefinition) || typeof node.url !== 'string') {
        return;
      }
      if (!isRelativeImageTarget(node.url)) {
        return;
      }

      const original = node.url;
      const resolved = resolveImageAsset(original, context);
      node.url = resolved.url;
      context.rewrites.set(original, resolved.absoluteUrl);
    });
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Raw Markdown is served at `/blog/<slug>.md`, where relative image paths would
 * resolve against `/blog/` instead of the post folder. Point them at the
 * absolute asset URL so agents and `llms-full.txt` readers can fetch them.
 *
 * Only URLs actually parsed as images appear in `rewrites`, so identical text
 * inside a code block is left alone unless the same target is also a real
 * image elsewhere in the post.
 */
function rewriteImageUrlsInSource(
  source: string,
  rewrites: ReadonlyMap<string, string>,
): string {
  if (rewrites.size === 0) {
    return source;
  }

  let result = source;
  for (const [from, to] of rewrites) {
    const escaped = escapeRegExp(from);

    // Inline image: ![alt](./cover.png "title") or ![alt](<./cover.png>).
    result = result.replace(
      new RegExp(`(!\\[[^\\]]*\\]\\()<?${escaped}>?(?=[\\s)])`, 'g'),
      (_match, prefix: string) => `${prefix}${to}`,
    );

    // Reference definition used by an image: [id]: ./cover.png "title".
    result = result.replace(
      new RegExp(
        `(^\\s*\\[[^\\]]+\\]:[ \\t]*)<?${escaped}>?(?=[ \\t]*(?:$|["']))`,
        'gm',
      ),
      (_match, prefix: string) => `${prefix}${to}`,
    );
  }
  return result;
}

async function compileMarkdown(
  markdown: string,
  context: AssetContext,
): Promise<CompiledMarkdown> {
  const { siteUrl } = context;
  const headings: PostHeading[] = [];
  const file = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(() => rewriteRelativeImages(context))
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

/**
 * Read, validate and compile every post in `contentDir`.
 *
 * Throws on invalid frontmatter, an underivable slug, a missing local image and
 * duplicate slugs, so a broken post fails `npm run build` instead of
 * disappearing silently.
 */
export async function loadPostsWithAssets(
  options: LoadPostsOptions = {},
): Promise<LoadPostsResult> {
  const contentDir = options.contentDir ?? DEFAULT_CONTENT_DIR;
  const includeDrafts = options.includeDrafts ?? false;
  const siteUrl = normalizeSiteUrl(options.siteUrl ?? DEFAULT_SITE_URL);

  const seenSlugs = new Map<string, string>();
  const posts: Post[] = [];
  const assets = new Map<string, PostAsset>();

  for (const source of listPostSources(contentDir)) {
    const { filePath } = source;
    const raw = readFileSync(filePath, 'utf8');
    const parsed = matter(raw);
    const frontmatter = readFrontmatter(filePath, parsed.data, parsed.matter);
    const slug = frontmatter.slug ?? source.defaultSlug();

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

    const context: AssetContext = {
      filePath,
      slug,
      assetDir: source.assetDir,
      siteUrl,
      assets,
      rewrites: new Map(),
    };
    const compiled = await compileMarkdown(parsed.content, context);

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
      source: rewriteImageUrlsInSource(raw, context.rewrites),
    });
  }

  return { posts: sortPosts(posts), assets: [...assets.values()] };
}

/** Posts only; used by the Vite virtual module and the agent artifacts. */
export async function loadPosts(options: LoadPostsOptions = {}): Promise<Post[]> {
  const { posts } = await loadPostsWithAssets(options);
  return posts;
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

const CONTENT_TYPES: Record<string, string> = {
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

function contentTypeFor(filePath: string): string {
  return CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

/**
 * Exposes the compiled posts as `virtual:blog-posts` (default export).
 * Drafts stay visible in `npm run dev` and are removed from the build payload.
 *
 * Per-post images are copied to `blog/<slug>/…` in the client build and served
 * from the content folder by a small dev middleware, so `content/blog/<slug>/`
 * stays the only copy authors edit.
 */
export function blogContent(options: BlogContentPluginOptions = {}): Plugin {
  const contentDir = options.contentDir ?? DEFAULT_CONTENT_DIR;
  const siteUrl = options.siteUrl ?? DEFAULT_SITE_URL;
  let includeDrafts = false;

  let assets: PostAsset[] = [];
  let assetRoutes = new Map<string, string>();
  let assetsLoaded = false;

  async function refreshAssets(): Promise<Post[]> {
    const result = await loadPostsWithAssets({ includeDrafts, contentDir, siteUrl });
    assets = result.assets;
    assetRoutes = new Map(result.assets.map((asset) => [asset.url, asset.sourcePath]));
    assetsLoaded = true;
    return result.posts;
  }

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

      const posts = await refreshAssets();
      // JSON is valid JS; `source`/`html` are strings, so no escaping hazards.
      return `export default ${JSON.stringify(posts)};\n`;
    },

    async generateBundle() {
      const environment = this.environment;
      if (environment !== undefined && environment.name !== 'client') {
        return;
      }
      if (!assetsLoaded) {
        await refreshAssets();
      }

      for (const asset of assets) {
        this.emitFile({
          type: 'asset',
          fileName: asset.outputPath,
          source: readFileSync(asset.sourcePath),
        });
      }
    },

    configureServer(server) {
      // `.md` and image files are read through `fs`, never imported, so Vite
      // does not watch them by default.
      server.watcher.add(contentDir);

      server.middlewares.use((request, response, next) => {
        void (async () => {
          if (request.method !== 'GET' && request.method !== 'HEAD') {
            next();
            return;
          }

          const pathname = (request.url ?? '').split('?')[0] ?? '';
          if (!pathname.startsWith('/blog/')) {
            next();
            return;
          }

          let decoded: string;
          try {
            decoded = decodeURIComponent(pathname);
          } catch {
            next();
            return;
          }

          if (!assetsLoaded) {
            try {
              await refreshAssets();
            } catch (error) {
              next(error);
              return;
            }
          }

          const sourcePath = assetRoutes.get(decoded);
          if (sourcePath === undefined) {
            next();
            return;
          }

          response.statusCode = 200;
          response.setHeader('Content-Type', contentTypeFor(sourcePath));
          response.setHeader('Cache-Control', 'no-store');
          response.end(request.method === 'HEAD' ? undefined : readFileSync(sourcePath));
        })();
      });
    },

    handleHotUpdate(context) {
      if (!isInsideDir(contentDir, context.file)) {
        return;
      }

      // Images may have been added/removed; rebuild the URL → file map on the
      // next request (the full reload below re-evaluates the virtual module).
      assetsLoaded = false;

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
