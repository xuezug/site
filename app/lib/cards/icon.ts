import { ASSET_BASE } from '../env';

/**
 * Absolute URL for a card icon. `base` defaults to `ASSET_BASE`; trailing
 * slashes on the base and leading slashes on `iconPath` collapse into exactly
 * one separator. An empty `iconPath` yields an empty string so callers can fall
 * back to a placeholder.
 */
export function iconUrl(iconPath: string, base: string = ASSET_BASE): string {
  if (iconPath === '') {
    return '';
  }
  return `${base.replace(/\/+$/, '')}/${iconPath.replace(/^\/+/, '')}`;
}
