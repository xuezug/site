import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { ASSET_BASE, SITE_URL } from '../../app/lib/env';
import routes from '../../app/routes';
import Home from '../../app/routes/home';
import { DEFAULT_SITE_URL, normalizeSiteUrl, pickSiteUrl } from '../../site-url';

interface RouteEntry {
  path?: string;
  index?: boolean;
  children?: RouteEntry[];
}

function collectPaths(entries: RouteEntry[]): string[] {
  return entries.flatMap((entry) => [
    ...(entry.index ? ['/'] : []),
    ...(entry.path ? [entry.path] : []),
    ...(entry.children ? collectPaths(entry.children) : []),
  ]);
}

describe('route table', () => {
  const paths = collectPaths(routes as unknown as RouteEntry[]);

  it('exposes the six scaffold routes', () => {
    expect(paths).toEqual(
      expect.arrayContaining(['/', 'tier', 'blog', 'blog/:slug', 'blog/tag/:tag', '404']),
    );
  });

  it('has exactly one index route and no duplicate paths', () => {
    expect(paths.filter((path) => path === '/')).toHaveLength(1);
    expect(new Set(paths).size).toBe(paths.length);
  });
});

describe('home page', () => {
  it('renders its heading and primary navigation', () => {
    render(createElement(MemoryRouter, { initialEntries: ['/'] }, createElement(Home)));

    expect(
      screen.getByRole('heading', { level: 1, name: '血族资源站' }),
    ).toBeInTheDocument();
    // The home page cards add descriptive copy to the link text.
    expect(screen.getByRole('link', { name: /Tier Maker/ })).toHaveAttribute('href', '/tier');
  });
});

describe('build-time env injection', () => {
  it('injects the literal production default when no override is configured', () => {
    // Intentionally literal: a SITE_URL override (env or .env) must be a
    // deliberate deploy-time change, and this gate is run with none set.
    expect(SITE_URL).toBe('https://bl.cracklewis.site');
    expect(ASSET_BASE).toBe('https://bl-resource.cracklewis.site');
  });
});

describe('site URL resolution', () => {
  it('prefers an explicit environment variable', () => {
    expect(pickSiteUrl({ SITE_URL: 'https://ci.example.com' }, { SITE_URL: 'https://file.example.com' }))
      .toEqual({ siteUrl: 'https://ci.example.com', source: 'env' });
  });

  it('falls back to the .env file when the process env has none', () => {
    expect(pickSiteUrl({}, { SITE_URL: 'https://staging.example.com' })).toEqual({
      siteUrl: 'https://staging.example.com',
      source: 'file',
    });
  });

  it('uses the production default when neither source is configured', () => {
    expect(pickSiteUrl({}, {})).toEqual({ siteUrl: 'https://bl.cracklewis.site', source: 'fallback' });
    expect(DEFAULT_SITE_URL).toBe('https://bl.cracklewis.site');
  });
});

describe('site URL trailing slashes', () => {
  it('strips a trailing slash from either source', () => {
    expect(pickSiteUrl({ SITE_URL: 'https://a.com/' }, {}).siteUrl).toBe('https://a.com');
    expect(pickSiteUrl({}, { SITE_URL: 'https://a.com/' }).siteUrl).toBe('https://a.com');
  });

  it('strips several trailing slashes', () => {
    expect(pickSiteUrl({ SITE_URL: 'https://a.com///' }, {}).siteUrl).toBe('https://a.com');
    expect(normalizeSiteUrl('https://a.com//')).toBe('https://a.com');
  });

  it('keeps a path prefix while dropping its trailing slash', () => {
    expect(pickSiteUrl({ SITE_URL: 'https://a.com/base/' }, {}).siteUrl).toBe(
      'https://a.com/base',
    );
  });

  it('never normalizes the origin itself away', () => {
    expect(pickSiteUrl({ SITE_URL: 'https://a.com' }, {}).siteUrl).toBe('https://a.com');
    // A slash-only override is a path prefix, not an empty string.
    expect(normalizeSiteUrl('/')).toBe('/');
    expect(normalizeSiteUrl('///')).toBe('/');
  });

  it('leaves the production fallback untouched', () => {
    expect(pickSiteUrl({}, {}).siteUrl).toBe(DEFAULT_SITE_URL);
    expect(normalizeSiteUrl(DEFAULT_SITE_URL)).toBe(DEFAULT_SITE_URL);
  });
});

