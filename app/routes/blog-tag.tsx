import { Link, useParams } from 'react-router';
import type { Route } from './+types/blog-tag';
import posts from 'virtual:blog-posts';
import { PostList } from '../components/blog/PostList';
import { findTag, postsByTag, type TagSummary } from '../lib/blog/content';
import type { RouteHandle } from '../lib/seo/head';
import { SITE_NAME, tagDescription } from '../lib/seo/meta';

function decodeTag(value: string | undefined): string {
  if (value === undefined) {
    return '';
  }
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function describeTag(tag: TagSummary): string {
  return tagDescription(tag.tag, tag.count);
}

/** Deepest `handle.og` wins over the site defaults in `<SiteHead />`. */
export const handle: RouteHandle = {
  og: (params) => {
    const tag = findTag(posts, params.tag ?? '');
    if (tag === null) {
      return {
        title: '标签不存在',
        description: '没有该标签的文章。',
        type: 'website',
      };
    }

    return { title: `标签：${tag.tag}`, description: describeTag(tag), type: 'website' };
  },
};

export function meta({ params }: Route.MetaArgs) {
  const tag = findTag(posts, params.tag ?? '');

  if (tag === null) {
    return [
      { title: `标签不存在 · ${SITE_NAME}` },
      // Unknown tags are reachable in development only; keep them out of indexes.
      { name: 'robots', content: 'noindex' },
    ];
  }

  return [
    { title: `标签：${tag.tag} · ${SITE_NAME}` },
    { name: 'description', content: describeTag(tag) },
  ];
}

export default function BlogTag() {
  const { tag: rawTag } = useParams();
  const tag = findTag(posts, rawTag ?? '');
  const displayTag = tag?.tag ?? decodeTag(rawTag);

  if (tag === null) {
    return (
      <div className="flex max-w-xl flex-col items-start gap-4 py-6">
        <h1 className="text-3xl font-bold tracking-tight">标签：{displayTag}</h1>
        <p className="text-sm leading-relaxed text-[var(--bl-muted)]">没有该标签的文章。</p>
        <Link
          to="/blog"
          className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[color:var(--bl-border-strong)] px-4 text-sm font-medium text-[var(--bl-text)] transition-colors hover:bg-[var(--bl-panel-hover)]"
        >
          返回博客列表
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">标签：{tag.tag}</h1>
        <p className="text-sm text-[var(--bl-muted)]">{`共 ${tag.count} 篇文章`}</p>
      </header>

      <PostList posts={postsByTag(posts, tag.tag)} emptyText="暂无文章" />
    </div>
  );
}
