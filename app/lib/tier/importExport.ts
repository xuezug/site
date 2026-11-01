/**
 * Tier board JSON export/import (design §6.6).
 *
 * The file format is documented in the design doc:
 *
 * ```json
 * { "format": "bl-tier", "version": 1, "title": "我的节奏榜",
 *   "updatedAt": "2026-11-01T12:00:00.000Z",
 *   "tiers": [{ "id": "t-s", "name": "S", "color": "#e11d48",
 *               "cards": [{ "serial": 1020, "name": "月季院" }] }] }
 * ```
 *
 * Validation runs in two stages: `zod` checks the shape, then the rules that
 * need a human-readable Chinese reason (tier count, duplicate ids, blank
 * names, colours, card serials) run by hand and point at the offending tier.
 * `parseFile` never throws — it always returns `{ ok: false, error }`.
 *
 * Card names are only a readable snapshot; the local `cards.json` stays the
 * source of truth for display. Serials that do not exist locally are dropped
 * with a warning, and a serial that appears more than once keeps its first
 * occurrence (both per §6.6).
 */

import { z } from 'zod';
import cardsJson from '../../../src/data/cards.json';
import type { Card } from '../cards/types';
import { BOARD_VERSION, DEFAULT_TITLE, MAX_TIERS, isTierColor, type Board } from './model';

export type TierFileCard = { serial: number; name: string };

export type TierFileTier = {
  id: string;
  name: string;
  color: string;
  cards: TierFileCard[];
};

export type TierFile = {
  format: 'bl-tier';
  version: 1;
  title: string;
  updatedAt: string;
  tiers: TierFileTier[];
};

export const TIER_FILE_FORMAT = 'bl-tier';
export const TIER_FILE_VERSION = 1;

/** Structural shape only; semantic rules live in `validateFile`. */
export const tierFileSchema: z.ZodType<TierFile> = z.object({
  format: z.literal(TIER_FILE_FORMAT),
  version: z.literal(TIER_FILE_VERSION),
  title: z.string(),
  updatedAt: z.string(),
  tiers: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      color: z.string(),
      cards: z.array(z.object({ serial: z.number(), name: z.string().default('') })),
    }),
  ),
});

/** Every serial the local catalogue knows about; anything else is unknown. */
const KNOWN_SERIALS: ReadonlySet<number> = new Set(
  (cardsJson as readonly { serial: number }[]).map((card) => card.serial),
);

export type ParseFileResult =
  | { ok: true; file: TierFile; warnings: string[] }
  | { ok: false; error: string };

function fail(error: string): ParseFileResult {
  return { ok: false, error };
}

/**
 * Chinese explanation for a structural failure. `format`/`version` are the
 * common "wrong file" mistakes, so they get a dedicated sentence even though
 * they are enforced by the schema.
 */
function describeStructureIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  if (issue === undefined) {
    return '文件结构不正确';
  }
  const path = issue.path.map((key) => String(key));
  const [head] = path;

  if (head === 'format') {
    return '不是血族节奏榜文件：format 必须是 "bl-tier"';
  }
  if (head === 'version') {
    return '文件版本不受支持：需要 version 1';
  }
  if (head === 'tiers') {
    const tierIndex = Number(path[1]);
    if (Number.isSafeInteger(tierIndex) && tierIndex >= 0) {
      return `第 ${tierIndex + 1} 个档位的数据结构不正确`;
    }
    return '文件结构不正确：档位列表（tiers）必须是数组';
  }
  if (path.length === 0) {
    return '文件结构不正确：内容必须是一个 JSON 对象';
  }
  return `文件结构不正确：字段「${path.join('.')}」缺失或类型错误`;
}

/** First reason the file cannot be imported, or `null` when it is valid. */
function validateFile(file: TierFile): string | null {
  if (file.tiers.length < 1 || file.tiers.length > MAX_TIERS) {
    return `档位数量必须在 1–${MAX_TIERS} 之间，实际为 ${file.tiers.length} 个`;
  }

  const ids = new Set<string>();
  for (let index = 0; index < file.tiers.length; index += 1) {
    const tier = file.tiers[index];
    if (tier === undefined) {
      continue;
    }
    const position = index + 1;

    if (tier.id.trim() === '') {
      return `第 ${position} 个档位的 id 不能为空`;
    }
    if (ids.has(tier.id)) {
      return `第 ${position} 个档位的 id「${tier.id}」与前面的档位重复`;
    }
    ids.add(tier.id);

    if (tier.name.trim() === '') {
      return `第 ${position} 个档位的名称不能为空`;
    }
    if (!isTierColor(tier.color)) {
      return `第 ${position} 个档位「${tier.name}」的颜色「${tier.color}」不是合法的十六进制颜色（#rgb 或 #rrggbb）`;
    }

    for (const card of tier.cards) {
      if (!Number.isSafeInteger(card.serial) || card.serial <= 0) {
        return `第 ${position} 个档位中有无效的卡片编号 ${String(card.serial)}（必须是正整数）`;
      }
    }
  }

  return null;
}

/**
 * Validate an already-JSON-parsed value and drop cards that cannot be shown.
 * Never throws.
 */
export function parseFile(raw: unknown): ParseFileResult {
  const parsed = tierFileSchema.safeParse(raw);
  if (!parsed.success) {
    return fail(describeStructureIssue(parsed.error));
  }

  const file: TierFile = parsed.data;
  const invalid = validateFile(file);
  if (invalid !== null) {
    return fail(invalid);
  }

  const seen = new Set<number>();
  const unknownSerials: number[] = [];
  const duplicateTierNames: string[] = [];
  const duplicateSeen = new Set<string>();
  let missingNames = 0;

  const tiers: TierFileTier[] = file.tiers.map((tier) => {
    const cards: TierFileCard[] = [];
    let duplicatedHere = false;

    for (const card of tier.cards) {
      if (!KNOWN_SERIALS.has(card.serial)) {
        unknownSerials.push(card.serial);
        continue;
      }
      if (seen.has(card.serial)) {
        duplicatedHere = true;
        continue;
      }
      seen.add(card.serial);
      if (card.name.trim() === '') {
        // The name is only a readable snapshot; display always comes from the
        // local catalogue, so a missing one is a warning, not a rejection.
        missingNames += 1;
      }
      cards.push({ serial: card.serial, name: card.name });
    }

    if (duplicatedHere && !duplicateSeen.has(tier.name)) {
      duplicateSeen.add(tier.name);
      duplicateTierNames.push(tier.name);
    }

    return { id: tier.id, name: tier.name, color: tier.color, cards };
  });

  const warnings: string[] = [];
  if (duplicateTierNames.length > 0) {
    const names = duplicateTierNames.map((name) => `「${name}」`).join('、');
    warnings.push(`档位 ${names} 中有重复的卡片，已保留首次出现的那一张`);
  }
  if (unknownSerials.length > 0) {
    const sample = unknownSerials.slice(0, 5).join('、');
    const suffix = unknownSerials.length > 5 ? ' 等' : '';
    warnings.push(
      `有 ${unknownSerials.length} 张卡片不在本地卡片库中，已跳过（编号：${sample}${suffix}）`,
    );
  }
  if (missingNames > 0) {
    warnings.push(`有 ${missingNames} 张卡片缺少名称，已按本地数据展示`);
  }

  return { ok: true, file: { ...file, tiers }, warnings };
}

/** Build the export payload from the live board; card order follows the tiers. */
export function toFile(board: Board, cards: Map<number, Card>): TierFile {
  return {
    format: TIER_FILE_FORMAT,
    version: TIER_FILE_VERSION,
    title: board.title,
    updatedAt: board.updatedAt,
    tiers: board.tiers.map((tier) => ({
      id: tier.id,
      name: tier.name,
      color: tier.color,
      cards: tier.cards.map((serial) => ({
        serial,
        name: cards.get(serial)?.name ?? `#${serial}`,
      })),
    })),
  };
}

/** Turn a validated file into a board; `updatedAt` is stamped "now". */
export function importToBoard(file: TierFile): Board {
  const title = file.title.trim() === '' ? DEFAULT_TITLE : file.title.trim();

  return {
    version: BOARD_VERSION,
    title,
    tiers: file.tiers.map((tier) => ({
      id: tier.id,
      name: tier.name.trim(),
      color: tier.color,
      cards: tier.cards.map((card) => card.serial),
    })),
    updatedAt: new Date().toISOString(),
  };
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** `YYYYMMDD-HHmm` in local time, shared by the JSON and PNG file names. */
export function exportStamp(date: Date = new Date()): string {
  return (
    `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}` +
    `-${pad2(date.getHours())}${pad2(date.getMinutes())}`
  );
}

/** Download name for either artifact: `bl-tier-YYYYMMDD-HHmm.{json,png}`. */
export function exportFileName(extension: 'json' | 'png', date: Date = new Date()): string {
  return `bl-tier-${exportStamp(date)}.${extension}`;
}

/** Click a temporary anchor so the browser downloads `href` as `filename`. */
export function triggerDownload(href: string, filename: string): void {
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = filename;
  anchor.rel = 'noopener';
  anchor.style.display = 'none';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}

/** Download the board as `bl-tier-YYYYMMDD-HHmm.json`. */
export function downloadJson(file: TierFile): void {
  const blob = new Blob([JSON.stringify(file, null, 2)], {
    type: 'application/json;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  try {
    triggerDownload(url, exportFileName('json'));
  } finally {
    // Safari cancels the download if the blob URL disappears in the same task
    // as the click, so release it on the next tick.
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 0);
  }
}
