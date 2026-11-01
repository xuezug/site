export const DEFAULT_SITE_URL = 'https://bl.cracklewis.site';

export type SiteUrlSource = 'env' | 'file' | 'fallback';

export interface SiteUrlResolution {
  siteUrl: string;
  source: SiteUrlSource;
}

export interface SiteUrlEnv {
  SITE_URL?: string | undefined;
}

/**
 * `https://a.com/` and `https://a.com///` both become `https://a.com`, so every
 * consumer can append `${siteUrl}/tier` without double slashes. A value made of
 * nothing but slashes (`/`, a path prefix) is kept as `/` rather than empty.
 */
export function normalizeSiteUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '');
  return trimmed === '' ? '/' : trimmed;
}

/**
 * Precedence: an explicit process env var (CI / Cloudflare Pages) wins over
 * `.env*` files, which in turn win over the production fallback.
 */
export function pickSiteUrl(processEnv: SiteUrlEnv, fileEnv: SiteUrlEnv): SiteUrlResolution {
  if (processEnv.SITE_URL) {
    return { siteUrl: normalizeSiteUrl(processEnv.SITE_URL), source: 'env' };
  }
  if (fileEnv.SITE_URL) {
    return { siteUrl: normalizeSiteUrl(fileEnv.SITE_URL), source: 'file' };
  }
  return { siteUrl: DEFAULT_SITE_URL, source: 'fallback' };
}
