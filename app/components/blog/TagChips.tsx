import { Link } from 'react-router';
import { tagHref } from '../../lib/blog/content';

type TagChipsProps = {
  tags: readonly string[];
  className?: string;
};

/** Inline list of tag links; shared by the post list, post header and tag page. */
export function TagChips({ tags, className }: TagChipsProps) {
  if (tags.length === 0) {
    return null;
  }

  return (
    <ul aria-label="标签" className={['flex flex-wrap gap-1.5', className].filter(Boolean).join(' ')}>
      {tags.map((tag) => (
        <li key={tag}>
          <Link
            to={tagHref(tag)}
            className="inline-flex min-h-7 items-center rounded-full border border-[color:var(--bl-border)] px-2.5 text-xs text-[var(--bl-muted)] transition-colors hover:border-[color:var(--bl-accent)] hover:text-[var(--bl-accent-text)]"
          >
            {tag}
          </Link>
        </li>
      ))}
    </ul>
  );
}
