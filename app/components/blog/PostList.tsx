import { Link } from 'react-router';
import { postHref, sortPosts, type Post } from '../../lib/blog/content';
import { TagChips } from './TagChips';

type PostListProps = {
  posts: readonly Post[];
  /** Empty-state copy; the tag page reuses the list with its own wording. */
  emptyText?: string;
};

/**
 * Date-descending article list (design §7): title link, date, reading time,
 * summary and tag chips per post. Ordering lives in `sortPosts` so the list,
 * the tag pages and the prerender output agree.
 */
export function PostList({ posts, emptyText = '暂无文章' }: PostListProps) {
  const sorted = sortPosts(posts);

  if (sorted.length === 0) {
    return <p className="text-sm text-[var(--bl-muted)]">{emptyText}</p>;
  }

  return (
    <ul className="flex flex-col gap-4">
      {sorted.map((post) => (
        <li key={post.slug}>
          <article className="bl-panel flex flex-col gap-3 p-5">
            <h2 className="text-xl font-semibold leading-snug">
              <Link to={postHref(post.slug)} className="hover:text-[var(--bl-accent-text)]">
                {post.title}
              </Link>
            </h2>

            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--bl-muted)]">
              <time dateTime={post.date}>{post.date}</time>
              <span aria-hidden="true">·</span>
              <span>{`约 ${post.readingMinutes} 分钟`}</span>
            </p>

            <p className="text-sm leading-relaxed text-[var(--bl-muted)]">{post.summary}</p>

            <TagChips tags={post.tags} />
          </article>
        </li>
      ))}
    </ul>
  );
}
