/**
 * Placement math for the card's「＋」tier menu.
 *
 * The menu is 160px wide and anchored to the card's bottom-right button, so on
 * a 375px screen the old fixed `right-0` alignment pushed it off the left edge
 * for cards in the first columns. Instead the menu is aligned to whichever edge
 * keeps it inside the viewport, and opens up/down depending on which side has
 * more room. Keeping the math pure makes the edge cases testable without a
 * browser layout.
 */

export const MENU_WIDTH = 160;
export const MENU_MAX_HEIGHT = 256;
export const MENU_MARGIN = 8;

export type MenuRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export type MenuPlacement = {
  /** Left edge in px, relative to the menu's positioned container. */
  left: number;
  /** True when the menu opens above the trigger. */
  openUp: boolean;
  /** Height cap so the menu never leaves the viewport; it scrolls inside. */
  maxHeight: number;
};

export type MenuPlacementInput = {
  card: MenuRect;
  containerLeft: number;
  viewportWidth: number;
  viewportHeight: number;
};

export function computeMenuPlacement({
  card,
  containerLeft,
  viewportWidth,
  viewportHeight,
}: MenuPlacementInput): MenuPlacement {
  const maxLeft = Math.max(MENU_MARGIN, viewportWidth - MENU_WIDTH - MENU_MARGIN);
  const viewportLeft = Math.min(Math.max(card.left, MENU_MARGIN), maxLeft);

  // Space available on each side of the card, excluding the margin.
  const spaceAbove = Math.max(0, card.top - MENU_MARGIN);
  const spaceBelow = Math.max(0, viewportHeight - card.bottom - MENU_MARGIN);

  // Prefer opening up at full height; otherwise use the roomier side.
  const openUp = spaceAbove >= MENU_MAX_HEIGHT || spaceAbove >= spaceBelow;
  const available = openUp ? spaceAbove : spaceBelow;

  return {
    left: viewportLeft - containerLeft,
    openUp,
    maxHeight: Math.min(MENU_MAX_HEIGHT, available),
  };
}
