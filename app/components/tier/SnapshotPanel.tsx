import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import type { Snapshot } from '../../lib/tier/snapshots';

type SnapshotPanelProps = {
  open: boolean;
  onClose: () => void;
  snapshots: readonly Snapshot[];
  onRestore: (id: string) => void;
  onDelete: (id: string) => void;
};

function formatTime(createdAt: string): string {
  const date = new Date(createdAt);
  return Number.isNaN(date.getTime()) ? createdAt : date.toLocaleString('zh-CN');
}

/** Snapshot history drawer (design §6.5): newest first, restore or delete. */
export function SnapshotPanel({
  open,
  onClose,
  snapshots,
  onRestore,
  onDelete,
}: SnapshotPanelProps) {
  return (
    <Dialog open={open} onClose={onClose} title="快照历史">
      {snapshots.length === 0 ? (
        <p>还没有快照</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {snapshots.map((snapshot) => (
            <li
              key={snapshot.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[color:var(--bl-border)] p-3"
            >
              <div className="flex min-w-0 flex-col gap-0.5">
                <p className="truncate text-sm font-medium text-[var(--bl-text)]">
                  {snapshot.label}
                </p>
                <p className="text-xs">{formatTime(snapshot.createdAt)}</p>
                <p className="text-xs">
                  {snapshot.cardCount} 张卡 / {snapshot.tierCount} 个档位
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={() => onRestore(snapshot.id)}
                  aria-label={`恢复快照 ${snapshot.label}`}
                >
                  恢复
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => onDelete(snapshot.id)}
                  aria-label={`删除快照 ${snapshot.label}`}
                >
                  删除
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
