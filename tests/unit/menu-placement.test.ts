import { describe, expect, it } from 'vitest';
import {
  MENU_MARGIN,
  MENU_MAX_HEIGHT,
  MENU_WIDTH,
  computeMenuPlacement,
} from '../../app/lib/tier/menuPlacement';

const CARD = { left: 16, top: 300, right: 104, bottom: 408 };

describe('computeMenuPlacement', () => {
  it('aligns to the card left when a right-aligned menu would leave the screen', () => {
    // 375px phone, leftmost pool card: right-0 would put the menu at x=-56.
    const placement = computeMenuPlacement({
      card: CARD,
      containerLeft: 68,
      viewportWidth: 375,
      viewportHeight: 667,
    });

    expect(placement.left).toBe(CARD.left - 68);
    expect(MENU_MARGIN + CARD.left + MENU_WIDTH).toBeLessThanOrEqual(375);
    expect(placement.maxHeight).toBe(MENU_MAX_HEIGHT);
    expect(placement.openUp).toBe(true);
  });

  it('clamps to the right margin for a card at the right edge', () => {
    const placement = computeMenuPlacement({
      card: { left: 271, top: 300, right: 359, bottom: 408 },
      containerLeft: 323,
      viewportWidth: 375,
      viewportHeight: 667,
    });

    const viewportLeft = placement.left + 323;
    expect(viewportLeft).toBe(375 - MENU_WIDTH - MENU_MARGIN);
    expect(viewportLeft + MENU_WIDTH).toBeLessThanOrEqual(375 - MENU_MARGIN);
  });

  it('clamps to the left margin when the card starts at x=0', () => {
    const placement = computeMenuPlacement({
      card: { left: 0, top: 300, right: 88, bottom: 408 },
      containerLeft: 52,
      viewportWidth: 375,
      viewportHeight: 667,
    });

    expect(placement.left + 52).toBe(MENU_MARGIN);
  });

  it('opens downwards when there is no room above (card near the top)', () => {
    const placement = computeMenuPlacement({
      card: { left: 16, top: 20, right: 104, bottom: 128 },
      containerLeft: 68,
      viewportWidth: 375,
      viewportHeight: 667,
    });

    expect(placement.openUp).toBe(false);
    expect(placement.maxHeight).toBe(MENU_MAX_HEIGHT);
  });

  it('opens upwards when the card is near the bottom', () => {
    const placement = computeMenuPlacement({
      card: { left: 16, top: 540, right: 104, bottom: 648 },
      containerLeft: 68,
      viewportWidth: 375,
      viewportHeight: 667,
    });

    expect(placement.openUp).toBe(true);
  });

  it('caps the height to the chosen side on a short viewport', () => {
    const placement = computeMenuPlacement({
      card: { left: 16, top: 40, right: 104, bottom: 148 },
      containerLeft: 68,
      viewportWidth: 375,
      viewportHeight: 200,
    });

    // below = 200 - 148 - 8 = 44, above = 32; the roomier side wins.
    expect(placement.openUp).toBe(false);
    expect(placement.maxHeight).toBe(44);
    expect(placement.maxHeight).toBeLessThanOrEqual(MENU_MAX_HEIGHT);
  });

  it('never returns a negative height', () => {
    const placement = computeMenuPlacement({
      card: { left: 16, top: 0, right: 104, bottom: 667 },
      containerLeft: 68,
      viewportWidth: 375,
      viewportHeight: 667,
    });

    expect(placement.maxHeight).toBe(0);
  });
});
