import { beforeEach, describe, expect, it } from 'vitest';
import {
  NAME_WIDTH_KEY,
  NAME_WIDTH_MAX,
  NAME_WIDTH_MIN,
  clampNameWidth,
  readNameWidth,
  writeNameWidth,
} from '../../app/lib/tier/nameWidth';

describe('clampNameWidth', () => {
  it('clamps to the supported range and rounds', () => {
    expect(clampNameWidth(10)).toBe(NAME_WIDTH_MIN);
    expect(clampNameWidth(999)).toBe(NAME_WIDTH_MAX);
    expect(clampNameWidth(100.6)).toBe(101);
    expect(clampNameWidth(Number.NaN)).toBe(NAME_WIDTH_MIN);
  });
});

describe('name width storage', () => {
  beforeEach(() => {
    window.localStorage.removeItem(NAME_WIDTH_KEY);
  });

  it('round-trips a clamped width', () => {
    writeNameWidth(140);
    expect(window.localStorage.getItem(NAME_WIDTH_KEY)).toBe('140');
    expect(readNameWidth()).toBe(140);
  });

  it('clamps values read from storage (hand-edited / old data)', () => {
    window.localStorage.setItem(NAME_WIDTH_KEY, '9999');
    expect(readNameWidth()).toBe(NAME_WIDTH_MAX);
    window.localStorage.setItem(NAME_WIDTH_KEY, '10');
    expect(readNameWidth()).toBe(NAME_WIDTH_MIN);
  });

  it('ignores malformed values and removes the key on reset', () => {
    window.localStorage.setItem(NAME_WIDTH_KEY, 'wide');
    expect(readNameWidth()).toBeNull();

    writeNameWidth(120);
    writeNameWidth(null);
    expect(window.localStorage.getItem(NAME_WIDTH_KEY)).toBeNull();
    expect(readNameWidth()).toBeNull();
  });

  it('never throws when storage is unavailable or blocked', () => {
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

    expect(readNameWidth(throwing)).toBeNull();
    expect(() => writeNameWidth(120, throwing)).not.toThrow();
  });
});
