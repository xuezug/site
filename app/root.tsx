import type { ReactNode } from 'react';
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLocation,
  useMatches,
} from 'react-router';
import type { Route } from './+types/root';
import { AppShell } from './components/layout/AppShell';
import { ToastProvider } from './components/ui/Toast';
import { SITE_URL } from './lib/env';
import {
  NOT_FOUND_ROUTE_ID,
  resolveOgMetadata,
  siteHeadTags,
  type OgMetadata,
} from './lib/seo/head';
import { serializeJsonLd, websiteJsonLd } from './lib/seo/jsonld';
import { SITE_DESCRIPTION, SITE_NAME } from './lib/seo/meta';
import stylesheet from './styles/app.css?url';

const DEFAULT_OG: OgMetadata = {
  title: SITE_NAME,
  description: SITE_DESCRIPTION,
  type: 'website',
};

/** Single site-wide social card; articles intentionally do not get their own. */
const OG_IMAGE = `${SITE_URL}/og-default.png`;
const OG_IMAGE_WIDTH = '1200';
const OG_IMAGE_HEIGHT = '630';

const WEBSITE_JSON_LD = websiteJsonLd({ siteUrl: SITE_URL, description: SITE_DESCRIPTION });

export const links: Route.LinksFunction = () => [{ rel: 'stylesheet', href: stylesheet }];

/**
 * Fallback metadata for routes that do not export their own `meta`. Note that
 * React Router replaces parent meta with the leaf route's meta array, so
 * per-path tags (canonical, og:url) are rendered by `<SiteHead />` instead.
 */
export function meta(_args: Route.MetaArgs) {
  return [
    { title: SITE_NAME },
    { name: 'description', content: SITE_DESCRIPTION },
  ];
}

/**
 * Site-wide head tags that depend on the current path. Rendered directly in
 * `<head>` so every route — including routes added later — gets a correct
 * canonical URL and OG/Twitter defaults.
 */
function SiteHead() {
  const { pathname } = useLocation();
  const matches = useMatches();
  // The catch-all route renders the 404 document for any unknown URL, so the
  // page must not claim a canonical URL for it (see `siteHeadTags`).
  const isNotFound = matches.some((match) => match.id === NOT_FOUND_ROUTE_ID);
  const { canonical } = siteHeadTags(pathname, isNotFound);
  const og = resolveOgMetadata(matches, DEFAULT_OG);

  return (
    <>
      <meta name="theme-color" content="#0b0d12" />
      <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
      <link rel="icon" href="/favicon.ico" sizes="32x32" />
      {canonical === null ? (
        // One document serves every unknown URL, so a canonical/og:url here
        // would point every missing page at the same URL.
        <meta name="robots" content="noindex" />
      ) : (
        <link rel="canonical" href={canonical} />
      )}
      <meta property="og:type" content={og.type} />
      <meta property="og:site_name" content={SITE_NAME} />
      <meta property="og:title" content={og.title} />
      <meta property="og:description" content={og.description} />
      {canonical === null ? null : <meta property="og:url" content={canonical} />}
      <meta property="og:locale" content="zh_CN" />
      <meta property="og:image" content={OG_IMAGE} />
      <meta property="og:image:width" content={OG_IMAGE_WIDTH} />
      <meta property="og:image:height" content={OG_IMAGE_HEIGHT} />
      <meta property="og:image:alt" content={SITE_NAME} />
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={og.title} />
      <meta name="twitter:description" content={og.description} />
      <meta name="twitter:image" content={OG_IMAGE} />
      <script
        type="application/ld+json"
        // Static site-wide structured data; JSON.stringify output contains no
        // user input, and `</script>` cannot appear in these literal values.
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(WEBSITE_JSON_LD) }}
      />
    </>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <SiteHead />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <AppShell>
        <Outlet />
      </AppShell>
    </ToastProvider>
  );
}
