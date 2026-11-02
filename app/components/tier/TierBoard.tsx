import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { Announcements, DragEndEvent, DragStartEvent } from '@dnd-kit/core';
import { CardPool } from './CardPool';
import { ConfirmDialog } from './ConfirmDialog';
import { BoardDragOverlay } from './DragOverlay';
import { ImportDialog } from './ImportDialog';
import { SnapshotPanel } from './SnapshotPanel';
import { TierRow } from './TierRow';
import { useNameWidth } from './useNameWidth';
import { Button } from '../ui/Button';
import { useToast } from '../ui/Toast';
import type { Card } from '../../lib/cards/types';
import { moveAnnouncement } from '../../lib/tier/announce';
import {
  parseDropTarget,
  parseSerial,
  POOL_CARD_PREFIX,
  tierBoardCollisionDetection,
  tierBoardKeyboardCoordinates,
} from '../../lib/tier/dnd';
import { downloadJson, importToBoard, toFile, type TierFile } from '../../lib/tier/importExport';
import { MAX_TIERS, placedSerials, type Board, type Tier } from '../../lib/tier/model';
import type { Action } from '../../lib/tier/reducer';
import { listSnapshots, removeSnapshot, type Snapshot } from '../../lib/tier/snapshots';

const DND_INSTRUCTIONS =
  '档位内的卡片可聚焦：按空格或回车拾起，用方向键移动，再按空格或回车放下，按 Esc 取消。角色池中的卡片不在 Tab 顺序里，请用卡片右下角的「＋」按钮选择档位。';

const PNG_EXPORT_FAILED = '图片导出失败（可能被跨域图片拦截），请检查 R2 CORS';

/** The board owns its own live region, so dnd-kit's English one stays quiet. */
const SILENT_ANNOUNCEMENTS: Announcements = {
  onDragStart: () => undefined,
  onDragMove: () => undefined,
  onDragOver: () => undefined,
  onDragEnd: () => undefined,
  onDragCancel: () => undefined,
};

type ConfirmState = { kind: 'reset' } | { kind: 'removeTier'; tier: Tier };

type DragState = {
  serial: number | null;
  /** Keyboard drags must keep the page scrollable; see the scroll-lock effect. */
  keyboard: boolean;
};

export type TierBoardProps = {
  cards: readonly Card[];
  board: Board;
  dispatch: (action: Action) => void;
  onSnapshot: (label?: string) => void;
  onRestore: (id: string) => void;
  onReset: () => void;
  saveError: string | null;
  /** `updatedAt` of a board applied from another tab; `null` when there is none. */
  remoteUpdateAt: string | null;
  /** Clears `remoteUpdateAt` once the toast has been shown (one-shot notice). */
  onRemoteUpdateAcknowledged: () => void;
};

/**
 * Board chrome: editable title, toolbar (import/export, snapshots, reset),
 * tier rows, the filtered pool and the DnD context tying them together.
 */
export function TierBoard({
  cards,
  board,
  dispatch,
  onSnapshot,
  onRestore,
  onReset,
  saveError,
  remoteUpdateAt,
  onRemoteUpdateAcknowledged,
}: TierBoardProps) {
  const cardsById = useMemo(() => new Map(cards.map((card) => [card.serial, card])), [cards]);
  const placed = useMemo(() => placedSerials(board), [board]);
  const { tiers } = board;
  const { show } = useToast();

  // Another tab wrote a newer board: tell the user once, then clear the flag so
  // a later local edit does not re-show the same notice.
  useEffect(() => {
    if (remoteUpdateAt === null) {
      return;
    }
    show('另一标签页更新了榜单，已同步');
    onRemoteUpdateAcknowledged();
  }, [remoteUpdateAt, show, onRemoteUpdateAcknowledged]);

  const [dragging, setDragging] = useState<DragState | null>(null);
  const [announcement, setAnnouncement] = useState('');
  // `null` mirrors `board.title`; a string is the in-progress edit.
  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  const [snapshotsOpen, setSnapshotsOpen] = useState(false);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const { width: nameWidth, setWidth: setNameWidth } = useNameWidth();
  const rowsRef = useRef<HTMLDivElement>(null);

  // Resizing the name column must not re-render the 916-card pool on every
  // pointermove. During the drag the width is written straight to the rows
  // container's CSS variable; React state (and storage) is updated once on
  // release.
  const previewNameWidth = useCallback((px: number): void => {
    rowsRef.current?.style.setProperty('--bl-tier-name-w', `${px}px`);
  }, []);

  const commitNameWidth = useCallback(
    (px: number | null): void => {
      if (px === null) {
        rowsRef.current?.style.removeProperty('--bl-tier-name-w');
      }
      setNameWidth(px);
    },
    [setNameWidth],
  );

  const titleValue = titleDraft ?? board.title;
  const activeSerial = dragging?.serial ?? null;

  // Design §6.3: lock page scroll only while a *pointer* drag is running, and
  // always release it (including on unmount). Keyboard drags must not lock:
  // dnd-kit's KeyboardSensor scrolls the page to reach targets (see
  // `tierBoardKeyboardCoordinates`), and `overflow-hidden` stalls it.
  useEffect(() => {
    if (dragging === null || dragging.keyboard) {
      return;
    }
    document.body.classList.add('overflow-hidden');
    return () => document.body.classList.remove('overflow-hidden');
  }, [dragging]);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: tierBoardKeyboardCoordinates }),
  );

  const moveCard = useCallback(
    (serial: number, tierId: string | null, index?: number) => {
      const card = cardsById.get(serial);
      const tier = tierId === null ? undefined : tiers.find((candidate) => candidate.id === tierId);

      dispatch({ type: 'move', serial, toTier: tierId, index });

      if (card === undefined) {
        return;
      }
      // Quiet for the no-op case: an unplaced pool card dropped back on the
      // pool does not change the board, so announcing a removal would be wrong.
      const message = moveAnnouncement(card.name, tier?.name, placed.has(serial));
      if (message !== null) {
        setAnnouncement(message);
      }
    },
    [cardsById, dispatch, placed, tiers],
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setDragging({
      serial: parseSerial(event.active.id),
      keyboard: event.activatorEvent instanceof KeyboardEvent,
    });
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setDragging(null);

      const serial = parseSerial(event.active.id);
      if (serial === null || event.over === null) {
        return;
      }
      const target = parseDropTarget(event.over);
      if (target === null) {
        return;
      }
      // The pool renders a dimmed copy of every placed card. Dropping that
      // copy back on the pool must not take the card off the board: only a
      // drag that started from an in-tier `card:` id may remove a card.
      if (target.tierId === null && String(event.active.id).startsWith(POOL_CARD_PREFIX)) {
        return;
      }
      moveCard(serial, target.tierId, target.index);
    },
    [moveCard],
  );

  const handleDragCancel = useCallback(() => {
    setDragging(null);
  }, []);

  const commitTitle = (): void => {
    const next = titleValue.trim();
    if (next === '') {
      setTitleDraft(null);
      return;
    }
    dispatch({ type: 'renameBoard', title: next });
    setTitleDraft(null);
  };

  const handleRenameTier = useCallback(
    (id: string, name: string) => {
      dispatch({ type: 'renameTier', id, name });
    },
    [dispatch],
  );

  const handleTierColor = useCallback(
    (id: string, color: string) => {
      dispatch({ type: 'setTierColor', id, color });
    },
    [dispatch],
  );

  const handleMoveTier = useCallback(
    (id: string, delta: -1 | 1) => {
      dispatch({ type: 'moveTier', id, delta });
    },
    [dispatch],
  );

  const handleRemoveTier = useCallback(
    (tier: Tier) => {
      if (tier.cards.length === 0) {
        // Empty tiers go instantly (brief「空档位删除」), no confirmation.
        dispatch({ type: 'removeTier', id: tier.id });
        setAnnouncement(`已删除档位 ${tier.name}`);
        return;
      }
      setConfirm({ kind: 'removeTier', tier });
    },
    [dispatch],
  );

  const handleSaveSnapshot = (): void => {
    onSnapshot();
    setSnapshots(listSnapshots());
    setAnnouncement('已保存快照');
  };

  const openSnapshots = (): void => {
    setSnapshots(listSnapshots());
    setSnapshotsOpen(true);
  };

  const handleRestoreSnapshot = (id: string): void => {
    onRestore(id);
    setSnapshotsOpen(false);
    setAnnouncement('已恢复快照');
  };

  const handleDeleteSnapshot = (id: string): void => {
    removeSnapshot(id);
    setSnapshots(listSnapshots());
  };

  const handleExportJson = (): void => {
    downloadJson(toFile(board, cardsById));
    // Toast only: the live region is reserved for drag/move announcements, and
    // duplicating every import/export there would double-announce it.
    show('已导出 JSON 文件');
  };

  const handleExportPng = async (): Promise<void> => {
    if (exporting) {
      return;
    }
    setExporting(true);
    try {
      // Loaded on demand: the rasteriser and the 1200px board are only needed
      // when the user actually asks for a PNG.
      const { exportPng } = await import('../../lib/tier/exportImage');
      await exportPng(board, cardsById, {
        onPlaceholder: (count) => {
          show(`有 ${count} 张卡片图标未能加载，已用占位图代替`, 'error');
        },
      });
      show('已导出 PNG 图片');
    } catch {
      show(PNG_EXPORT_FAILED, 'error');
    } finally {
      setExporting(false);
    }
  };

  const handleImport = (file: TierFile): void => {
    // §6.5: importing overwrites the board, so keep a safety copy first. The
    // hook still sees the pre-import board here.
    onSnapshot('导入前');
    dispatch({ type: 'load', board: importToBoard(file) });
    setImportOpen(false);
    show('已导入');
  };

  const handleConfirm = (): void => {
    if (confirm === null) {
      return;
    }
    if (confirm.kind === 'reset') {
      onReset();
      setConfirm(null);
      setAnnouncement('已重置为默认榜单');
      return;
    }

    const { tier } = confirm;
    // Destructive: keep a copy before the cards fall back into the pool.
    onSnapshot('删除档位');
    dispatch({ type: 'removeTier', id: tier.id });
    setConfirm(null);
    setAnnouncement(`已删除档位 ${tier.name}，${tier.cards.length} 张卡片已回到角色池`);
  };

  const activeCard = activeSerial === null ? null : (cardsById.get(activeSerial) ?? null);
  const activeTier = board.tiers.find(
    (tier) => activeSerial !== null && tier.cards.includes(activeSerial),
  );

  return (
    <div className="flex flex-col gap-5">
      <DndContext
        id="tier-board"
        sensors={sensors}
        collisionDetection={tierBoardCollisionDetection}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
        accessibility={{
          announcements: SILENT_ANNOUNCEMENTS,
          screenReaderInstructions: { draggable: DND_INSTRUCTIONS },
        }}
      >
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="board-title" className="sr-only">
              榜单标题
            </label>
            <input
              id="board-title"
              value={titleValue}
              onChange={(event) => setTitleDraft(event.target.value)}
              onBlur={commitTitle}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  commitTitle();
                } else if (event.key === 'Escape') {
                  event.preventDefault();
                  setTitleDraft(null);
                }
              }}
              className="min-h-11 min-w-[9rem] flex-1 rounded-lg border border-[color:var(--bl-border)] bg-[var(--bl-panel)] px-3 text-lg font-semibold text-[var(--bl-text)]"
            />
            <Button size="sm" variant="ghost" onClick={() => setImportOpen(true)}>
              导入
            </Button>
            <Button size="sm" variant="ghost" onClick={handleExportJson}>
              导出 JSON
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                void handleExportPng();
              }}
              disabled={exporting}
              aria-busy={exporting}
            >
              {exporting ? '生成中…' : '导出 PNG'}
            </Button>
            <Button size="sm" variant="ghost" onClick={handleSaveSnapshot}>
              保存快照
            </Button>
            <Button size="sm" variant="ghost" onClick={openSnapshots}>
              快照历史
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirm({ kind: 'reset' })}>
              重置
            </Button>
            <Button
              size="sm"
              onClick={() => dispatch({ type: 'addTier' })}
              disabled={tiers.length >= MAX_TIERS}
              title={tiers.length >= MAX_TIERS ? '最多 12 个档位' : undefined}
            >
              添加档位
            </Button>
          </div>

          {saveError !== null ? (
            <p
              role="alert"
              className="rounded-lg border border-[color:var(--bl-danger)] bg-[#2a1113] px-3 py-2 text-xs text-[#fecdd3]"
            >
              {saveError}
            </p>
          ) : null}

          <p id="tier-dnd-instructions" className="sr-only">
            {DND_INSTRUCTIONS}
          </p>

          <div
            ref={rowsRef}
            className="flex flex-col gap-2"
            style={
              nameWidth === null
                ? undefined
                : ({ '--bl-tier-name-w': `${nameWidth}px` } as CSSProperties)
            }
          >
            {tiers.map((tier, index) => (
              <TierRow
                key={tier.id}
                tier={tier}
                index={index}
                count={tiers.length}
                tiers={tiers}
                cards={tier.cards
                  .map((serial) => cardsById.get(serial))
                  .filter((card): card is Card => card !== undefined)}
                placedSerialSet={placed}
                disabledRemove={tiers.length === 1}
                onRename={handleRenameTier}
                onChangeColor={handleTierColor}
                onMoveTier={handleMoveTier}
                onRemoveTier={handleRemoveTier}
                onAssign={moveCard}
                nameWidth={nameWidth}
                onResizeNameWidth={commitNameWidth}
                onPreviewNameWidth={previewNameWidth}
              />
            ))}
          </div>

          <CardPool cards={cards} tiers={tiers} placed={placed} onMove={moveCard} />
        </div>

        <BoardDragOverlay card={activeCard} badge={activeTier?.name} />

        <p role="status" aria-live="polite" className="sr-only">
          {announcement}
        </p>
      </DndContext>

      <SnapshotPanel
        open={snapshotsOpen}
        onClose={() => setSnapshotsOpen(false)}
        snapshots={snapshots}
        onRestore={handleRestoreSnapshot}
        onDelete={handleDeleteSnapshot}
      />

      <ConfirmDialog
        open={confirm !== null}
        title={confirm?.kind === 'removeTier' ? '删除档位' : '重置榜单'}
        message={
          confirm?.kind === 'removeTier'
            ? `「${confirm.tier.name}」档中还有 ${confirm.tier.cards.length} 张卡片，删除后这些卡片会回到角色池。删除前会自动保存一份快照。`
            : '重置会清空所有已放置的卡片，恢复默认的 6 个档位与默认标题。重置前会自动保存一份快照。'
        }
        confirmLabel={confirm?.kind === 'removeTier' ? '删除' : '重置'}
        onConfirm={handleConfirm}
        onCancel={() => setConfirm(null)}
      />

      <ImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onConfirm={handleImport}
      />
    </div>
  );
}
