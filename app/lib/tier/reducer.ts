/**
 * Pure reducer for the tier board.
 *
 * Every action either produces a new `Board` (with a fresh `updatedAt`) or
 * returns the exact same object, so React can skip re-rendering no-ops. There
 * is no undo stack and no storage access here — that lives in `storage.ts`
 * and (from Task 6 on) in `useBoard`.
 */

import {
  BOARD_VERSION,
  DEFAULT_TIERS,
  DEFAULT_TITLE,
  MAX_TIERS,
  NEW_TIER_NAME,
  clampIndex,
  cloneTiers,
  isTierColor,
  nextTierColor,
  nextTierId,
  parseBoard,
  sameTiers,
  type Board,
  type Tier,
} from './model';

export type Action =
  | { type: 'move'; serial: number; toTier: string | null; index?: number }
  | { type: 'addTier' }
  | { type: 'removeTier'; id: string }
  | { type: 'renameTier'; id: string; name: string }
  | { type: 'setTierColor'; id: string; color: string }
  | { type: 'moveTier'; id: string; delta: -1 | 1 }
  | { type: 'renameBoard'; title: string }
  | { type: 'reset' }
  | { type: 'load'; board: Board };

/**
 * Single indirection point for `updatedAt`. Tests move it with
 * `vi.setSystemTime` rather than swapping this function; `let` keeps the door
 * open for an injected clock later without touching any call site.
 */
// eslint-disable-next-line prefer-const -- deliberate single indirection point, see above
let now = (): string => new Date().toISOString();

type Draft = { title: string; tiers: Tier[] };

function sameSerials(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((serial, index) => serial === b[index]);
}

function applyMove(state: Board, action: Extract<Action, { type: 'move' }>): Draft | null {
  const { serial, toTier } = action;
  if (!Number.isSafeInteger(serial)) {
    return null;
  }

  const source = state.tiers.find((tier) => tier.cards.includes(serial));
  const target = toTier === null ? undefined : state.tiers.find((tier) => tier.id === toTier);

  if (toTier !== null && target === undefined) {
    return null;
  }
  // A pool card dropped back into the pool (or onto an unknown tier) is a no-op.
  if (source === undefined && target === undefined) {
    return null;
  }

  const sourceIsTarget = source !== undefined && source === target;

  if (sourceIsTarget && source !== undefined) {
    // Same tier: remove first, then insert into the shortened array, so `index`
    // is measured against the post-removal length.
    const remaining = source.cards.filter((candidate) => candidate !== serial);
    const insertAt = action.index === undefined ? remaining.length : clampIndex(action.index, remaining.length);
    const cards = [...remaining.slice(0, insertAt), serial, ...remaining.slice(insertAt)];
    if (sameSerials(cards, source.cards)) {
      return null;
    }
    return {
      title: state.title,
      tiers: state.tiers.map((tier) => (tier === source ? { ...tier, cards } : tier)),
    };
  }

  const targetBase = target === undefined ? [] : target.cards.filter((candidate) => candidate !== serial);
  const insertAt = action.index === undefined ? targetBase.length : clampIndex(action.index, targetBase.length);
  const targetCards = [...targetBase.slice(0, insertAt), serial, ...targetBase.slice(insertAt)];
  const sourceCards = source === undefined ? [] : source.cards.filter((candidate) => candidate !== serial);

  return {
    title: state.title,
    tiers: state.tiers.map((tier) => {
      if (tier === source) {
        return { ...tier, cards: sourceCards };
      }
      if (tier === target) {
        return { ...tier, cards: targetCards };
      }
      return tier;
    }),
  };
}

function applyAction(state: Board, action: Action): Draft | null {
  switch (action.type) {
    case 'move':
      return applyMove(state, action);

    case 'addTier': {
      if (state.tiers.length >= MAX_TIERS) {
        return null;
      }
      const tier: Tier = {
        id: nextTierId(state.tiers),
        name: NEW_TIER_NAME,
        color: nextTierColor(state.tiers),
        cards: [],
      };
      return { title: state.title, tiers: [...state.tiers, tier] };
    }

    case 'removeTier': {
      if (!state.tiers.some((tier) => tier.id === action.id)) {
        return null;
      }
      // A board always keeps at least one tier: `loadBoard` rejects empty tier
      // lists, so dropping the last one would make the board unsaveable.
      if (state.tiers.length === 1) {
        return null;
      }
      // Removing the tier is all it takes: its cards fall out of every tier and
      // therefore back into the derived pool.
      return { title: state.title, tiers: state.tiers.filter((tier) => tier.id !== action.id) };
    }

    case 'renameTier': {
      const target = state.tiers.find((tier) => tier.id === action.id);
      if (target === undefined) {
        return null;
      }
      const name = action.name.trim();
      if (name === '' || name === target.name) {
        return null;
      }
      return {
        title: state.title,
        tiers: state.tiers.map((tier) => (tier === target ? { ...tier, name } : tier)),
      };
    }

    case 'setTierColor': {
      const target = state.tiers.find((tier) => tier.id === action.id);
      if (target === undefined) {
        return null;
      }
      if (!isTierColor(action.color) || action.color === target.color) {
        return null;
      }
      return {
        title: state.title,
        tiers: state.tiers.map((tier) => (tier === target ? { ...tier, color: action.color } : tier)),
      };
    }

    case 'moveTier': {
      const index = state.tiers.findIndex((tier) => tier.id === action.id);
      if (index === -1) {
        return null;
      }
      const destination = index + action.delta;
      if (destination < 0 || destination >= state.tiers.length) {
        return null;
      }
      const tiers = [...state.tiers];
      const [moved] = tiers.splice(index, 1);
      if (moved === undefined) {
        return null;
      }
      tiers.splice(destination, 0, moved);
      return { title: state.title, tiers };
    }

    case 'renameBoard': {
      const title = action.title.trim();
      if (title === '' || title === state.title) {
        return null;
      }
      return { title, tiers: state.tiers };
    }

    case 'reset':
      // Deliberate deep copy: the user asked for a clean board, and the state
      // must not alias the exported `DEFAULT_TIERS` fixture.
      return { title: DEFAULT_TITLE, tiers: cloneTiers(DEFAULT_TIERS) };

    case 'load': {
      const parsed = parseBoard(action.board);
      if (!parsed.ok) {
        return null;
      }
      if (parsed.board.title === state.title && sameTiers(parsed.board.tiers, state.tiers)) {
        return null;
      }
      return { title: parsed.board.title, tiers: parsed.board.tiers };
    }
  }
}

export function boardReducer(state: Board, action: Action): Board {
  const draft = applyAction(state, action);
  if (draft === null) {
    return state;
  }
  return {
    version: BOARD_VERSION,
    title: draft.title,
    tiers: draft.tiers,
    updatedAt: now(),
  };
}
