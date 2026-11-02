import { beforeEach, describe, expect, it } from 'vitest';
import {
  CARD_MENU_KEY,
  readCardMenu,
  writeCardMenu,
} from '../../app/lib/tier/cardMenuVisibility';

describe('card menu visibility storage', () => {
  beforeEach(() => {
    window.localStorage.removeItem(CARD_MENU_KEY);
  });

  it('defaults to visible when nothing is stored', () => {
    expect(readCardMenu()).toBe(true);
  });

  it('round-trips hidden and visible', () => {
    writeCardMenu(false);
    expect(window.localStorage.getItem(CARD_MENU_KEY)).toBe('0');
    expect(readCardMenu()).toBe(false);

    writeCardMenu(true);
    expect(window.localStorage.getItem(CARD_MENU_KEY)).toBe('1');
    expect(readCardMenu()).toBe(true);
  });

  it('treats malformed values as visible and never throws', () => {
    window.localStorage.setItem(CARD_MENU_KEY, 'maybe');
    expect(readCardMenu()).toBe(true);

    const throwing = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    } as unknown as Storage;

    expect(readCardMenu(throwing)).toBe(true);
    expect(() => writeCardMenu(false, throwing)).not.toThrow();
  });
});
