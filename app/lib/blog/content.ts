/**
 * Blog content types and pure helpers.
 *
 * This module is imported by both the client bundle and Node-side build code
 * (`plugins/blog-content.ts`, `react-router.config.ts`), so it must stay free
 * of React, DOM and `fs` imports. Post data itself comes from the
 * `virtual:blog-posts` module built by the Vite plugin.
 */

export type PostHeading = {
  /** HTML anchor id generated at build time by `rehype-slug`. */
  id: string;
  text: string;
  level: 2 | 3;
};

export type Post = {
  slug: string;
  title: string;
  /** `YYYY-MM-DD`, from the frontmatter. */
  date: string;
  /** `YYYY-MM-DD`; absent unless the author edited the post. */
  updated?: string;
  tags: string[];
  summary: string;
  draft: boolean;
  /**
   * HTML rendered at build time. Raw HTML nodes are dropped by
   * `remark-rehype` (no `allowDangerousHtml`), and the pipeline's final rehype
   * pass strips `href`/`src` values with protocols other than `http(s)` or
   * `mailto:` (the installed `mdast-util-to-hast` v11 does not do that itself).
   * Content is still repo-authored, like any static site.
   */
  html: string;
  /** `h2`/`h3` entries in document order. */
  headings: PostHeading[];
  /** Chinese 400 chars/min + English 200 words/min, rounded up, minimum 1. */
  readingMinutes: number;
  /** Raw Markdown (frontmatter included), emitted as `/blog/<slug>.md` later. */
  source: string;
};

export type TagSummary = {
  tag: string;
  /** `encodeURIComponent(tag)`; used for both the URL and the canonical path. */
  slug: string;
  count: number;
};

/** `/blog/<slug>`; the slug is already URL-safe ASCII. */
export function postHref(slug: string): string {
  return `/blog/${slug}`;
}

/** URL (and canonical) form of a tag. Non-ASCII tags stay percent-encoded. */
export function tagSlug(tag: string): string {
  return encodeURIComponent(tag);
}

/** `/blog/tag/<encoded>`; links and prerender paths share this one helper. */
export function tagHref(tag: string): string {
  return `/blog/tag/${tagSlug(tag)}`;
}

export function postTagSlugs(post: Post): string[] {
  return post.tags.map(tagSlug);
}

/**
 * Newest first; equal dates fall back to the slug so the list, the JSON index
 * and the prerender order are stable across machines.
 */
export function sortPosts(posts: readonly Post[]): Post[] {
  return [...posts].sort((left, right) => {
    if (left.date !== right.date) {
      return left.date < right.date ? 1 : -1;
    }
    if (left.slug === right.slug) {
      return 0;
    }
    return left.slug < right.slug ? -1 : 1;
  });
}

/** Every tag used by `posts`, with post counts, ordered by tag code point. */
export function collectTags(posts: readonly Post[]): TagSummary[] {
  const counts = new Map<string, number>();
  for (const post of posts) {
    for (const tag of post.tags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .map(([tag, count]): TagSummary => ({ tag, slug: tagSlug(tag), count }))
    .sort((left, right) => (left.tag < right.tag ? -1 : left.tag > right.tag ? 1 : 0));
}

export function findPostBySlug(posts: readonly Post[], slug: string): Post | undefined {
  return posts.find((post) => post.slug === slug);
}

export function postsByTag(posts: readonly Post[], tag: string): Post[] {
  return sortPosts(posts.filter((post) => post.tags.includes(tag)));
}

function decodePathSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    // A malformed `%` sequence is not a valid tag; fall back to the raw value.
    return value;
  }
}

/**
 * Resolve a route param to a known tag. React Router already decodes params,
 * but prerendered URLs are percent-encoded, so accept the encoded form too.
 */
export function findTag(posts: readonly Post[], value: string): TagSummary | null {
  const tags = collectTags(posts);
  const decoded = decodePathSegment(value);

  return (
    tags.find((tag) => tag.slug === value) ??
    tags.find((tag) => tag.tag === decoded) ??
    tags.find((tag) => tag.tag === value) ??
    null
  );
}

export type AdjacentPosts = {
  /** Chronologically newer post (「上一篇」), or `null` for the newest. */
  newer: Post | null;
  /** Chronologically older post (「下一篇」), or `null` for the oldest. */
  older: Post | null;
};

/** A TOC only helps once there are this many `h2` sections. */
export const TOC_MIN_H2 = 3;

export function hasToc(headings: readonly PostHeading[]): boolean {
  return headings.filter((heading) => heading.level === 2).length >= TOC_MIN_H2;
}

export function adjacentPosts(posts: readonly Post[], slug: string): AdjacentPosts {
  const sorted = sortPosts(posts);
  const index = sorted.findIndex((post) => post.slug === slug);

  if (index === -1) {
    return { newer: null, older: null };
  }

  return {
    newer: index > 0 ? (sorted[index - 1] ?? null) : null,
    older: index < sorted.length - 1 ? (sorted[index + 1] ?? null) : null,
  };
}
