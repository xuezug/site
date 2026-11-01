import type { PostHeading } from '../../lib/blog/content';
import { hasToc } from '../../lib/blog/content';

type TocProps = {
  headings: readonly PostHeading[];
};

/**
 * Post table of contents (design §7). `hasToc` (also used by the route, so an
 * empty `<aside>` never renders) requires at least three `h2` sections; below
 * that the list is longer than the article and adds noise. `h3` entries are
 * indented under their preceding `h2`.
 */
export function Toc({ headings }: TocProps) {
  if (!hasToc(headings)) {
    return null;
  }

  return (
    <nav aria-label="文章目录" className="bl-panel flex flex-col gap-2 p-4 text-sm">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--bl-muted)]">目录</p>
      <ul className="flex flex-col gap-1.5">
        {headings.map((heading) => (
          <li key={heading.id} className={heading.level === 3 ? 'pl-3' : undefined}>
            <a
              href={`#${heading.id}`}
              className="text-[var(--bl-muted)] transition-colors hover:text-[var(--bl-accent-text)]"
            >
              {heading.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
