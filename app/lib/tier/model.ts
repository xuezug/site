/**
 * Tier board model: shapes, default board and pure helpers.
 *
 * No React and no DOM access here, so the model can run on the server and in
 * plain unit tests. The character pool is *not* stored: it is derived as
 * "every serial that is not in any tier" (see `placedSerials`), which is why
 * removing a tier automatically returns its cards to the pool.
 */

export type Tier = {
  id: string;
  name: string;
  color: string;
  cards: number[];
};

export type Board = {
  version: 1;
  title: string;
  tiers: Tier[];
  updatedAt: string;
};

export const BOARD_VERSION = 1;

export const DEFAULT_TITLE = '我的节奏榜';

/** Name given to a tier created with `addTier`. */
export const NEW_TIER_NAME = '新档位';

/** Design §6.2: at most 12 tiers. */
export const MAX_TIERS = 12;

/**
 * Preset palette (design §6.2: 12 colours). The six default tier colours come
 * first, so the first added tier continues the spectrum (`#ec4899`).
 */
export const TIER_COLORS: readonly string[] = [
  '#e11d48',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
  '#14b8a6',
  '#06b6d4',
  '#84cc16',
  '#f43f5e',
  '#a855f7',
];

/** Default board tiers, in fixed display order (S A B C D F). */
export const DEFAULT_TIERS: Tier[] = [
  { id: 't-s', name: 'S', color: '#e11d48', cards: [] },
  { id: 't-a', name: 'A', color: '#f97316', cards: [] },
  { id: 't-b', name: 'B', color: '#eab308', cards: [] },
  { id: 't-c', name: 'C', color: '#22c55e', cards: [] },
  { id: 't-d', name: 'D', color: '#3b82f6', cards: [] },
  { id: 't-f', name: 'F', color: '#8b5cf6', cards: [] },
];

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const NUMERIC_TIER_ID = /^t-(\d+)$/;

/** `#rgb` or `#rrggbb` only; anything else is rejected by the reducer. */
export function isTierColor(value: string): boolean {
  return HEX_COLOR.test(value);
}

export function createDefaultBoard(updatedAt: string = new Date().toISOString()): Board {
  return {
    version: BOARD_VERSION,
    title: DEFAULT_TITLE,
    tiers: cloneTiers(DEFAULT_TIERS),
    updatedAt,
  };
}

export function cloneTiers(tiers: readonly Tier[]): Tier[] {
  return tiers.map((tier) => ({
    id: tier.id,
    name: tier.name,
    color: tier.color,
    cards: [...tier.cards],
  }));
}

export function cloneBoard(board: Board): Board {
  return {
    version: BOARD_VERSION,
    title: board.title,
    tiers: cloneTiers(board.tiers),
    updatedAt: board.updatedAt,
  };
}

/** Every serial that currently sits in a tier; the complement is the pool. */
export function placedSerials(board: Board): Set<number> {
  const serials = new Set<number>();
  for (const tier of board.tiers) {
    for (const serial of tier.cards) {
      serials.add(serial);
    }
  }
  return serials;
}

/** Clamp an insertion index into `[0, length]`; a non-finite index appends. */
export function clampIndex(index: number, length: number): number {
  if (!Number.isFinite(index)) {
    return length;
  }
  return Math.min(Math.max(Math.trunc(index), 0), length);
}

function sameSerials(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((serial, index) => serial === b[index]);
}

/** Structural equality of tier lists, ignoring object identity. */
export function sameTiers(a: readonly Tier[], b: readonly Tier[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return a.every((tier, index) => {
    const other = b[index];
    if (other === undefined) {
      return false;
    }
    return (
      tier.id === other.id &&
      tier.name === other.name &&
      tier.color === other.color &&
      sameSerials(tier.cards, other.cards)
    );
  });
}

/**
 * Next free numeric tier id. `t-s`/`t-a`/… have no numeric suffix and are
 * skipped, so the first added tier is `t-1`; existing ids are never reused.
 */
export function nextTierId(tiers: readonly Tier[]): string {
  const used = new Set(tiers.map((tier) => tier.id));
  let highest = 0;
  for (const tier of tiers) {
    const match = NUMERIC_TIER_ID.exec(tier.id);
    if (match === null) {
      continue;
    }
    const value = Number.parseInt(match[1] ?? '', 10);
    if (Number.isSafeInteger(value) && value > highest) {
      highest = value;
    }
  }

  let next = highest + 1;
  while (used.has(`t-${next}`)) {
    next += 1;
  }
  return `t-${next}`;
}

/** First palette colour not yet used, else the next palette slot. */
export function nextTierColor(tiers: readonly Tier[]): string {
  const used = new Set(tiers.map((tier) => tier.color.toLowerCase()));
  const free = TIER_COLORS.find((color) => !used.has(color));
  if (free !== undefined) {
    return free;
  }
  return TIER_COLORS[tiers.length % TIER_COLORS.length] ?? '#e11d48';
}

/** Why a stored/imported board was rejected. */
export type BoardIssue =
  | 'not-object'
  | 'version'
  | 'title'
  | 'updatedAt'
  | 'tiers'
  | 'tier'
  | 'duplicate-tier-id';

export type BoardParseResult = { ok: true; board: Board } | { ok: false; issue: BoardIssue };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSerialList(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.every((serial) => typeof serial === 'number' && Number.isSafeInteger(serial) && serial >= 0)
  );
}

function parseTier(value: unknown): Tier | null {
  if (!isRecord(value)) {
    return null;
  }
  const { id, name, color, cards } = value;
  if (typeof id !== 'string' || id.trim() === '') {
    return null;
  }
  if (typeof name !== 'string' || name.trim() === '') {
    return null;
  }
  if (typeof color !== 'string' || !isTierColor(color)) {
    return null;
  }
  if (!isSerialList(cards)) {
    return null;
  }
  return { id, name, color, cards: [...cards] };
}

/**
 * Validate a persisted board. Anything malformed is rejected as a whole — no
 * half-repair — except duplicate serials, where the first occurrence wins
 * (design §6.6). A serial may appear at most once across the whole board.
 */
export function parseBoard(value: unknown): BoardParseResult {
  if (!isRecord(value)) {
    return { ok: false, issue: 'not-object' };
  }

  const { version, title, updatedAt, tiers: rawTiers } = value;
  if (version !== BOARD_VERSION) {
    return { ok: false, issue: 'version' };
  }
  if (typeof title !== 'string') {
    return { ok: false, issue: 'title' };
  }
  if (typeof updatedAt !== 'string') {
    return { ok: false, issue: 'updatedAt' };
  }
  if (!Array.isArray(rawTiers) || rawTiers.length < 1 || rawTiers.length > MAX_TIERS) {
    return { ok: false, issue: 'tiers' };
  }

  const tiers: Tier[] = [];
  const ids = new Set<string>();
  const placed = new Set<number>();

  for (const rawTier of rawTiers) {
    const tier = parseTier(rawTier);
    if (tier === null) {
      return { ok: false, issue: 'tier' };
    }
    if (ids.has(tier.id)) {
      return { ok: false, issue: 'duplicate-tier-id' };
    }
    ids.add(tier.id);

    const cards: number[] = [];
    for (const serial of tier.cards) {
      if (placed.has(serial)) {
        continue;
      }
      placed.add(serial);
      cards.push(serial);
    }
    tiers.push({ id: tier.id, name: tier.name, color: tier.color, cards });
  }

  return { ok: true, board: { version: BOARD_VERSION, title, tiers, updatedAt } };
}
