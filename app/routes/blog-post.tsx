import { Link, useParams } from 'react-router';
import type { Route } from './+types/blog-post';
import posts from 'virtual:blog-posts';
import { PostBody } from '../components/blog/PostBody';
import { TagChips } from '../components/blog/TagChips';
import { Toc } from '../components/blog/Toc';
import {
  adjacentPosts,
  findPostBySlug,
  hasToc,
  postHref,
  type Post,
} from '../lib/blog/content';
import { SITE_URL } from '../lib/env';
import type { RouteHandle } from '../lib/seo/head';
import { blogPostingJsonLd, serializeJsonLd } from '../lib/seo/jsonld';
import { postDescription, SITE_NAME } from '../lib/seo/meta';

/**
 * OG data for the article. A function is used because the title/summary depend
 * on `:slug`; `<SiteHead />` resolves it with the match params from
 * `useMatches()`, so there is still exactly one `og:title`/`og:type` in `<head>`.
 */
export const handle: RouteHandle = {
  og: (params) => {
    const post = findPostBySlug(posts, params.slug ?? '');
    if (post === undefined) {
      return {
        title: '文章不存在',
        description: '这篇文章可能已经移动或删除。',
        type: 'article',
      };
    }

    return { title: post.title, description: post.summary, type: 'article' };
  },
};

/**
 * `/blog/<slug>.md` holds the raw Markdown. React Router's framework `<Links />`
 * calls route `links` functions without arguments, so the per-post URL is
 * declared as a `tagName: 'link'` meta descriptor instead — `meta` receives the
 * route params and still lands in `<head>`.
 */
export function meta({ params }: Route.MetaArgs) {
  const post = findPostBySlug(posts, params.slug);

  if (post === undefined) {
    return [
      { title: `文章不存在 · ${SITE_NAME}` },
      { name: 'robots', content: 'noindex' },
    ];
  }

  return [
    { title: `${post.title} · ${SITE_NAME}` },
    { name: 'description', content: postDescription(post) },
    { property: 'article:published_time', content: post.date },
    {
      tagName: 'link',
      rel: 'alternate',
      type: 'text/markdown',
      href: `${postHref(post.slug)}.md`,
    },
  ];
}

function PostMeta({ post }: { post: Post }) {
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-[var(--bl-muted)]">
      <time dateTime={post.date}>{post.date}</time>
      {post.updated === undefined ? null : (
        <>
          <span aria-hidden="true">·</span>
          <span>
            更新于 <time dateTime={post.updated}>{post.updated}</time>
          </span>
        </>
      )}
      <span aria-hidden="true">·</span>
      <span>{`约 ${post.readingMinutes} 分钟`}</span>
    </p>
  );
}

function PostNav({ post }: { post: Post }) {
  const { newer, older } = adjacentPosts(posts, post.slug);

  if (newer === null && older === null) {
    return null;
  }

  return (
    <nav
      aria-label="上下篇"
      className="flex flex-col gap-2 border-t border-[color:var(--bl-border)] pt-5 sm:flex-row sm:justify-between"
    >
      {newer === null ? (
        <span />
      ) : (
        <Link
          to={postHref(newer.slug)}
          className="text-sm text-[var(--bl-accent-text)] hover:underline"
        >
          {`← 上一篇：${newer.title}`}
        </Link>
      )}
      {older === null ? (
        <span />
      ) : (
        <Link
          to={postHref(older.slug)}
          className="text-sm text-[var(--bl-accent-text)] hover:underline sm:text-right"
        >
          {`下一篇：${older.title} →`}
        </Link>
      )}
    </nav>
  );
}

function MissingPost() {
  return (
    <div className="flex max-w-xl flex-col items-start gap-4 py-6">
      <h1 className="text-3xl font-bold tracking-tight">文章不存在</h1>
      <p className="text-sm leading-relaxed text-[var(--bl-muted)]">
        这篇文章可能已经移动或删除。可以回到博客列表查看现有文章。
      </p>
      <Link
        to="/blog"
        className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[color:var(--bl-border-strong)] px-4 text-sm font-medium text-[var(--bl-text)] transition-colors hover:bg-[var(--bl-panel-hover)]"
      >
        返回博客列表
      </Link>
    </div>
  );
}

export default function BlogPost() {
  const { slug } = useParams();
  const post = slug === undefined ? undefined : findPostBySlug(posts, slug);

  if (post === undefined) {
    return <MissingPost />;
  }

  // Escaping `<` keeps arbitrary Markdown text from closing the script element.
  const jsonLd = serializeJsonLd(blogPostingJsonLd({ siteUrl: SITE_URL, post }));

  return (
    <div className="flex flex-col gap-8">
      <article className="flex flex-col gap-6">
        <header className="flex flex-col gap-3">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{post.title}</h1>
          <PostMeta post={post} />
          <TagChips tags={post.tags} />
        </header>

        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_14rem]">
          <PostBody html={post.html} />

          {hasToc(post.headings) ? (
            <aside className="hidden lg:block">
              <div className="sticky top-6">
                <Toc headings={post.headings} />
              </div>
            </aside>
          ) : null}
        </div>

        <PostNav post={post} />

        <Link
          to="/blog"
          className="w-fit text-sm font-medium text-[var(--bl-accent-text)] hover:underline"
        >
          ← 返回博客列表
        </Link>
      </article>

      <script
        type="application/ld+json"
        // Serialised from literal post metadata, with `<` escaped above.
        dangerouslySetInnerHTML={{ __html: jsonLd }}
      />
    </div>
  );
}
