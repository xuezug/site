import { act, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { useMemo } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImportDialog, MAX_IMPORT_BYTES } from '../../app/components/tier/ImportDialog';
import { TierBoard } from '../../app/components/tier/TierBoard';
import { useBoard } from '../../app/components/tier/useBoard';
import { ToastProvider } from '../../app/components/ui/Toast';
import type { Card } from '../../app/lib/cards/types';
import type { Board } from '../../app/lib/tier/model';
import { CURRENT_BOARD_KEY, SNAPSHOTS_KEY } from '../../app/lib/tier/storage';

/**
 * Component tests for the tier board. jsdom cannot produce real pointer drags,
 * so placement goes through the「＋」menu — the same code path keyboard and
 * touch users take — while editing/confirmation/persistence are exercised
 * through the rendered UI.
 */

function makeCard(
  serial: number,
  name: string,
  star: number,
  attribute: Card['attribute'],
): Card {
  return {
    serial,
    looks: serial + 1000,
    name,
    uniqueId: serial,
    star,
    maxStar: 5,
    attribute,
    attributes: [attribute],
    faction: 'sanctuary',
    career: 'warrior',
    careerOptions: ['战士'],
    gender: 'female',
    skinOf: null,
    iconPath: `card_icons/${serial}_1.png`,
  };
}

const CARDS: Card[] = [
  makeCard(1, '夜刃', 3, 'dark'),
  makeCard(2, '月季院', 5, 'light'),
  makeCard(3, '血蔷薇', 4, 'fire'),
];

function Harness({ cards = CARDS }: { cards?: Card[] }) {
  const cardsById = useMemo(() => new Map(cards.map((card) => [card.serial, card])), [cards]);
  const { board, dispatch, restoreSnapshot, saveSnapshot, saveError, remoteUpdateAt, acknowledgeRemoteUpdate } =
    useBoard(cardsById);

  const handleReset = (): void => {
    // Mirrors the route: snapshot the pre-reset board, then reset.
    saveSnapshot('重置前');
    dispatch({ type: 'reset' });
  };

  return (
    <ToastProvider>
      <TierBoard
        cards={cards}
        board={board}
        dispatch={dispatch}
        onSnapshot={saveSnapshot}
        onRestore={restoreSnapshot}
        onReset={handleReset}
        saveError={saveError}
        remoteUpdateAt={remoteUpdateAt}
        onRemoteUpdateAcknowledged={acknowledgeRemoteUpdate}
      />
    </ToastProvider>
  );
}

function renderBoard() {
  return render(<Harness />);
}

function tierIds(): string[] {
  return screen
    .queryAllByTestId(/^tier-/)
    .map((element) => element.getAttribute('data-testid') ?? '');
}

function tierRow(id: string): HTMLElement {
  return screen.getByTestId(`tier-${id}`);
}

function pool(): HTMLElement {
  return screen.getByRole('region', { name: '角色池' });
}

function openSettings(tierName: string): void {
  fireEvent.click(screen.getByLabelText(`${tierName} 档位设置`));
}

function assignCard(cardName: string, tierName: string): void {
  fireEvent.click(screen.getByLabelText(`${cardName} 放入档位`));
  fireEvent.click(screen.getByRole('menuitem', { name: `放入 ${tierName} 档` }));
}

type StoredSnapshot = {
  label: string;
  cardCount: number;
  tierCount: number;
  board: Board;
};

function readCurrent(): Board | null {
  const raw = window.localStorage.getItem(CURRENT_BOARD_KEY);
  return raw === null ? null : (JSON.parse(raw) as Board);
}

function readSnapshots(): StoredSnapshot[] {
  const raw = window.localStorage.getItem(SNAPSHOTS_KEY);
  return raw === null ? [] : (JSON.parse(raw) as StoredSnapshot[]);
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('TierBoard layout', () => {
  it('renders the six default tiers and every card in the pool', () => {
    renderBoard();

    expect(tierIds()).toEqual([
      'tier-t-s',
      'tier-t-a',
      'tier-t-b',
      'tier-t-c',
      'tier-t-d',
      'tier-t-f',
    ]);
    expect(screen.getAllByTestId(/^tier-/)).toHaveLength(6);

    const poolRegion = pool();
    expect(within(poolRegion).getAllByRole('listitem')).toHaveLength(CARDS.length);
    expect(within(poolRegion).getByText('夜刃')).toBeInTheDocument();
    expect(within(poolRegion).getByText('月季院')).toBeInTheDocument();
    expect(within(poolRegion).getByText('血蔷薇')).toBeInTheDocument();
    // §8/§11: image alt text carries name, star and attribute.
    expect(within(poolRegion).getByAltText('夜刃（3 星 暗）')).toBeInTheDocument();
    expect(poolRegion).toHaveTextContent('共 3 张 · 全站已上榜 0 张');
    expect(screen.getByLabelText('榜单标题')).toHaveValue('我的节奏榜');
  });

  it('adds tiers and disables the button once twelve exist', () => {
    renderBoard();
    const addButton = screen.getByRole('button', { name: '添加档位' });

    fireEvent.click(addButton);
    expect(tierIds()).toHaveLength(7);
    expect(screen.getByLabelText('重命名档位 新档位')).toBeInTheDocument();

    for (let index = 0; index < 5; index += 1) {
      fireEvent.click(addButton);
    }

    expect(tierIds()).toHaveLength(12);
    expect(screen.getByRole('button', { name: '添加档位' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '添加档位' })).toHaveAttribute(
      'title',
      '最多 12 个档位',
    );
  });
});

describe('tier editing', () => {
  it('renames on Enter, cancels on Escape and keeps the old name for blank input', () => {
    renderBoard();

    fireEvent.click(screen.getByLabelText('重命名档位 S'));
    const input = screen.getByLabelText('档位名称 S');
    fireEvent.change(input, { target: { value: '主力' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(screen.getByLabelText('重命名档位 主力')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('重命名档位 主力'));
    const escaping = screen.getByLabelText('档位名称 主力');
    fireEvent.change(escaping, { target: { value: '临时' } });
    fireEvent.keyDown(escaping, { key: 'Escape' });

    expect(screen.getByLabelText('重命名档位 主力')).toBeInTheDocument();
    expect(screen.queryByLabelText('档位名称 主力')).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('重命名档位 主力'));
    const blank = screen.getByLabelText('档位名称 主力');
    fireEvent.change(blank, { target: { value: '   ' } });
    fireEvent.keyDown(blank, { key: 'Enter' });

    expect(screen.getByLabelText('重命名档位 主力')).toBeInTheDocument();
  });

  it('changes a tier colour from the settings picker and from a preset swatch', () => {
    renderBoard();

    openSettings('S');
    const details = within(tierRow('t-s')).getByText('设置').closest('details');
    expect(details).not.toBeNull();
    expect(within(details as HTMLElement).getByLabelText('S 档颜色')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('S 档颜色'), { target: { value: '#14b8a6' } });
    expect(screen.getByLabelText('S 档颜色')).toHaveValue('#14b8a6');

    fireEvent.click(within(tierRow('t-s')).getByRole('button', { name: '颜色 #ec4899' }));

    expect(screen.getByLabelText('S 档颜色')).toHaveValue('#ec4899');
  });

  it('moves a tier up and down and disables the edge directions', () => {
    renderBoard();

    openSettings('A');
    fireEvent.click(within(tierRow('t-a')).getByRole('button', { name: '上移' }));

    expect(tierIds().slice(0, 2)).toEqual(['tier-t-a', 'tier-t-s']);
    expect(within(tierRow('t-a')).getByRole('button', { name: '上移' })).toBeDisabled();

    fireEvent.click(within(tierRow('t-a')).getByRole('button', { name: '下移' }));

    expect(tierIds().slice(0, 2)).toEqual(['tier-t-s', 'tier-t-a']);
    expect(within(tierRow('t-f')).getByRole('button', { name: '下移' })).toBeDisabled();
  });
});

describe('tier removal', () => {
  it('deletes an empty tier immediately, without a confirmation', () => {
    renderBoard();

    openSettings('S');
    fireEvent.click(within(tierRow('t-s')).getByRole('button', { name: '删除档位' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByTestId('tier-t-s')).not.toBeInTheDocument();
    expect(tierIds()).toHaveLength(5);
  });

  it('confirms before deleting a non-empty tier, snapshots it, and returns cards to the pool', () => {
    renderBoard();
    assignCard('夜刃', 'S');

    openSettings('S');
    fireEvent.click(within(tierRow('t-s')).getByRole('button', { name: '删除档位' }));

    const dialog = screen.getByRole('dialog', { name: '删除档位' });
    expect(dialog).toHaveTextContent('「S」档中还有 1 张卡片');
    fireEvent.click(within(dialog).getByRole('button', { name: '删除' }));

    expect(screen.queryByTestId('tier-t-s')).not.toBeInTheDocument();
    expect(within(pool()).getByText('夜刃')).toBeInTheDocument();

    const [snapshot] = readSnapshots();
    expect(snapshot?.label).toBe('删除档位');
    expect(snapshot?.cardCount).toBe(1);
    expect(snapshot?.tierCount).toBe(6);
  });

  it('keeps at least one tier and explains why delete is disabled', () => {
    renderBoard();

    for (const [id, name] of [
      ['t-s', 'S'],
      ['t-a', 'A'],
      ['t-b', 'B'],
      ['t-c', 'C'],
      ['t-d', 'D'],
    ] as const) {
      openSettings(name);
      fireEvent.click(within(tierRow(id)).getByRole('button', { name: '删除档位' }));
    }

    expect(tierIds()).toEqual(['tier-t-f']);
    openSettings('F');
    const remove = within(tierRow('t-f')).getByRole('button', { name: '删除档位' });

    expect(remove).toBeDisabled();
    expect(remove).toHaveAttribute('title', '至少保留一个档位');
    expect(tierRow('t-f')).toHaveTextContent('至少保留一个档位');
  });
});

describe('toolbar and snapshots', () => {
  it('resets to the default board after confirmation and keeps a snapshot', () => {
    renderBoard();
    fireEvent.click(screen.getByRole('button', { name: '添加档位' }));
    expect(tierIds()).toHaveLength(7);

    fireEvent.click(screen.getByRole('button', { name: '重置' }));
    const dialog = screen.getByRole('dialog', { name: '重置榜单' });
    fireEvent.click(within(dialog).getByRole('button', { name: '重置' }));

    expect(tierIds()).toHaveLength(6);
    expect(readSnapshots()[0]?.label).toBe('重置前');
  });

  it('saves a manual snapshot and restores it from the history panel', () => {
    renderBoard();
    fireEvent.click(screen.getByRole('button', { name: '添加档位' }));
    expect(tierIds()).toHaveLength(7);

    fireEvent.click(screen.getByRole('button', { name: '保存快照' }));
    expect(readSnapshots()[0]?.label).toBe('手动快照');

    fireEvent.click(screen.getByRole('button', { name: '添加档位' }));
    expect(tierIds()).toHaveLength(8);

    fireEvent.click(screen.getByRole('button', { name: '快照历史' }));
    const dialog = screen.getByRole('dialog', { name: '快照历史' });
    expect(dialog).toHaveTextContent('手动快照');
    expect(dialog).toHaveTextContent('7 个档位');

    fireEvent.click(within(dialog).getByRole('button', { name: '恢复快照 手动快照' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(tierIds()).toHaveLength(7);
  });

  it('deletes a snapshot from the history panel and shows the empty state', () => {
    renderBoard();
    fireEvent.click(screen.getByRole('button', { name: '保存快照' }));

    fireEvent.click(screen.getByRole('button', { name: '快照历史' }));
    const dialog = screen.getByRole('dialog', { name: '快照历史' });
    fireEvent.click(within(dialog).getByRole('button', { name: '删除快照 手动快照' }));

    expect(dialog).toHaveTextContent('还没有快照');
    expect(readSnapshots()).toEqual([]);
  });

  it('edits the board title and falls back when it is blank', () => {
    renderBoard();
    const input = screen.getByLabelText('榜单标题');

    fireEvent.change(input, { target: { value: '冬季榜' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(input).toHaveValue('冬季榜');

    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(input).toHaveValue('冬季榜');
  });
});

describe('JSON import wiring', () => {
  it('previews the file, snapshots the old board and replaces it on confirm', async () => {
    renderBoard();
    fireEvent.click(screen.getByRole('button', { name: '导入' }));

    const dialog = screen.getByRole('dialog', { name: '导入 JSON' });
    const input = within(dialog).getByLabelText('选择节奏榜 JSON 文件');
    const file = new File(
      [
        JSON.stringify({
          format: 'bl-tier',
          version: 1,
          title: '导入的榜',
          updatedAt: '2026-11-01T12:00:00.000Z',
          tiers: [
            { id: 't-s', name: '主力', color: '#14b8a6', cards: [{ serial: 2, name: '月季院' }] },
            { id: 't-x', name: '备用', color: '#ec4899', cards: [] },
          ],
        }),
      ],
      'bl-tier.json',
      { type: 'application/json' },
    );
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    fireEvent.change(input);

    await waitFor(() => {
      expect(dialog).toHaveTextContent('2 个档位 · 1 张卡片');
    });
    fireEvent.click(within(dialog).getByRole('button', { name: '确认导入' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(tierIds()).toEqual(['tier-t-s', 'tier-t-x']);
    expect(tierRow('t-s')).toHaveTextContent('主力');
    expect(tierRow('t-s')).toHaveTextContent('月季院');
    expect(screen.getByLabelText('榜单标题')).toHaveValue('导入的榜');

    const [snapshot] = readSnapshots();
    expect(snapshot?.label).toBe('导入前');
    expect(snapshot?.board.tiers[0]?.name).toBe('S');
    expect(screen.getByText('已导入')).toBeInTheDocument();
  });
});

describe('ImportDialog', () => {
  const VALID_FILE = JSON.stringify({
    format: 'bl-tier',
    version: 1,
    title: '导入的榜',
    updatedAt: '2026-11-01T12:00:00.000Z',
    tiers: [{ id: 't-s', name: 'S', color: '#e11d48', cards: [{ serial: 1, name: '夜刃' }] }],
  });

  function choose(input: HTMLInputElement, file: File): void {
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    fireEvent.change(input);
  }

  function openDialog() {
    const onClose = vi.fn();
    const onConfirm = vi.fn();
    render(<ImportDialog open onClose={onClose} onConfirm={onConfirm} />);
    const dialog = screen.getByRole('dialog', { name: '导入 JSON' });
    const input = within(dialog).getByLabelText('选择节奏榜 JSON 文件') as HTMLInputElement;
    return { onClose, onConfirm, input };
  }

  it('rejects files above 2 MB without reading them', async () => {
    const { input } = openDialog();
    const file = new File(['{}'], 'big.json', { type: 'application/json' });
    Object.defineProperty(file, 'size', { value: MAX_IMPORT_BYTES + 1 });
    const text = vi.spyOn(file, 'text');

    choose(input, file);

    expect(await screen.findByRole('alert')).toHaveTextContent('文件过大');
    expect(text).not.toHaveBeenCalled();
  });

  it('accepts a file exactly at the 2 MB limit', async () => {
    const { input } = openDialog();
    const file = new File([VALID_FILE], 'limit.json', { type: 'application/json' });
    Object.defineProperty(file, 'size', { value: MAX_IMPORT_BYTES });

    choose(input, file);

    await waitFor(() => {
      expect(screen.getByText(/已读取：1 个档位/)).toBeInTheDocument();
    });
  });

  it('re-runs the handler when the same file is picked again after an error', async () => {
    const { input } = openDialog();
    const file = new File(['not json'], 'broken.json', { type: 'application/json' });
    const text = vi.spyOn(file, 'text');

    choose(input, file);
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('不是合法的 JSON');
    });
    // Clearing the value is what lets the browser fire `change` again.
    expect(input.value).toBe('');

    choose(input, file);
    await waitFor(() => {
      expect(text).toHaveBeenCalledTimes(2);
    });
  });

  it('ignores a read that resolves after the dialog was closed', async () => {
    const { input, onClose } = openDialog();
    let resolveText: (value: string) => void = () => undefined;
    const pending = new Promise<string>((resolve) => {
      resolveText = resolve;
    });
    const file = new File([''], 'slow.json', { type: 'application/json' });
    vi.spyOn(file, 'text').mockReturnValue(pending);

    choose(input, file);
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(onClose).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveText(VALID_FILE);
      await pending;
    });

    expect(screen.queryByText(/已读取/)).not.toBeInTheDocument();
    expect(screen.getByText('还没有选择文件。')).toBeInTheDocument();
  });
});

describe('keyboard placement via the「＋」menu', () => {
  it('puts a pool card into a tier and announces the result', () => {
    renderBoard();

    assignCard('夜刃', 'S');

    const row = tierRow('t-s');
    expect(within(row).getByText('夜刃')).toBeInTheDocument();
    // §6.1: placed cards stay in the pool, dimmed, with their tier as a badge.
    const poolTile = within(pool()).getByLabelText('夜刃，3 星，暗，已在 S 档').closest('li');
    expect(poolTile).not.toBeNull();
    expect(poolTile?.querySelector('.opacity-40')).not.toBeNull();
    expect(screen.getByText('夜刃 已放入 S 档')).toBeInTheDocument();
    expect(within(row).getByLabelText('夜刃，3 星，暗，当前在 S 档')).toBeInTheDocument();
    expect(pool()).toHaveTextContent('已上榜 1 张');
  });

  it('moves a placed card back to the pool', () => {
    renderBoard();
    assignCard('夜刃', 'S');

    fireEvent.click(within(tierRow('t-s')).getByLabelText('夜刃 放入档位'));
    fireEvent.click(screen.getByRole('menuitem', { name: '移出榜单' }));

    expect(within(pool()).getByLabelText('夜刃，3 星，暗，未上榜')).toBeInTheDocument();
    expect(screen.getByText('夜刃 已移出榜单')).toBeInTheDocument();
    expect(pool()).toHaveTextContent('已上榜 0 张');
  });
});

describe('card menu focus contract', () => {
  it('focuses the first item on open and Escape closes it back onto the trigger', () => {
    renderBoard();
    const trigger = screen.getByLabelText('夜刃 放入档位');

    fireEvent.click(trigger);

    const items = screen.getAllByRole('menuitem');
    expect(items).toHaveLength(6);
    expect(document.activeElement).toBe(items[0]);
    expect(items[0]).toHaveTextContent('放入 S 档');

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger);
  });

  it('roves with arrows/Home/End and closes when focus leaves the menu', () => {
    renderBoard();
    fireEvent.click(screen.getByLabelText('夜刃 放入档位'));
    const items = screen.getAllByRole('menuitem');
    const first = items[0];
    const second = items[1];
    const last = items[items.length - 1];

    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(second);

    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'End' });
    expect(document.activeElement).toBe(last);

    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Home' });
    expect(document.activeElement).toBe(first);

    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(last);

    act(() => {
      screen.getByLabelText('榜单标题').focus();
    });

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});

describe('persistence', () => {
  it('writes changes after a 300ms debounce and reloads them on remount', () => {
    vi.useFakeTimers();
    const view = renderBoard();

    fireEvent.click(screen.getByRole('button', { name: '添加档位' }));

    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(window.localStorage.getItem(CURRENT_BOARD_KEY)).toBeNull();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(readCurrent()?.tiers).toHaveLength(7);

    view.unmount();
    renderBoard();

    expect(tierIds()).toHaveLength(7);
  });

  it('edits the title, persists it, and restores the stored title on remount', () => {
    vi.useFakeTimers();
    const view = renderBoard();

    const input = screen.getByLabelText('榜单标题');
    fireEvent.change(input, { target: { value: '冬季榜' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(readCurrent()?.title).toBe('冬季榜');

    view.unmount();
    renderBoard();
    expect(screen.getByLabelText('榜单标题')).toHaveValue('冬季榜');
  });

  it('reports a failed write without throwing', () => {
    vi.useFakeTimers();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota exceeded', 'QuotaExceededError');
    });

    renderBoard();
    fireEvent.click(screen.getByRole('button', { name: '添加档位' }));
    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(screen.getByRole('alert')).toHaveTextContent('保存失败');
  });

  it('flushes a pending debounced write when the board unmounts', () => {
    vi.useFakeTimers();
    const view = renderBoard();

    fireEvent.click(screen.getByRole('button', { name: '添加档位' }));
    expect(window.localStorage.getItem(CURRENT_BOARD_KEY)).toBeNull();

    view.unmount();

    expect(readCurrent()?.tiers).toHaveLength(7);
  });

  it('clears the load warning after the next successful save', () => {
    vi.useFakeTimers();
    window.localStorage.setItem(CURRENT_BOARD_KEY, '{not json');
    renderBoard();

    expect(screen.getByRole('alert')).toHaveTextContent('损坏');

    fireEvent.click(screen.getByRole('button', { name: '添加档位' }));
    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(readCurrent()?.tiers).toHaveLength(7);
  });

  it('shows the storage error and uses the default board when the payload is corrupt', () => {
    window.localStorage.setItem(CURRENT_BOARD_KEY, '{not json');

    renderBoard();

    expect(screen.getByRole('alert')).toHaveTextContent('损坏');
    expect(tierIds()).toHaveLength(6);
  });

  it('adopts a board written by another tab and shows the sync toast', () => {
    renderBoard();
    const remote: Board = {
      version: 1,
      title: '另一标签页的榜',
      tiers: [{ id: 't-s', name: 'S', color: '#e11d48', cards: [1] }],
      updatedAt: '2030-01-01T00:00:00.000Z',
    };

    act(() => {
      window.localStorage.setItem(CURRENT_BOARD_KEY, JSON.stringify(remote));
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: CURRENT_BOARD_KEY,
          newValue: JSON.stringify(remote),
        }),
      );
    });

    expect(screen.getByLabelText('榜单标题')).toHaveValue('另一标签页的榜');
    expect(within(tierRow('t-s')).getByText('夜刃')).toBeInTheDocument();
    expect(screen.getByText('另一标签页更新了榜单，已同步')).toBeInTheDocument();
  });
});

describe('cross-tab sync', () => {
  function hook(): { cardsById: ReadonlyMap<number, Card> } {
    return { cardsById: new Map(CARDS.map((card) => [card.serial, card])) };
  }

  it('applies a storage event and exposes its updatedAt until acknowledged', () => {
    const { result } = renderHook(() => useBoard(hook().cardsById));
    const remote: Board = {
      version: 1,
      title: '另一标签页的榜',
      tiers: [{ id: 't-s', name: 'S', color: '#e11d48', cards: [2] }],
      updatedAt: '2030-01-01T00:00:00.000Z',
    };

    act(() => {
      window.localStorage.setItem(CURRENT_BOARD_KEY, JSON.stringify(remote));
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: CURRENT_BOARD_KEY,
          newValue: JSON.stringify(remote),
        }),
      );
    });

    expect(result.current.board.title).toBe('另一标签页的榜');
    expect(result.current.board.tiers[0]?.cards).toEqual([2]);
    expect(result.current.remoteUpdateAt).toBe(remote.updatedAt);

    act(() => {
      result.current.acknowledgeRemoteUpdate();
    });
    expect(result.current.remoteUpdateAt).toBeNull();
  });

  it('stays quiet when another tab re-writes identical content', () => {
    const { result } = renderHook(() => useBoard(hook().cardsById));
    const echo: Board = { ...result.current.board, updatedAt: '2030-01-02T00:00:00.000Z' };

    act(() => {
      window.localStorage.setItem(CURRENT_BOARD_KEY, JSON.stringify(echo));
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: CURRENT_BOARD_KEY,
          newValue: JSON.stringify(echo),
        }),
      );
    });

    expect(result.current.remoteUpdateAt).toBeNull();
  });

  it('ignores foreign keys, removals and malformed payloads', () => {
    const { result } = renderHook(() => useBoard(hook().cardsById));

    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', { key: 'bl.tier.snapshots.v1', newValue: '{"x":1}' }),
      );
      window.dispatchEvent(new StorageEvent('storage', { key: CURRENT_BOARD_KEY, newValue: null }));
      window.localStorage.setItem(CURRENT_BOARD_KEY, '{not json');
      window.dispatchEvent(
        new StorageEvent('storage', { key: CURRENT_BOARD_KEY, newValue: '{not json' }),
      );
    });

    expect(result.current.board.title).toBe('我的节奏榜');
    expect(result.current.remoteUpdateAt).toBeNull();
  });
});
