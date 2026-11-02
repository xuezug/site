import { beforeEach, describe, expect, it } from 'vitest';
import {
  ROW_HEIGHT_DEFAULT,
  ROW_HEIGHT_KEY,
  ROW_HEIGHT_MAX,
  ROW_HEIGHT_MIN,
  clampRowHeight,
  readRowHeight,
  writeRowHeight,
} from '../../app/lib/tier/rowHeight';

describe('clampRowHeight', () => {
  it('clamps to the supported range and rounds', () => {
    expect(clampRowHeight(10)).toBe(ROW_HEIGHT_MIN);
    expect(clampRowHeight(999)).toBe(ROW_HEIGHT_MAX);
    expect(clampRowHeight(180.4)).toBe(180);
    expect(clampRowHeight(Number.NaN)).toBe(ROW_HEIGHT_DEFAULT);
  });
});

describe('row height storage', () => {
  beforeEach(() => {
    window.localStorage.removeItem(ROW_HEIGHT_KEY);
  });

  it('round-trips a clamped height', () => {
    writeRowHeight(208);
    expect(window.localStorage.getItem(ROW_HEIGHT_KEY)).toBe('208');
    expect(readRowHeight()).toBe(208);
  });

  it('clamps hand-edited values and ignores malformed ones', () => {
    window.localStorage.setItem(ROW_HEIGHT_KEY, '9999');
    expect(readRowHeight()).toBe(ROW_HEIGHT_MAX);
    window.localStorage.setItem(ROW_HEIGHT_KEY, '10');
    expect(readRowHeight()).toBe(ROW_HEIGHT_MIN);
    window.localStorage.setItem(ROW_HEIGHT_KEY, 'tall');
    expect(readRowHeight()).toBeNull();
  });

  it('removes the key on reset and never throws with blocked storage', () => {
    writeRowHeight(200);
    writeRowHeight(null);
    expect(window.localStorage.getItem(ROW_HEIGHT_KEY)).toBeNull();

    const throwing = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    } as unknown as Storage;

    expect(readRowHeight(throwing)).toBeNull();
    expect(() => writeRowHeight(200, throwing)).not.toThrow();
  });
});
