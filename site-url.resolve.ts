import { loadEnv } from 'vite';
import { pickSiteUrl, type SiteUrlEnv, type SiteUrlResolution } from './site-url.ts';

/**
 * Resolves the site URL the same way for the Vite build, Vitest, and the
 * post-build assertion. Vite only exposes `VITE_`-prefixed `.env` keys on
 * `process.env`, so `SITE_URL` has to be read with `loadEnv` explicitly.
 */
export function resolveSiteUrl(
  mode: string,
  processEnv: SiteUrlEnv = process.env,
): SiteUrlResolution {
  const fileEnv = loadEnv(mode, process.cwd(), '') as SiteUrlEnv;
  return pickSiteUrl(processEnv, fileEnv);
}
