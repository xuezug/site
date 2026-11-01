import type { Route } from './+types/blog-list';
import posts from 'virtual:blog-posts';
import { PostList } from '../components/blog/PostList';
import type { RouteHandle } from '../lib/seo/head';
import { BLOG_DESCRIPTION, SITE_NAME } from '../lib/seo/meta';

/** `<SiteHead />` reads the deepest `handle.og` instead of site defaults. */
export const handle: RouteHandle = {
  og: {
    title: '博客',
    description: BLOG_DESCRIPTION,
    type: 'website',
  },
};

export function meta(_args: Route.MetaArgs) {
  return [
    { title: `博客 · ${SITE_NAME}` },
    { name: 'description', content: BLOG_DESCRIPTION },
  ];
}

export default function BlogList() {
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">博客</h1>
        <p className="max-w-2xl text-sm leading-relaxed text-[var(--bl-muted)]">
          节奏榜用法、卡片数据说明与版本笔记，按发布时间排列。
        </p>
      </header>

      <PostList posts={posts} />
    </div>
  );
}
