/**
 * Import dialog (design §6.6): pick a JSON file, show exactly why it cannot be
 * imported, preview what will replace the board, then confirm.
 *
 * Nothing is written to the board here: the caller snapshots the current board
 * and dispatches the load, so the dialog stays a pure preview surface.
 */

import { useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { parseFile, type TierFile } from '../../lib/tier/importExport';

/** Files above this size are rejected before parsing. */
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

type ImportState =
  | { kind: 'empty' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; file: TierFile; warnings: string[]; cardCount: number };

export type ImportDialogProps = {
  open: boolean;
  onClose: () => void;
  /** Called only after the user confirms the preview. */
  onConfirm: (file: TierFile) => void;
};

export function ImportDialog({ open, onClose, onConfirm }: ImportDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<ImportState>({ kind: 'empty' });
  const [busy, setBusy] = useState(false);
  /**
   * Bumped by every `reset()` and every new selection, so a `file.text()`
   * promise that resolves after the dialog was closed (or after another file
   * was chosen) cannot resurrect a cancelled preview.
   */
  const requestId = useRef(0);

  const reset = (): void => {
    requestId.current += 1;
    setState({ kind: 'empty' });
    setBusy(false);
    // Clearing the value lets the same file be picked again after a close.
    if (inputRef.current !== null) {
      inputRef.current.value = '';
    }
  };

  const handleClose = (): void => {
    reset();
    onClose();
  };

  const handleFile = async (file: File): Promise<void> => {
    requestId.current += 1;
    const request = requestId.current;

    if (file.size > MAX_IMPORT_BYTES) {
      const megabytes = (file.size / (1024 * 1024)).toFixed(1);
      setState({
        kind: 'error',
        message: `文件过大（${megabytes} MB），最大支持 2 MB`,
      });
      return;
    }

    setBusy(true);
    try {
      const text = await file.text();
      if (requestId.current !== request) {
        return;
      }

      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch {
        setState({
          kind: 'error',
          message: '文件不是合法的 JSON，请确认选择的是导出的 .json 文件',
        });
        return;
      }

      const parsed = parseFile(raw);
      if (!parsed.ok) {
        setState({ kind: 'error', message: parsed.error });
        return;
      }

      const cardCount = parsed.file.tiers.reduce((total, tier) => total + tier.cards.length, 0);
      setState({ kind: 'ready', file: parsed.file, warnings: parsed.warnings, cardCount });
    } catch {
      if (requestId.current === request) {
        setState({ kind: 'error', message: '读取文件失败，请重试' });
      }
    } finally {
      if (requestId.current === request) {
        setBusy(false);
      }
    }
  };

  const handleChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    // Clear before parsing: without it picking the same path again after an
    // error would not fire `change`, so the dialog could not recover.
    event.target.value = '';
    if (file === undefined) {
      return;
    }
    void handleFile(file);
  };

  const handleConfirm = (): void => {
    if (state.kind !== 'ready') {
      return;
    }
    const { file } = state;
    reset();
    onConfirm(file);
  };

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      title="导入 JSON"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={handleClose}>
            取消
          </Button>
          <Button size="sm" onClick={handleConfirm} disabled={state.kind !== 'ready'}>
            确认导入
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="leading-relaxed">
          选择之前导出的节奏榜 JSON 文件。确认导入会覆盖当前榜单，导入前会自动保存一份快照。
        </p>

        <input
          ref={inputRef}
          type="file"
          accept="application/json,.json"
          aria-label="选择节奏榜 JSON 文件"
          className="sr-only"
          onChange={handleChange}
        />

        <div>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            选择文件
          </Button>
        </div>

        {state.kind === 'empty' ? <p>还没有选择文件。</p> : null}

        {state.kind === 'error' ? (
          <p
            role="alert"
            className="rounded-lg border border-[color:var(--bl-danger)] bg-[#2a1113] px-3 py-2 text-xs text-[#fecdd3]"
          >
            {state.message}
          </p>
        ) : null}

        {state.kind === 'ready' ? (
          <div className="flex flex-col gap-2">
            <p className="text-[var(--bl-text)]">
              已读取：{state.file.tiers.length} 个档位 · {state.cardCount} 张卡片
            </p>
            {state.warnings.length > 0 ? (
              <ul className="list-disc pl-5 text-xs text-[#fbbf24]">
                {state.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            ) : (
              <p className="text-xs">没有需要注意的问题。</p>
            )}
            <p className="text-xs">标题「{state.file.title.trim() === '' ? '我的节奏榜' : state.file.title}」将替换当前榜单标题。</p>
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}
