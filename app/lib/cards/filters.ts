import type { Card, Filters } from './types';

/**
 * Pure card filter for the tier-maker pool.
 *
 * - `query` matches the card name or `String(serial)`, trimmed, case-insensitive;
 *   a blank query is ignored.
 * - Every provided dimension is ANDed. `attribute` compares the *primary*
 *   attribute, so a dual-attribute card is only reachable through `attributes[0]`.
 * - `onlyUnplaced` drops serials already present in `placed`.
 * - Runtime-unknown enum values simply match nothing (no throw).
 */
export function filterCards(
  cards: readonly Card[],
  filters: Filters,
  placed: ReadonlySet<number>,
): Card[] {
  const query = filters.query.trim().toLowerCase();
  const { attribute, faction, career, star, onlyUnplaced } = filters;

  return cards.filter((card) => {
    if (query !== '') {
      const matchesName = card.name.toLowerCase().includes(query);
      const matchesSerial = String(card.serial).includes(query);
      if (!matchesName && !matchesSerial) {
        return false;
      }
    }

    if (attribute !== undefined && card.attribute !== attribute) {
      return false;
    }
    if (faction !== undefined && card.faction !== faction) {
      return false;
    }
    if (career !== undefined && card.career !== career) {
      return false;
    }
    if (star !== undefined && card.star !== star) {
      return false;
    }
    if (onlyUnplaced === true && placed.has(card.serial)) {
      return false;
    }

    return true;
  });
}
