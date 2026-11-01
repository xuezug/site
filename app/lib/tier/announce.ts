/**
 * Board live-region copy for a move, kept pure so it can be unit-tested
 * without a drag (jsdom cannot produce dnd-kit pointer events).
 *
 * `null` means "stay quiet": dropping an unplaced pool card back onto the pool
 * is a no-op in the reducer, so announcing 「已移出榜单」 would be a lie.
 */
export function moveAnnouncement(
  cardName: string,
  targetTierName: string | undefined,
  wasPlaced: boolean,
): string | null {
  if (targetTierName !== undefined) {
    return `${cardName} 已放入 ${targetTierName} 档`;
  }
  return wasPlaced ? `${cardName} 已移出榜单` : null;
}
