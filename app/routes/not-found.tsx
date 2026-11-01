import { Link } from 'react-router';
import type { Route } from './+types/not-found';

export function meta(_args: Route.MetaArgs) {
  return [
    { title: '页面不存在 · 血族资源站' },
    { name: 'description', content: '你访问的页面不存在，可以从首页或节奏榜重新开始。' },
  ];
}

export default function NotFound() {
  return (
    <div className="flex max-w-xl flex-col items-start gap-5 py-6">
      <p className="text-xs font-semibold uppercase tracking-[0.3em] text-[var(--bl-accent-text)]">
        404
      </p>
      <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">页面不存在</h1>
      <p className="text-sm leading-relaxed text-[var(--bl-muted)]">
        你访问的地址可能已经移动或删除。可以回到首页重新开始，或直接打开节奏榜。
      </p>
      <div className="flex flex-wrap gap-3">
        <Link
          to="/"
          className="inline-flex min-h-11 items-center justify-center rounded-lg bg-[var(--bl-accent)] px-4 text-sm font-medium text-white transition-colors hover:bg-[var(--bl-accent-strong)]"
        >
          返回首页
        </Link>
        <Link
          to="/tier"
          className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[color:var(--bl-border-strong)] px-4 text-sm font-medium text-[var(--bl-text)] transition-colors hover:bg-[var(--bl-panel-hover)]"
        >
          去节奏榜
        </Link>
      </div>
    </div>
  );
}
