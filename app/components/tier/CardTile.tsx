import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useDraggable } from '@dnd-kit/core';
import type { DraggableAttributes, DraggableSyntheticListeners } from '@dnd-kit/core';
import { iconUrl } from '../../lib/cards/icon';
import { attributeById } from '../../lib/cards/taxonomy';
import type { Card } from '../../lib/cards/types';
import { cn } from '../../lib/cn';
import { poolCardDndId } from '../../lib/tier/dnd';
import { computeMenuPlacement, type MenuPlacement } from '../../lib/tier/menuPlacement';
import type { Tier } from '../../lib/tier/model';

export type CardFaceSize = 'pool' | 'card' | 'overlay';

const SIZE_CLASSES: Record<CardFaceSize, string> = {
  // Fluid width: the pool grid decides the column count (4/6/8 per design §6.1).
  pool: 'w-full',
  // Fixed width inside a tier row. One size at every breakpoint: the row's
  // label column already sets a ~126px baseline, and a wider card (the old
  // 112/144px) made rows grow when a card was dropped in.
  card: 'w-[88px]',
  overlay: 'w-[160px]',
};

function attributeLabel(card: Card): string {
  return attributeById.get(card.attribute)?.label ?? card.attribute;
}

type CardFaceProps = {
  card: Card;
  size?: CardFaceSize;
  /** Placed-elsewhere cards stay visible in the pool but dimmed (design §6.1). */
  dimmed?: boolean;
  /** Small corner marker, e.g. the tier name on the drag overlay. */
  badge?: string;
  /** Extra classes on the tile root (the pool adds `content-visibility`). */
  className?: string;
};

/**
 * Presentational card tile: image + visible name. It never reads drag state,
 * so the filtered pool, the tier rows and the drag overlay all share it.
 *
 * The attribute is signalled by a 2px strip *below* the image, so the tier
 * badge in the top-right corner can never cover it (brief: 角标不遮挡属性色条).
 */
export function CardFace({ card, size = 'pool', dimmed = false, badge, className }: CardFaceProps) {
  const label = attributeLabel(card);
  const color = attributeById.get(card.attribute)?.color;
  const alt = `${card.name}（${card.star} 星 ${label}）`;
  const [broken, setBroken] = useState(false);

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-lg border border-[color:var(--bl-border)] bg-[var(--bl-panel)]',
        SIZE_CLASSES[size],
        dimmed && 'opacity-40',
        className,
      )}
    >
      {broken ? (
        // Grey placeholder with the first character; still exposes the alt text
        // and never throws (brief: 图片加载失败降级).
        <div
          role="img"
          aria-label={alt}
          className="grid aspect-square w-full place-items-center bg-[#2a2a33] text-lg font-semibold text-[var(--bl-muted)]"
        >
          {card.name.slice(0, 1)}
        </div>
      ) : (
        <img
          src={iconUrl(card.iconPath)}
          // Design §8/§11: `名称（星级 属性）`, also read by agents from the HTML.
          alt={alt}
          width={144}
          height={144}
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setBroken(true)}
          className="block aspect-square w-full object-cover"
        />
      )}
      {color === undefined ? null : (
        <span
          aria-hidden="true"
          className="block h-0.5 w-full"
          style={{ backgroundColor: color }}
        />
      )}
      <p className="truncate px-1 py-0.5 pr-8 text-[11px] leading-tight text-[var(--bl-text)]">
        {card.name}
      </p>
      {badge !== undefined ? (
        <span className="absolute right-1 top-1 rounded bg-black/70 px-1 text-[10px] leading-4 text-white">
          {badge}
        </span>
      ) : null}
    </div>
  );
}

type CardMenuProps = {
  card: Card;
  tiers: readonly Tier[];
  currentTierId: string | null;
  onAssign: (serial: number, tierId: string | null) => void;
};

/**
 * The non-drag path from design §6.3: a「＋」button opening a tier menu. It is
 * the keyboard and touch fallback, so it lives outside the drag activator.
 *
 * Menu contract: opening moves focus to the first item, ArrowUp/Down/Home/End
 * rove within the items, Escape (document level) closes and returns focus to
 * the trigger, and focus moving outside the container closes it.
 */
export function CardMenu({ card, tiers, currentTierId, onAssign }: CardMenuProps) {
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<MenuPlacement | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  const measurePlacement = useCallback((): MenuPlacement | null => {
    const container = containerRef.current;
    if (container === null) {
      return null;
    }
    // The positioned container is the 32px「＋」wrapper; its parent is the
    // whole card, whose left/right edges the menu aligns to.
    const card = container.parentElement ?? container;
    return computeMenuPlacement({
      card: card.getBoundingClientRect(),
      containerLeft: container.getBoundingClientRect().left,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    });
  }, []);

  const closeMenu = useCallback((refocusTrigger: boolean) => {
    setOpen(false);
    if (refocusTrigger) {
      triggerRef.current?.focus();
    }
  }, []);

  const toggleMenu = useCallback((): void => {
    if (open) {
      closeMenu(false);
      return;
    }
    const next = measurePlacement();
    if (next === null) {
      return;
    }
    setPlacement(next);
    setOpen(true);
  }, [closeMenu, measurePlacement, open]);

  // Move focus into the menu as soon as it opens (menu button pattern).
  useEffect(() => {
    if (!open) {
      return;
    }
    const first = containerRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]');
    first?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: PointerEvent): void => {
      if (event.target instanceof Node && containerRef.current?.contains(event.target) === true) {
        return;
      }
      closeMenu(false);
    };

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') {
        return;
      }
      event.preventDefault();
      closeMenu(true);
    };

    const handleFocusIn = (event: FocusEvent): void => {
      if (event.target instanceof Node && containerRef.current?.contains(event.target) === true) {
        return;
      }
      // Focus escaped the menu (Tab / click on another control): close quietly.
      closeMenu(false);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('focusin', handleFocusIn);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('focusin', handleFocusIn);
    };
  }, [open, closeMenu]);

  // Keep the menu inside the viewport if the page scrolls or the window
  // resizes while it is open (mobile URL bar changes count as resize).
  useEffect(() => {
    if (!open) {
      return;
    }
    const reposition = (): void => {
      const next = measurePlacement();
      if (next !== null) {
        setPlacement(next);
      }
    };
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [open, measurePlacement]);

  const choose = (tierId: string | null): void => {
    setOpen(false);
    onAssign(card.serial, tierId);
  };

  const handleMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const items = Array.from(
      containerRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [],
    );
    if (items.length === 0) {
      return;
    }

    const current = items.findIndex((item) => item === document.activeElement);
    const last = items.length - 1;

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        items[current === -1 ? 0 : (current + 1) % items.length]?.focus();
        break;
      case 'ArrowUp':
        event.preventDefault();
        items[current <= 0 ? last : current - 1]?.focus();
        break;
      case 'Home':
        event.preventDefault();
        items[0]?.focus();
        break;
      case 'End':
        event.preventDefault();
        items[last]?.focus();
        break;
      case 'Tab':
        // Close but let Tab move on to the next focusable element.
        setOpen(false);
        break;
      default:
        break;
    }
  };

  return (
    <div ref={containerRef} className="absolute bottom-1 right-1">
      <button
        ref={triggerRef}
        type="button"
        aria-label={`${card.name} 放入档位`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={toggleMenu}
        // 32px visual button with a 44px hit area via the `after:` inset.
        className="relative grid h-8 w-8 place-items-center rounded-full border border-[color:var(--bl-border-strong)] bg-black/70 text-sm leading-none text-white shadow after:absolute after:-inset-1.5 after:rounded-full after:content-[''] hover:bg-black/85"
      >
        ＋
      </button>

      {open && placement !== null ? (
        <div
          id={menuId}
          role="menu"
          aria-label={`${card.name} 档位菜单`}
          onKeyDown={handleMenuKeyDown}
          style={{ left: placement.left, maxHeight: placement.maxHeight }}
          className={cn(
            'absolute z-30 flex w-40 flex-col gap-0.5 overflow-y-auto rounded-lg border border-[color:var(--bl-border-strong)] bg-[var(--bl-panel)] p-1 shadow-xl',
            placement.openUp ? 'bottom-full mb-1' : 'top-full mt-1',
          )}
        >
          {tiers.map((tier) => (
            <button
              key={tier.id}
              type="button"
              role="menuitem"
              tabIndex={-1}
              onClick={() => choose(tier.id)}
              className="min-h-9 rounded px-2 text-left text-xs text-[var(--bl-text)] hover:bg-[var(--bl-panel-hover)]"
            >
              {`放入 ${tier.name} 档`}
            </button>
          ))}
          {currentTierId !== null ? (
            <button
              type="button"
              role="menuitem"
              tabIndex={-1}
              onClick={() => choose(null)}
              className="min-h-9 rounded px-2 text-left text-xs text-[var(--bl-accent-text)] hover:bg-[var(--bl-panel-hover)]"
            >
              移出榜单
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

type DraggableCardProps = {
  card: Card;
  tiers: readonly Tier[];
  /** Current tier name, used for the accessible label. `null` means the pool. */
  tierName: string | null;
  /** Enables the「移出榜单」entry when set. */
  currentTierId: string | null;
  placed: boolean;
  onAssign: (serial: number, tierId: string | null) => void;
  attributes: DraggableAttributes;
  listeners: DraggableSyntheticListeners;
  setNodeRef: (node: HTMLLIElement | null) => void;
  faceSize?: CardFaceSize;
  badge?: string;
  dragging?: boolean;
  dimmed?: boolean;
  /** Pool copy of an already placed card: labels itself「已在 X 档」. */
  poolOrigin?: boolean;
  /**
   * Extra classes on the card face (the pool adds `content-visibility`).
   *
   * Deliberately *not* on the `<li>`: `content-visibility` implies paint
   * containment, which would clip the「＋」menu that overflows the tile and make
   * it unclickable (verified in Chrome).
   */  faceClassName?: string;
  /** e2e hook: stable id for the tile root (`pool-card` / `placed-card`). */
  testId?: string;
  style?: CSSProperties;
  /**
   * Tab order of the drag activator. Placed cards keep `0`; pool copies pass
   * `-1` so the 916-tile grid does not add a tab stop per card (their「＋」
   * button stays the keyboard path). Applied after dnd-kit's `attributes`
   * spread, which always sets `tabIndex=0`.
   */
  tabIndex?: number;
};

/**
 * Shared tile shell: the `<li>` is the drag node, the inner div is the
 * activator (image area), and the menu button stays outside the activator so
 * tapping「＋」never starts a drag.
 */
export function DraggableCard({
  card,
  tiers,
  tierName,
  currentTierId,
  placed,
  onAssign,
  attributes,
  listeners,
  setNodeRef,
  faceSize = 'card',
  badge,
  dragging = false,
  dimmed = false,
  poolOrigin = false,
  faceClassName,
  testId,
  style,
  tabIndex = 0,
}: DraggableCardProps) {
  const label = attributeLabel(card);
  const location =
    placed && tierName !== null
      ? poolOrigin
        ? `已在 ${tierName} 档`
        : `当前在 ${tierName} 档`
      : '未上榜';

  return (
    <li
      ref={setNodeRef}
      data-testid={testId}
      style={style}
      className={cn('relative min-w-0 shrink-0', dragging && 'opacity-40')}
    >
      <div
        {...attributes}
        {...listeners}
        // dnd-kit sets tabIndex=0; place it here so a pool tile can opt out
        // without losing `role="button"` or the accessible name.
        tabIndex={tabIndex}
        aria-label={`${card.name}，${card.star} 星，${label}，${location}`}
        // Overrides dnd-kit's generated id with the board's own sr-only text.
        aria-describedby="tier-dnd-instructions"
        className="cursor-grab touch-manipulation rounded-lg select-none active:cursor-grabbing"
      >
        <CardFace
          card={card}
          size={faceSize}
          dimmed={dimmed}
          badge={badge}
          className={faceClassName}
        />
      </div>

      <CardMenu
        card={card}
        tiers={tiers}
        currentTierId={currentTierId}
        onAssign={onAssign}
      />
    </li>
  );
}

type PoolCardProps = {
  card: Card;
  tiers: readonly Tier[];
  onAssign: (serial: number, tierId: string | null) => void;
  /** Tier this card currently sits in, if any. Placed cards stay in the pool. */
  placedTier?: Tier | null;
};

/**
 * Draggable pool tile. The drag overlay renders the moving copy, so the source
 * tile only fades while dragging; no transform is applied here.
 *
 * Pool tiles live in their own dnd id space (`pool-card:<serial>`): a placed
 * card is rendered in the pool *and* in its tier row, and two draggables
 * sharing one id would collide inside dnd-kit's registries.
 */
export function PoolCard({ card, tiers, onAssign, placedTier = null }: PoolCardProps) {
  const placed = placedTier !== null;
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: poolCardDndId(card.serial),
  });

  return (
    <DraggableCard
      card={card}
      tiers={tiers}
      tierName={placedTier?.name ?? null}
      currentTierId={placedTier?.id ?? null}
      placed={placed}
      onAssign={onAssign}
      attributes={attributes}
      listeners={listeners}
      setNodeRef={setNodeRef}
      faceSize="pool"
      badge={placedTier?.name}
      dimmed={placed}
      dragging={isDragging}
      poolOrigin
      tabIndex={-1}
      testId="pool-card"
      faceClassName="[content-visibility:auto] [contain-intrinsic-size:auto_144px]"
    />
  );
}
