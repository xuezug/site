import { describe, expect, it } from 'vitest';
import cardsJson from '../../src/data/cards.json';
import { ASSET_BASE } from '../../app/lib/env';
import { filterCards } from '../../app/lib/cards/filters';
import { iconUrl } from '../../app/lib/cards/icon';
import { sortCards } from '../../app/lib/cards/sort';
import {
  ATTRIBUTES,
  ATTRIBUTE_IDS,
  CAREERS,
  CAREER_IDS,
  FACTIONS,
  FACTION_IDS,
  GENDERS,
  GENDER_IDS,
  STARS,
  attributeById,
  careerById,
  factionById,
  genderById,
} from '../../app/lib/cards/taxonomy';
import type { AttrId, Card, Filters } from '../../app/lib/cards/types';

// The export artifact is widened by `resolveJsonModule`; every enum id is
// validated against `taxonomy.json` at runtime by the integrity test below.
const ALL_CARDS = cardsJson as Card[];
const NO_PLACED = new Set<number>();

function tally<T>(values: readonly T[]): Map<T, number> {
  const counts = new Map<T, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

function makeCard(overrides: Partial<Card> & Pick<Card, 'serial' | 'name' | 'star'>): Card {
  const attribute = overrides.attribute ?? 'fire';
  return {
    serial: overrides.serial,
    looks: overrides.looks ?? overrides.serial,
    name: overrides.name,
    uniqueId: overrides.uniqueId ?? overrides.serial,
    star: overrides.star,
    maxStar: overrides.maxStar ?? 5,
    attribute,
    attributes: overrides.attributes ?? [attribute],
    faction: overrides.faction ?? 'traveler',
    career: overrides.career ?? 'warrior',
    careerOptions: overrides.careerOptions ?? [],
    gender: overrides.gender ?? 'female',
    skinOf: overrides.skinOf ?? null,
    iconPath: overrides.iconPath ?? `card_icons/${overrides.serial}.png`,
  };
}

describe('cards.json dataset', () => {
  it('holds 916 cards with unique, ascending serials', () => {
    expect(ALL_CARDS).toHaveLength(916);

    const serials = ALL_CARDS.map((card) => card.serial);
    expect(new Set(serials).size).toBe(916);
    expect(serials).toEqual([...serials].sort((a, b) => a - b));
    expect(serials[0]).toBe(1);
    expect(serials.at(-1)).toBe(2001);
  });

  it('breaks down by star: 21 / 71 / 153 / 145 / 526', () => {
    expect(tally(ALL_CARDS.map((card) => card.star))).toEqual(
      new Map([
        [1, 21],
        [2, 71],
        [3, 153],
        [4, 145],
        [5, 526],
      ]),
    );
  });

  it('breaks down by primary attribute: 火 211 / 水 156 / 光 155 / 雷 136 / 暗 130 / 树 128', () => {
    expect(tally(ALL_CARDS.map((card) => card.attribute))).toEqual(
      new Map<AttrId, number>([
        ['fire', 211],
        ['water', 156],
        ['light', 155],
        ['thunder', 136],
        ['dark', 130],
        ['wood', 128],
      ]),
    );
  });

  it('breaks down by faction: 旅人 349 / 异族 221 / 圣地 166 / 异界 109 / 法塔 71', () => {
    expect(tally(ALL_CARDS.map((card) => card.faction))).toEqual(
      new Map([
        ['traveler', 349],
        ['alien', 221],
        ['sanctuary', 166],
        ['otherworld', 109],
        ['tower', 71],
      ]),
    );
  });

  it('breaks down by career: 战士 294 / 法师 178 / 刺客 163 / 牧师 150 / 射手 131', () => {
    expect(tally(ALL_CARDS.map((card) => card.career))).toEqual(
      new Map([
        ['warrior', 294],
        ['mage', 178],
        ['assassin', 163],
        ['priest', 150],
        ['archer', 131],
      ]),
    );
  });

  it('has exactly 17 dual-attribute cards whose primary attribute is attributes[0]', () => {
    const dual = ALL_CARDS.filter((card) => card.attributes.length > 1);
    expect(dual).toHaveLength(17);
    expect(ALL_CARDS.filter((card) => card.attributes[0] !== card.attribute)).toEqual([]);
    expect(ALL_CARDS.filter((card) => card.attributes.length === 0)).toEqual([]);
  });
});

describe('taxonomy', () => {
  it('reads labels and colours from taxonomy.json', () => {
    expect(ATTRIBUTES.map((option) => option.id)).toEqual([...ATTRIBUTE_IDS]);
    expect(FACTIONS.map((option) => option.id)).toEqual([...FACTION_IDS]);
    expect(CAREERS.map((option) => option.id)).toEqual([...CAREER_IDS]);
    expect(GENDERS.map((option) => option.id)).toEqual([...GENDER_IDS]);
    expect(STARS).toEqual([1, 2, 3, 4, 5]);
  });

  it('exposes the documented labels and attribute colour', () => {
    expect(attributeById.get('fire')).toEqual({
      id: 'fire',
      label: '火',
      color: '#ef4444',
      gameId: 2,
    });
    expect(attributeById.get('light')?.color).toBe('#eab308');
    expect(factionById.get('otherworld')?.label).toBe('异世界');
    expect(careerById.get('mage')?.label).toBe('法师');
    expect(genderById.get('nonhuman')?.label).toBe('非人形');
  });

  it('only references ids that the taxonomy knows', () => {
    const unknown = new Set<string>();
    for (const card of ALL_CARDS) {
      if (!attributeById.has(card.attribute)) unknown.add(`attribute:${card.attribute}`);
      for (const attribute of card.attributes) {
        if (!attributeById.has(attribute)) unknown.add(`attribute:${attribute}`);
      }
      if (!factionById.has(card.faction)) unknown.add(`faction:${card.faction}`);
      if (!careerById.has(card.career)) unknown.add(`career:${card.career}`);
      if (!genderById.has(card.gender)) unknown.add(`gender:${card.gender}`);
    }
    expect([...unknown]).toEqual([]);
  });
});

describe('filterCards', () => {
  it('returns every card for an empty filter and never hands back the input array', () => {
    const result = filterCards(ALL_CARDS, { query: '' }, NO_PLACED);

    expect(result).toHaveLength(916);
    expect(result).not.toBe(ALL_CARDS);
    expect(result[0]).toBe(ALL_CARDS[0]);
  });

  it('ignores a blank query', () => {
    expect(filterCards(ALL_CARDS, { query: '   ' }, NO_PLACED)).toHaveLength(916);
    expect(filterCards(ALL_CARDS, { query: ' \n\t ' }, NO_PLACED)).toHaveLength(916);
  });

  it('filters a single dimension', () => {
    const fire = filterCards(ALL_CARDS, { query: '', attribute: 'fire' }, NO_PLACED);
    expect(fire).toHaveLength(211);
    expect(fire.every((card) => card.attribute === 'fire')).toBe(true);

    expect(filterCards(ALL_CARDS, { query: '', faction: 'traveler' }, NO_PLACED)).toHaveLength(349);
    expect(filterCards(ALL_CARDS, { query: '', career: 'warrior' }, NO_PLACED)).toHaveLength(294);
    expect(filterCards(ALL_CARDS, { query: '', star: 5 }, NO_PLACED)).toHaveLength(526);
    expect(filterCards(ALL_CARDS, { query: '', star: 1 }, NO_PLACED)).toHaveLength(21);
  });

  it('ANDs dimensions together', () => {
    expect(
      filterCards(ALL_CARDS, { query: '', attribute: 'fire', star: 5 }, NO_PLACED),
    ).toHaveLength(126);
    expect(
      filterCards(
        ALL_CARDS,
        { query: '', attribute: 'fire', star: 5, faction: 'traveler' },
        NO_PLACED,
      ),
    ).toHaveLength(68);
    expect(
      filterCards(
        ALL_CARDS,
        { query: '', star: 4, faction: 'traveler', career: 'warrior' },
        NO_PLACED,
      ),
    ).toHaveLength(16);
    expect(
      filterCards(
        ALL_CARDS,
        { query: '', attribute: 'fire', star: 5, faction: 'traveler', career: 'warrior' },
        NO_PLACED,
      ),
    ).toHaveLength(36);
  });

  it('matches a card by its serial', () => {
    expect(filterCards(ALL_CARDS, { query: '425' }, NO_PLACED).map((card) => card.serial)).toEqual([
      425,
    ]);
    expect(filterCards(ALL_CARDS, { query: ' 425 ' }, NO_PLACED).map((card) => card.serial)).toEqual(
      [425],
    );
    // Substring search, so every serial containing "44" matches.
    expect(filterCards(ALL_CARDS, { query: '44' }, NO_PLACED).map((card) => card.serial)).toEqual([
      44, 144, 244, 344, 440, 441, 442, 443, 444, 445, 446, 447, 448, 449, 544, 644, 744,
    ]);
  });

  it('matches names case-insensitively and trims surrounding whitespace', () => {
    expect(filterCards(ALL_CARDS, { query: 'denji' }, NO_PLACED).map((card) => card.serial)).toEqual(
      [607],
    );
    expect(
      filterCards(ALL_CARDS, { query: '  DENJI  ' }, NO_PLACED).map((card) => card.serial),
    ).toEqual([607]);
    expect(filterCards(ALL_CARDS, { query: '阿尔杰' }, NO_PLACED).map((card) => card.serial)).toEqual(
      [518],
    );
  });

  it('matches dual-attribute cards only through their primary attribute', () => {
    const thunder = filterCards(ALL_CARDS, { query: '', attribute: 'thunder' }, NO_PLACED).map(
      (card) => card.serial,
    );
    const light = filterCards(ALL_CARDS, { query: '', attribute: 'light' }, NO_PLACED).map((card) =>
      card.serial,
    );

    // 441 / 667 / 1002 are thunder-primary cards that also carry light.
    expect(thunder).toEqual(expect.arrayContaining([441, 667, 1002]));
    expect(light).not.toContain(441);
    expect(light).not.toContain(667);
    expect(light).not.toContain(1002);
    // 649 / 722 / 1509 are light-primary dual-attribute cards.
    expect(light).toEqual(expect.arrayContaining([649, 722, 1509]));
    expect(light).toHaveLength(155);

    // 425 is dark-primary with a secondary water attribute.
    expect(filterCards(ALL_CARDS, { query: '', attribute: 'water' }, NO_PLACED).map((card) => card.serial))
      .not.toContain(425);
    expect(filterCards(ALL_CARDS, { query: '', attribute: 'dark' }, NO_PLACED).map((card) => card.serial))
      .toContain(425);
  });

  it('drops placed serials when onlyUnplaced is set', () => {
    const placed = new Set([425, 441]);

    const unplaced = filterCards(ALL_CARDS, { query: '', onlyUnplaced: true }, placed);
    expect(unplaced).toHaveLength(914);
    expect(unplaced.map((card) => card.serial)).not.toContain(425);
    expect(unplaced.map((card) => card.serial)).not.toContain(441);

    expect(filterCards(ALL_CARDS, { query: '', onlyUnplaced: false }, placed)).toHaveLength(916);
  });

  it('combines onlyUnplaced with the other dimensions', () => {
    const fireFive = filterCards(ALL_CARDS, { query: '', attribute: 'fire', star: 5 }, NO_PLACED);
    const survivor = fireFive.at(-1);
    expect(fireFive).toHaveLength(126);
    expect(survivor).toBeDefined();

    const placed = new Set(fireFive.filter((card) => card.serial !== survivor?.serial).map((card) => card.serial));
    expect(placed.size).toBe(125);

    const remaining = filterCards(
      ALL_CARDS,
      { query: '', attribute: 'fire', star: 5, onlyUnplaced: true },
      placed,
    );
    expect(remaining.map((card) => card.serial)).toEqual([survivor?.serial]);
  });

  it('treats runtime-unknown enum values as matching nothing', () => {
    const runtimeOnlyAttribute: string = 'plasma';
    const filters: Filters = { query: '', attribute: runtimeOnlyAttribute as AttrId };

    expect(filterCards(ALL_CARDS, filters, NO_PLACED)).toEqual([]);
    expect(filterCards(ALL_CARDS, { query: '', star: 6 }, NO_PLACED)).toEqual([]);
  });

  it('does not mutate the input array', () => {
    const before = ALL_CARDS.map((card) => card.serial);
    filterCards(ALL_CARDS, { query: 'a', attribute: 'dark', star: 5 }, new Set([2, 3]));
    expect(ALL_CARDS.map((card) => card.serial)).toEqual(before);
  });
});

describe('sortCards', () => {
  it('sorts star descending, then name, without touching the input', () => {
    const before = ALL_CARDS.map((card) => card.serial);
    const sorted = sortCards(ALL_CARDS);

    expect(sorted).toHaveLength(916);
    expect(sorted).not.toBe(ALL_CARDS);
    expect(ALL_CARDS.map((card) => card.serial)).toEqual(before);

    const violations: string[] = [];
    for (let index = 1; index < sorted.length; index += 1) {
      const previous = sorted[index - 1];
      const current = sorted[index];
      if (previous === undefined || current === undefined) {
        continue;
      }
      if (previous.star < current.star) {
        violations.push(`star ${previous.serial} < ${current.serial}`);
        continue;
      }
      if (previous.star === current.star) {
        const byName = previous.name.localeCompare(current.name, 'zh-Hans-CN');
        if (byName > 0 || (byName === 0 && previous.serial > current.serial)) {
          violations.push(`name/serial ${previous.serial} > ${current.serial}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('starts with pinyin-ordered 5★ cards and ends the 5★ block on Latin names', () => {
    const sorted = sortCards(ALL_CARDS);
    const fiveStars = sorted.filter((card) => card.star === 5);

    expect(sorted[0]?.star).toBe(5);
    expect(fiveStars.slice(0, 3).map((card) => card.name)).toEqual(['阿尔杰塔', '阿尔弥', '阿尔丝蒂']);
    expect(fiveStars.at(-1)?.name).toBe('Power');
  });

  it('is deterministic', () => {
    expect(sortCards(ALL_CARDS).map((card) => card.serial)).toEqual(
      sortCards(ALL_CARDS).map((card) => card.serial),
    );
  });

  it('breaks identical star + name ties by serial', () => {
    const fixture = [
      makeCard({ serial: 30, name: '同名卡', star: 3 }),
      makeCard({ serial: 10, name: '同名卡', star: 3 }),
      makeCard({ serial: 20, name: '同名卡', star: 3 }),
      makeCard({ serial: 40, name: 'Bravo', star: 3 }),
      makeCard({ serial: 50, name: 'Alpha', star: 3 }),
      makeCard({ serial: 60, name: 'Zulu', star: 2 }),
    ];

    // Same star: zh-Hans-CN collation puts the CJK name first, then Latin names;
    // the three identical "同名卡" rows fall back to ascending serial.
    expect(sortCards(fixture).map((card) => card.serial)).toEqual([10, 20, 30, 50, 40, 60]);
  });

  it('orders by star before name', () => {
    const fixture = [
      makeCard({ serial: 1, name: 'Alpha', star: 4 }),
      makeCard({ serial: 2, name: 'Zulu', star: 5 }),
    ];

    expect(sortCards(fixture).map((card) => card.serial)).toEqual([2, 1]);
  });
});

describe('iconUrl', () => {
  it('joins the default asset base and the icon path', () => {
    expect(iconUrl('card_icons/1_10261.png')).toBe(`${ASSET_BASE}/card_icons/1_10261.png`);
    expect(ASSET_BASE).toBe('https://bl-resource.cracklewis.site');
  });

  it('collapses duplicated slashes between base and path', () => {
    expect(iconUrl('/card_icons/1_10261.png', 'https://cdn.example.com')).toBe(
      'https://cdn.example.com/card_icons/1_10261.png',
    );
    expect(iconUrl('card_icons/1_10261.png', 'https://cdn.example.com/')).toBe(
      'https://cdn.example.com/card_icons/1_10261.png',
    );
    expect(iconUrl('///card_icons/1_10261.png', 'https://cdn.example.com///')).toBe(
      'https://cdn.example.com/card_icons/1_10261.png',
    );

    const url = iconUrl('card_icons/1_10261.png', 'https://cdn.example.com/');
    expect(url.match(/\/\//g)).toHaveLength(1);
  });

  it('returns an empty string for an empty icon path', () => {
    expect(iconUrl('')).toBe('');
    expect(iconUrl('', 'https://cdn.example.com/')).toBe('');
  });

  it('resolves the real icon path of the first card', () => {
    const firstCard = ALL_CARDS.find((card) => card.serial === 1);
    expect(firstCard?.iconPath).toBe('card_icons/1_10261.png');
    expect(iconUrl('card_icons/1_10261.png')).toBe(`${ASSET_BASE}/card_icons/1_10261.png`);
  });
});
