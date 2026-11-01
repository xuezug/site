import taxonomyJson from '../../../src/data/taxonomy.json';

/**
 * Card taxonomy for the pool UI.
 *
 * Ids are declared once here as literal tuples so that the union types can be
 * derived from them (no hand-written union duplicated elsewhere). Labels and
 * attribute colours are *not* duplicated: they are read from
 * `src/data/taxonomy.json` at module load, and a mismatch between that file and
 * the id tuples below fails fast instead of rendering blank chips.
 */

export const ATTRIBUTE_IDS = ['water', 'fire', 'wood', 'thunder', 'light', 'dark'] as const;
export const FACTION_IDS = ['sanctuary', 'tower', 'alien', 'traveler', 'otherworld'] as const;
export const CAREER_IDS = ['warrior', 'archer', 'assassin', 'mage', 'priest'] as const;
export const GENDER_IDS = ['male', 'female', 'nonhuman', 'both'] as const;

export type AttrId = (typeof ATTRIBUTE_IDS)[number];
export type FactionId = (typeof FACTION_IDS)[number];
export type CareerId = (typeof CAREER_IDS)[number];
export type GenderId = (typeof GENDER_IDS)[number];

export type LabeledOption<TId extends string> = {
  readonly id: TId;
  readonly label: string;
};

export type AttributeOption = LabeledOption<AttrId> & {
  readonly color: string;
  readonly gameId: number;
};

export type FactionOption = LabeledOption<FactionId>;
export type CareerOption = LabeledOption<CareerId>;
export type GenderOption = LabeledOption<GenderId>;

type SourceRow = { readonly id: string; readonly label: string };

function narrowId<TId extends string>(kind: string, known: readonly TId[], id: string): TId {
  const match = known.find((candidate) => candidate === id);
  if (match === undefined) {
    throw new Error(`taxonomy.json: unknown ${kind} id "${id}"`);
  }
  return match;
}

function assertSameSize(kind: string, expected: readonly unknown[], actual: readonly unknown[]): void {
  if (expected.length !== actual.length) {
    throw new Error(
      `taxonomy.json: expected ${expected.length} ${kind} entries, found ${actual.length}`,
    );
  }
}

function toOptions<TId extends string>(
  kind: string,
  known: readonly TId[],
  rows: readonly SourceRow[],
): readonly LabeledOption<TId>[] {
  const options = rows.map(
    (row): LabeledOption<TId> => ({ id: narrowId(kind, known, row.id), label: row.label }),
  );
  assertSameSize(kind, known, options);
  return options;
}

function toById<TId extends string, TOption extends { readonly id: TId }>(
  options: readonly TOption[],
): ReadonlyMap<TId, TOption> {
  return new Map(options.map((option): [TId, TOption] => [option.id, option]));
}

export const ATTRIBUTES: readonly AttributeOption[] = taxonomyJson.attributes.map((row) => ({
  id: narrowId('attribute', ATTRIBUTE_IDS, row.id),
  label: row.label,
  color: row.color,
  gameId: row.gameId,
}));

assertSameSize('attribute', ATTRIBUTE_IDS, ATTRIBUTES);

export const FACTIONS: readonly FactionOption[] = toOptions(
  'faction',
  FACTION_IDS,
  taxonomyJson.factions,
);

export const CAREERS: readonly CareerOption[] = toOptions('career', CAREER_IDS, taxonomyJson.careers);

export const GENDERS: readonly GenderOption[] = toOptions('gender', GENDER_IDS, taxonomyJson.genders);

export const STARS: readonly number[] = [...taxonomyJson.stars].sort((a, b) => a - b);

export const attributeById: ReadonlyMap<AttrId, AttributeOption> = toById(ATTRIBUTES);
export const factionById: ReadonlyMap<FactionId, FactionOption> = toById(FACTIONS);
export const careerById: ReadonlyMap<CareerId, CareerOption> = toById(CAREERS);
export const genderById: ReadonlyMap<GenderId, GenderOption> = toById(GENDERS);
