import type { Card } from './types';

/**
 * Pool display order: star descending, then name (pinyin collation), then
 * serial ascending. The serial tiebreak makes the result total and therefore
 * stable regardless of the engine's sort implementation.
 */
export function sortCards(cards: Card[]): Card[] {
  return [...cards].sort((a, b) => {
    if (a.star !== b.star) {
      return b.star - a.star;
    }
    const byName = a.name.localeCompare(b.name, 'zh-Hans-CN');
    if (byName !== 0) {
      return byName;
    }
    return a.serial - b.serial;
  });
}
