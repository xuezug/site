import { SITE_URL } from '../env';

/**
 * Path of the standalone 404 document. Cloudflare Pages serves that same
 * document for every unknown URL, so it must not advertise a canonical URL
 * (or an og:url) for the literal `/404` path.
 */
export const NOT_FOUND_PATH = '/404';

/**
 * Route id of the catch-all route in `app/routes.ts`. It renders the same
 * component as `/404`, so every page it matches is a 404 document — the
 * pathname alone cannot tell, because the URL is whatever the visitor typed.
 */
export const NOT_FOUND_ROUTE_ID = 'catch-all';

export type SiteHeadTags = {
  /** Absolute canonical URL, or `null` when the page must not declare one. */
  canonical: string | null;
  /** True for the 404 document: skip the canonical and emit `noindex`. */
  noindex: boolean;
};

/**
 * Path-dependent head tags. The home page is `SITE_URL` without a trailing
 * slash so it matches the configured site URL exactly
 * (`scripts/assert-build.mjs` relies on it).
 *
 * `isNotFoundDocument` is passed by `<SiteHead />` when the router matched the
 * catch-all route: those URLs are unknown paths, so they must behave exactly
 * like `/404` (no canonical, `robots=noindex`) instead of claiming a canonical
 * URL for themselves.
 */
export function siteHeadTags(pathname: string, isNotFoundDocument = false): SiteHeadTags {
  if (isNotFoundDocument || pathname === NOT_FOUND_PATH) {
    return { canonical: null, noindex: true };
  }

  return {
    canonical: pathname === '/' ? SITE_URL : `${SITE_URL}${pathname}`,
    noindex: false,
  };
}

export type OgType = 'website' | 'article';

export type OgMetadata = {
  /** `og:title` — the page title, not the site-wide name. */
  title: string;
  description: string;
  type: OgType;
};

export type RouteParams = Readonly<Record<string, string | undefined>>;

/**
 * Shape of the `handle` export read by `<SiteHead />`. `og` is a plain object
 * for static pages and a function for routes whose title depends on params
 * (e.g. `blog/:slug`), which is the only way to reach `useMatches()` data.
 */
export type RouteHandle = {
  og?: OgMetadata | ((params: RouteParams) => OgMetadata | null);
};

/** Minimal `UIMatch` shape needed to resolve OG data. */
export type MatchWithHandle = {
  params: RouteParams;
  handle: unknown;
};

function resolveHandleOg(handle: unknown, params: RouteParams): OgMetadata | null {
  if (typeof handle !== 'object' || handle === null) {
    return null;
  }

  const { og } = handle as { og?: unknown };
  if (typeof og === 'function') {
    return (og as (params: RouteParams) => OgMetadata | null)(params);
  }
  if (typeof og !== 'object' || og === null) {
    return null;
  }

  const { title, description, type } = og as Record<string, unknown>;
  if (typeof title !== 'string' || typeof description !== 'string') {
    return null;
  }

  return { title, description, type: type === 'article' ? 'article' : 'website' };
}

/**
 * OG tags for the current page: the deepest route `handle.og` wins, so the
 * article/list/tag page replaces the site-wide defaults instead of emitting a
 * second `og:type`/`og:title` pair next to them.
 */
export function resolveOgMetadata(
  matches: readonly MatchWithHandle[],
  fallback: OgMetadata,
): OgMetadata {
  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const match = matches[index];
    if (match === undefined) {
      continue;
    }
    const resolved = resolveHandleOg(match.handle, match.params);
    if (resolved !== null) {
      return resolved;
    }
  }

  return fallback;
}
