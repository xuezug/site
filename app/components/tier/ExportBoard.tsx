/**
 * Off-screen rendering target for the PNG export (design §6.6).
 *
 * It is deliberately style-inline and free of Tailwind classes: the screenshot
 * is taken from a detached host, so the result must not depend on which
 * stylesheets happen to be loaded. The board is 1200px wide and never
 * interactive — `exportPng` mounts it far off-screen for a fraction of a second
 * and unmounts it again.
 */

import type { Card } from '../../lib/cards/types';
import type { Board } from '../../lib/tier/model';

export const EXPORT_MIN_WIDTH = 1200;
export const EXPORT_CARD_SIZE = 96;

const COLORS = {
  background: '#0b0d12',
  panel: '#12151d',
  border: '#232733',
  text: '#e8eaf0',
  muted: '#8b93a7',
  placeholder: '#2a2f3c',
  placeholderText: '#6b7280',
} as const;

export type ExportBoardProps = {
  board: Board;
  cards: ReadonlyMap<number, Card>;
  /** serial → object URL of a pre-fetched icon; missing entries get a placeholder. */
  icons: ReadonlyMap<number, string>;
  /** `YYYY-MM-DD` shown in the footer; defaults to the local date. */
  date?: string;
};

function localDate(date: Date = new Date()): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export function ExportBoard({ board, cards, icons, date = localDate() }: ExportBoardProps) {
  const placedCount = board.tiers.reduce((total, tier) => total + tier.cards.length, 0);

  return (
    <div
      style={{
        width: EXPORT_MIN_WIDTH,
        minWidth: EXPORT_MIN_WIDTH,
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        gap: 20,
        padding: '40px 48px 28px',
        backgroundColor: COLORS.background,
        color: COLORS.text,
        fontFamily:
          '"PingFang SC", "Microsoft YaHei", "Noto Sans SC", system-ui, -apple-system, sans-serif',
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 16,
        }}
      >
        <h1 style={{ margin: 0, fontSize: 36, lineHeight: 1.2, fontWeight: 700 }}>
          {board.title}
        </h1>
        <span style={{ fontSize: 14, color: COLORS.muted }}>
          {board.tiers.length} 个档位 · {placedCount} 张卡片
        </span>
      </header>

      {board.tiers.map((tier) => (
        <section key={tier.id} style={{ display: 'flex', alignItems: 'stretch', gap: 10 }}>
          <div
            style={{
              width: EXPORT_CARD_SIZE,
              minWidth: EXPORT_CARD_SIZE,
              boxSizing: 'border-box',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '10px 6px',
              borderRadius: 8,
              backgroundColor: tier.color,
              color: '#ffffff',
              fontSize: 24,
              fontWeight: 700,
              lineHeight: 1.25,
              textAlign: 'center',
              wordBreak: 'break-word',
            }}
          >
            {tier.name}
          </div>

          <div
            style={{
              flex: 1,
              minHeight: 112,
              boxSizing: 'border-box',
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'flex-start',
              gap: 6,
              padding: 8,
              borderRadius: 8,
              border: `1px solid ${COLORS.border}`,
              backgroundColor: COLORS.panel,
            }}
          >
            {tier.cards.length === 0 ? (
              <span style={{ alignSelf: 'center', fontSize: 13, color: COLORS.muted }}>
                暂无卡片
              </span>
            ) : (
              <ul
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 6,
                  margin: 0,
                  padding: 0,
                  listStyle: 'none',
                }}
              >
                {tier.cards.map((serial) => {
                  const card = cards.get(serial);
                  const name = card?.name ?? `#${serial}`;
                  const icon = icons.get(serial);

                  return (
                    <li
                      key={serial}
                      title={name}
                      aria-label={name}
                      style={{
                        width: EXPORT_CARD_SIZE,
                        height: EXPORT_CARD_SIZE,
                        borderRadius: 6,
                        overflow: 'hidden',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: COLORS.placeholder,
                      }}
                    >
                      {icon === undefined ? (
                        <span style={{ fontSize: 30, fontWeight: 700, color: COLORS.placeholderText }}>
                          {name.slice(0, 1)}
                        </span>
                      ) : (
                        <img
                          src={icon}
                          alt={name}
                          width={EXPORT_CARD_SIZE}
                          height={EXPORT_CARD_SIZE}
                          style={{
                            display: 'block',
                            width: EXPORT_CARD_SIZE,
                            height: EXPORT_CARD_SIZE,
                            objectFit: 'cover',
                          }}
                        />
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>
      ))}

      <footer
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 16,
          paddingTop: 12,
          borderTop: `1px solid ${COLORS.border}`,
          fontSize: 13,
          color: COLORS.muted,
        }}
      >
        <span>血族资源站 · {date}</span>
      </footer>
    </div>
  );
}
