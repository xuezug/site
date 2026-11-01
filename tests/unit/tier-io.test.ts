import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Card } from '../../app/lib/cards/types';
import { iconUrl } from '../../app/lib/cards/icon';
import {
  downloadJson,
  exportFileName,
  importToBoard,
  parseFile,
  toFile,
  type TierFile,
} from '../../app/lib/tier/importExport';
import { exportPng, ICON_TIMEOUT_MS, iconFetchUrl, iconSignal } from '../../app/lib/tier/exportImage';
import { MAX_TIERS, type Board } from '../../app/lib/tier/model';

/**
 * Round-trip and validation tests for the JSON import/export plus the PNG
 * export pipeline (design §6.6). Only external boundaries are mocked: `fetch`,
 * `modern-screenshot` and the object-URL APIs; the board, the schema and the
 * rendered export tree are the real implementations.
 */

const screenshot = vi.hoisted(() => ({ domToPng: vi.fn() }));

vi.mock('modern-screenshot', () => ({ domToPng: screenshot.domToPng }));

const CARDS: Card[] = [
  {
    serial: 1,
    looks: 1026,
    name: '夜刃',
    uniqueId: 1,
    star: 3,
    maxStar: 5,
    attribute: 'dark',
    attributes: ['dark'],
    faction: 'sanctuary',
    career: 'warrior',
    careerOptions: ['战士'],
    gender: 'female',
    skinOf: null,
    iconPath: 'card_icons/1_10261.png',
  },
  {
    serial: 2,
    looks: 1027,
    name: '月季院',
    uniqueId: 1,
    star: 5,
    maxStar: 5,
    attribute: 'light',
    attributes: ['light'],
    faction: 'sanctuary',
    career: 'mage',
    careerOptions: ['法师'],
    gender: 'female',
    skinOf: null,
    iconPath: 'card_icons/2_10271.png',
  },
  {
    serial: 3,
    looks: 1028,
    name: '血蔷薇',
    uniqueId: 1,
    star: 4,
    maxStar: 5,
    attribute: 'fire',
    attributes: ['fire'],
    faction: 'alien',
    career: 'assassin',
    careerOptions: ['刺客'],
    gender: 'female',
    skinOf: null,
    iconPath: 'card_icons/3_10281.png',
  },
];

const CARDS_BY_SERIAL = new Map(CARDS.map((card) => [card.serial, card]));

/** Serials 1–10 are real catalogue entries, so `parseFile` keeps them. */
function manyCards(): Card[] {
  return Array.from({ length: 10 }, (_, index) => ({
    ...(CARDS[0] as Card),
    serial: index + 1,
    name: `卡片${index + 1}`,
    iconPath: `card_icons/${index + 1}_icon.png`,
  }));
}

function makeBoard(): Board {
  return {
    version: 1,
    title: '我的节奏榜',
    updatedAt: '2026-11-01T12:00:00.000Z',
    tiers: [
      { id: 't-s', name: 'S', color: '#e11d48', cards: [1, 2] },
      { id: 't-a', name: 'A', color: '#f97316', cards: [3] },
      { id: 't-custom', name: '待定', color: '#22c55e', cards: [] },
    ],
  };
}

/** A JSON round-tripped payload, so tests mutate what the app would read. */
function rawFile(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(toFile(makeBoard(), CARDS_BY_SERIAL))) as Record<
    string,
    unknown
  >;
}

function rawTiers(raw: Record<string, unknown>): Record<string, unknown>[] {
  return raw.tiers as Record<string, unknown>[];
}

function rawCards(raw: Record<string, unknown>, tierIndex: number): Record<string, unknown>[] {
  return (rawTiers(raw)[tierIndex]?.cards ?? []) as Record<string, unknown>[];
}

function expectError(raw: unknown, fragment: string): void {
  const result = parseFile(raw);
  expect(result.ok).toBe(false);
  if (result.ok) {
    throw new Error('expected the file to be rejected');
  }
  expect(result.error).toContain(fragment);
}

function expectOk(raw: unknown): { file: TierFile; warnings: string[] } {
  const result = parseFile(raw);
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(`expected a valid file, got: ${result.error}`);
  }
  return result;
}

describe('toFile', () => {
  it('writes the documented shape with cards in tier order', () => {
    const file = toFile(makeBoard(), CARDS_BY_SERIAL);

    expect(file.format).toBe('bl-tier');
    expect(file.version).toBe(1);
    expect(file.title).toBe('我的节奏榜');
    expect(file.updatedAt).toBe('2026-11-01T12:00:00.000Z');
    expect(file.tiers.map((tier) => tier.id)).toEqual(['t-s', 't-a', 't-custom']);
    expect(file.tiers[0]?.cards).toEqual([
      { serial: 1, name: '夜刃' },
      { serial: 2, name: '月季院' },
    ]);
    expect(file.tiers[1]?.cards).toEqual([{ serial: 3, name: '血蔷薇' }]);
    expect(file.tiers[2]?.cards).toEqual([]);
  });

  it('falls back to the serial when the card is missing from the catalogue', () => {
    const board = makeBoard();
    const file = toFile(board, new Map());

    expect(file.tiers[0]?.cards).toEqual([
      { serial: 1, name: '#1' },
      { serial: 2, name: '#2' },
    ]);
  });
});

describe('round trip', () => {
  it('restores tier order, names, colours and card order', () => {
    const original = makeBoard();
    const parsed = expectOk(JSON.parse(JSON.stringify(toFile(original, CARDS_BY_SERIAL))));

    expect(parsed.warnings).toEqual([]);

    const restored = importToBoard(parsed.file);
    expect(restored.title).toBe(original.title);
    expect(restored.tiers.map((tier) => tier.id)).toEqual(['t-s', 't-a', 't-custom']);
    expect(restored.tiers.map((tier) => tier.name)).toEqual(['S', 'A', '待定']);
    expect(restored.tiers.map((tier) => tier.color)).toEqual(['#e11d48', '#f97316', '#22c55e']);
    expect(restored.tiers.map((tier) => tier.cards)).toEqual([[1, 2], [3], []]);
  });

  it('stamps a fresh updatedAt and falls back to the default title', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-02T03:04:05.000Z'));
    try {
      const file = toFile(makeBoard(), CARDS_BY_SERIAL);
      const restored = importToBoard({ ...file, title: '   ' });

      expect(restored.title).toBe('我的节奏榜');
      expect(restored.updatedAt).toBe('2026-11-02T03:04:05.000Z');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('parseFile — rejected files', () => {
  it('rejects a file whose format is not bl-tier', () => {
    const raw = rawFile();
    raw.format = 'bl-board';

    expectError(raw, '不是血族节奏榜文件');
  });

  it('rejects an unsupported version', () => {
    const raw = rawFile();
    raw.version = 2;

    expectError(raw, '版本');
  });

  it('rejects an empty tier list and more than twelve tiers', () => {
    const empty = rawFile();
    empty.tiers = [];
    expectError(empty, '档位数量');

    const tooMany = rawFile();
    tooMany.tiers = Array.from({ length: MAX_TIERS + 1 }, (_, index) => ({
      id: `t-${index}`,
      name: `档位${index}`,
      color: '#ffffff',
      cards: [],
    }));
    expectError(tooMany, '档位数量');
  });

  it('rejects duplicate tier ids and names the offending tier', () => {
    const raw = rawFile();
    const tiers = rawTiers(raw);
    const second = tiers[1];
    if (second === undefined) {
      throw new Error('fixture is missing the second tier');
    }
    second.id = 't-s';

    expectError(raw, '第 2 个档位');
    expectError(raw, '重复');
  });

  it('rejects a blank tier name and names the offending tier', () => {
    const raw = rawFile();
    const first = rawTiers(raw)[0];
    if (first === undefined) {
      throw new Error('fixture is missing the first tier');
    }
    first.name = '   ';

    expectError(raw, '第 1 个档位的名称不能为空');
  });

  it('rejects a colour that is not hex', () => {
    const raw = rawFile();
    const first = rawTiers(raw)[0];
    if (first === undefined) {
      throw new Error('fixture is missing the first tier');
    }
    first.color = 'red';

    expectError(raw, '不是合法的十六进制颜色');
  });

  it('accepts the short #rgb colour form', () => {
    const raw = rawFile();
    const first = rawTiers(raw)[0];
    if (first === undefined) {
      throw new Error('fixture is missing the first tier');
    }
    first.color = '#fff';

    const { file } = expectOk(raw);
    expect(file.tiers[0]?.color).toBe('#fff');
  });

  it('rejects an empty tier id', () => {
    const raw = rawFile();
    const second = rawTiers(raw)[1];
    if (second === undefined) {
      throw new Error('fixture is missing the second tier');
    }
    second.id = '   ';

    expectError(raw, '第 2 个档位的 id 不能为空');
  });

  it('rejects non-positive and fractional card serials', () => {
    const zero = rawFile();
    const zeroCard = rawCards(zero, 0)[0];
    if (zeroCard === undefined) {
      throw new Error('fixture is missing the first card');
    }
    zeroCard.serial = 0;
    expectError(zero, '卡片编号 0');

    const fractional = rawFile();
    const fractionalCard = rawCards(fractional, 1)[0];
    if (fractionalCard === undefined) {
      throw new Error('fixture is missing a card in the second tier');
    }
    fractionalCard.serial = 1.5;
    expectError(fractional, '必须是正整数');
  });

  it('rejects values that are not a JSON object or have malformed cards', () => {
    expectError('bl-tier', '文件结构不正确');
    expectError(null, '文件结构不正确');

    const nonNumericSerial = rawFile();
    const card = rawCards(nonNumericSerial, 0)[0];
    if (card === undefined) {
      throw new Error('fixture is missing the first card');
    }
    card.serial = '1';
    expectError(nonNumericSerial, '第 1 个档位的数据结构不正确');
  });
});

describe('parseFile — warnings', () => {
  it('skips serials unknown to the local catalogue and reports the first five', () => {
    const raw = rawFile();
    const cards = rawCards(raw, 0);
    cards.push({ serial: 999_901, name: '未知一' });
    cards.push({ serial: 999_902, name: '未知二' });
    for (let index = 3; index <= 5; index += 1) {
      cards.push({ serial: 999_900 + index, name: `未知${index}` });
    }

    const { file, warnings } = expectOk(raw);

    expect(file.tiers[0]?.cards.map((card) => card.serial)).toEqual([1, 2]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('有 5 张卡片不在本地卡片库中');
    expect(warnings[0]).toContain('999901');
    expect(warnings[0]).toContain('999905');
  });

  it('keeps the first occurrence of a duplicated serial and names the ignored tier', () => {
    const raw = rawFile();
    const secondTierCards = rawCards(raw, 1);
    secondTierCards.push({ serial: 1, name: '重复的夜刃' });

    const { file, warnings } = expectOk(raw);

    expect(file.tiers[0]?.cards.map((card) => card.serial)).toEqual([1, 2]);
    expect(file.tiers[1]?.cards.map((card) => card.serial)).toEqual([3]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('「A」');
    expect(warnings[0]).toContain('重复');
  });

  it('accepts a file with no cards at all', () => {
    const raw = rawFile();
    for (const tier of rawTiers(raw)) {
      tier.cards = [];
    }

    const { file, warnings } = expectOk(raw);

    expect(warnings).toEqual([]);
    expect(file.tiers.map((tier) => tier.cards)).toEqual([[], [], []]);
  });

  it('treats a missing card name as a warning, not a rejection', () => {
    const raw = rawFile();
    const first = rawCards(raw, 0)[0];
    const third = rawCards(raw, 1)[0];
    if (first === undefined || third === undefined) {
      throw new Error('fixture is missing cards');
    }
    delete first.name;
    third.name = '   ';

    const { file, warnings } = expectOk(raw);

    expect(file.tiers[0]?.cards[0]).toEqual({ serial: 1, name: '' });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('有 2 张卡片缺少名称');
  });

  it('keeps the local catalogue as the label source for imported cards', () => {
    const raw = rawFile();
    const card = rawCards(raw, 0)[0];
    if (card === undefined) {
      throw new Error('fixture is missing the first card');
    }
    card.name = '伪造的名称';

    const { file } = expectOk(raw);
    const board = importToBoard(file);

    expect(board.tiers[0]?.cards).toEqual([1, 2]);
    // The file's name is only a readable snapshot; re-exporting uses cards.json.
    expect(toFile(board, CARDS_BY_SERIAL).tiers[0]?.cards[0]?.name).toBe('夜刃');
  });
});

describe('iconSignal', () => {
  it('builds a 5s signal when AbortSignal.timeout exists, and degrades without it', () => {
    const signal = iconSignal();

    if (typeof AbortSignal.timeout === 'function') {
      expect(ICON_TIMEOUT_MS).toBe(5000);
      expect(signal).toBeInstanceOf(AbortSignal);
      expect(signal?.aborted).toBe(false);
    } else {
      expect(signal).toBeUndefined();
    }
  });
});

describe('iconFetchUrl', () => {
  it('adds the CORS cache key and preserves an existing query string', () => {
    expect(iconFetchUrl('https://cdn.example/card_icons/1_1.png')).toBe(
      'https://cdn.example/card_icons/1_1.png?v=1',
    );
    expect(iconFetchUrl('https://cdn.example/a.png?x=1')).toBe(
      'https://cdn.example/a.png?x=1&v=1',
    );
    expect(iconFetchUrl('')).toBe('');
  });
});

describe('exportFileName', () => {
  it('uses a local timestamp for both artifacts', () => {
    const date = new Date(2026, 10, 2, 3, 4, 5);

    expect(exportFileName('json', date)).toBe('bl-tier-20261102-0304.json');
    expect(exportFileName('png', date)).toBe('bl-tier-20261102-0304.png');
  });
});

describe('downloadJson', () => {
  let createObjectURL: ReturnType<typeof vi.fn>;
  let revokeObjectURL: ReturnType<typeof vi.fn>;
  let clicks: string[];

  beforeEach(() => {
    createObjectURL = vi.fn(() => 'blob:tier-file');
    revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', {
      value: createObjectURL,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      value: revokeObjectURL,
      configurable: true,
      writable: true,
    });

    clicks = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicks.push(`${this.download}|${this.href}`);
    });
  });

  afterEach(() => {
    Reflect.deleteProperty(URL, 'createObjectURL');
    Reflect.deleteProperty(URL, 'revokeObjectURL');
  });

  it('downloads a timestamped file and releases the blob URL on the next tick', () => {
    vi.useFakeTimers();
    try {
      downloadJson(toFile(makeBoard(), CARDS_BY_SERIAL));

      expect(createObjectURL).toHaveBeenCalledTimes(1);
      expect(clicks).toHaveLength(1);
      expect(clicks[0]).toMatch(/^bl-tier-\d{8}-\d{4}\.json\|blob:tier-file$/);
      // Safari needs the click processed before the URL is revoked.
      expect(revokeObjectURL).not.toHaveBeenCalled();

      vi.runAllTimers();
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:tier-file');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('exportPng', () => {
  let createObjectURL: ReturnType<typeof vi.fn>;
  let revokeObjectURL: ReturnType<typeof vi.fn>;
  let fetchMock: ReturnType<typeof vi.fn>;
  let clicks: string[];
  /** The host is removed in `finally`, so keep a copy taken during the call. */
  let captured: HTMLElement | null;

  function iconResponse(): Response {
    return {
      ok: true,
      blob: () => Promise.resolve(new Blob(['icon'], { type: 'image/png' })),
    } as unknown as Response;
  }

  function exportedNode(): HTMLElement {
    expect(screenshot.domToPng).toHaveBeenCalled();
    if (captured === null) {
      throw new Error('domToPng never received a node');
    }
    return captured;
  }

  beforeEach(() => {
    let objectUrlCounter = 0;
    createObjectURL = vi.fn(() => {
      objectUrlCounter += 1;
      return `blob:icon-${objectUrlCounter}`;
    });
    revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', {
      value: createObjectURL,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      value: revokeObjectURL,
      configurable: true,
      writable: true,
    });

    fetchMock = vi.fn(() => Promise.resolve(iconResponse()));
    vi.stubGlobal('fetch', fetchMock);

    screenshot.domToPng.mockReset();
    captured = null;
    screenshot.domToPng.mockImplementation((node: HTMLElement) => {
      captured = node.cloneNode(true) as HTMLElement;
      return Promise.resolve('data:image/png;base64,AAAA');
    });

    clicks = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicks.push(`${this.download}|${this.href}`);
    });
  });

  afterEach(() => {
    Reflect.deleteProperty(URL, 'createObjectURL');
    Reflect.deleteProperty(URL, 'revokeObjectURL');
    vi.unstubAllGlobals();
  });

  it('fetches icons, renders at 2x and downloads the PNG', async () => {
    const bodyChildren = document.body.childElementCount;
    const onPlaceholder = vi.fn();

    await exportPng(makeBoard(), CARDS_BY_SERIAL, { onPlaceholder });

    expect(onPlaceholder).not.toHaveBeenCalled();

    expect(fetchMock).toHaveBeenCalledTimes(CARDS.length);
    expect(fetchMock).toHaveBeenCalledWith(
      iconFetchUrl(iconUrl('card_icons/1_10261.png')),
      expect.objectContaining({ mode: 'cors' }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      iconFetchUrl(iconUrl('card_icons/2_10271.png')),
      expect.objectContaining({ mode: 'cors' }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      iconFetchUrl(iconUrl('card_icons/3_10281.png')),
      expect.objectContaining({ mode: 'cors' }),
    );

    expect(screenshot.domToPng).toHaveBeenCalledTimes(1);
    expect(screenshot.domToPng).toHaveBeenCalledWith(expect.any(HTMLElement), {
      scale: 2,
      backgroundColor: '#0b0d12',
    });

    expect(createObjectURL).toHaveBeenCalledTimes(CARDS.length);
    expect(revokeObjectURL).toHaveBeenCalledTimes(CARDS.length);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:icon-1');

    expect(clicks).toHaveLength(1);
    expect(clicks[0]).toMatch(/^bl-tier-\d{8}-\d{4}\.png\|data:image\/png;base64,AAAA$/);

    // The off-screen host is cleaned up again.
    expect(document.body.childElementCount).toBe(bodyChildren);
    expect(document.body.textContent).not.toContain('血族资源站');
  });

  it('renders the title, tiers and icon images', async () => {
    await exportPng(makeBoard(), CARDS_BY_SERIAL);

    const node = exportedNode();
    expect(node.textContent).toContain('我的节奏榜');
    expect(node.textContent).toContain('S');
    expect(node.textContent).toContain('待定');
    expect(node.textContent).toContain('血族资源站');
    expect(node.querySelectorAll('img')).toHaveLength(CARDS.length);
  });

  it('still exports placeholders when every icon request fails', async () => {
    fetchMock.mockImplementation(() => Promise.reject(new Error('CORS')));
    const onPlaceholder = vi.fn();

    await expect(
      exportPng(makeBoard(), CARDS_BY_SERIAL, { onPlaceholder }),
    ).resolves.toBeUndefined();

    expect(screenshot.domToPng).toHaveBeenCalledTimes(1);
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(revokeObjectURL).not.toHaveBeenCalled();
    expect(onPlaceholder).toHaveBeenCalledWith(CARDS.length);

    const node = exportedNode();
    expect(node.querySelectorAll('img')).toHaveLength(0);
    // Placeholder tiles keep the card's first character.
    expect(node.textContent).toContain('夜');
    expect(node.textContent).toContain('月');
    expect(clicks).toHaveLength(1);
  });

  it('treats a non-OK response like a failed request', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve({ ok: false, blob: () => Promise.resolve(new Blob()) } as unknown as Response),
    );

    await exportPng(makeBoard(), CARDS_BY_SERIAL);

    expect(createObjectURL).not.toHaveBeenCalled();
    expect(exportedNode().querySelectorAll('img')).toHaveLength(0);
  });

  it('keeps the successful icons when only some requests fail', async () => {
    const broken = iconFetchUrl(iconUrl('card_icons/2_10271.png'));
    fetchMock.mockImplementation((input: unknown) =>
      String(input) === broken
        ? Promise.reject(new Error('CORS'))
        : Promise.resolve(iconResponse()),
    );
    const onPlaceholder = vi.fn();

    await exportPng(makeBoard(), CARDS_BY_SERIAL, { onPlaceholder });

    expect(createObjectURL).toHaveBeenCalledTimes(2);
    expect(onPlaceholder).toHaveBeenCalledWith(1);

    const node = exportedNode();
    expect(node.querySelectorAll('img')).toHaveLength(2);
    // Only the failed serial falls back to its first character.
    expect(node.textContent).toContain('月');
    expect(node.textContent).not.toContain('夜');
  });

  it('limits icon requests to eight in flight', async () => {
    const cards = manyCards();
    const bySerial = new Map(cards.map((card) => [card.serial, card]));
    const board: Board = {
      version: 1,
      title: '并发测试',
      updatedAt: '2026-11-01T12:00:00.000Z',
      tiers: [{ id: 't-s', name: 'S', color: '#e11d48', cards: cards.map((card) => card.serial) }],
    };

    let active = 0;
    let maxActive = 0;
    fetchMock.mockImplementation(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      active -= 1;
      return iconResponse();
    });

    await exportPng(board, bySerial);

    expect(fetchMock).toHaveBeenCalledTimes(cards.length);
    expect(maxActive).toBe(8);
  });

  it('propagates screenshot failures but still removes the host and revokes URLs', async () => {
    const bodyChildren = document.body.childElementCount;
    screenshot.domToPng.mockRejectedValue(new Error('tainted canvas'));

    await expect(exportPng(makeBoard(), CARDS_BY_SERIAL)).rejects.toThrow('tainted canvas');

    expect(revokeObjectURL).toHaveBeenCalledTimes(CARDS.length);
    expect(clicks).toHaveLength(0);
    // The off-screen host must not linger in the document either.
    expect(document.body.childElementCount).toBe(bodyChildren);
    expect(document.body.textContent).not.toContain('血族资源站');
  });
});
