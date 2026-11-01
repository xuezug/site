import type { AttrId, CareerId, FactionId, GenderId } from './taxonomy';

export type { AttrId, CareerId, FactionId, GenderId };

/** One card (a card/skin row of `cards.json`), not one character. */
export type Card = {
  serial: number;
  looks: number;
  name: string;
  uniqueId: number;
  star: number;
  maxStar: number;
  /** Primary attribute; for dual-attribute cards this is `attributes[0]`. */
  attribute: AttrId;
  /** One entry for normal cards, two for the 17 dual-attribute cards. */
  attributes: AttrId[];
  faction: FactionId;
  career: CareerId;
  /** Raw in-game promotion names; display only, never used as a filter key. */
  careerOptions: string[];
  gender: GenderId;
  /** `original_id` of the base card, or `null` for non-skin cards. */
  skinOf: number | null;
  iconPath: string;
};

/** Pool filter state. Absent/`undefined` dimensions are ignored (OR within none). */
export type Filters = {
  query: string;
  attribute?: AttrId;
  faction?: FactionId;
  career?: CareerId;
  star?: number;
  onlyUnplaced?: boolean;
};
