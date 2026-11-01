import { useEffect, useId, useState } from 'react';
import type { RefObject } from 'react';
import { Button } from '../ui/Button';
import { Chip } from '../ui/Chip';
import { ATTRIBUTES, CAREERS, FACTIONS, STARS } from '../../lib/cards/taxonomy';
import type { AttrId, CareerId, FactionId } from '../../lib/cards/taxonomy';
import { cn } from '../../lib/cn';
import { EMPTY_FILTERS, hasActiveFilters, type PoolFilters } from './useCardPool';

/** Design §6.4: typing settles for 150ms before the list is filtered again. */
const SEARCH_DEBOUNCE_MS = 150;

type Choice = { readonly id: string; readonly label: string };

const STAR_CHOICES: readonly Choice[] = STARS.map((star) => ({
  id: String(star),
  label: `${star} 星`,
}));

type ChoiceSelectProps = {
  label: string;
  value: string;
  choices: readonly Choice[];
  onChange: (id: string) => void;
};

/** One filter dimension. Empty value = 「全部」, i.e. undefined in `PoolFilters`. */
function ChoiceSelect({ label, value, choices, onChange }: ChoiceSelectProps) {
  const id = useId();

  return (
    <span className="flex items-center gap-1.5">
      <label htmlFor={id} className="text-xs text-[var(--bl-muted)]">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-11 rounded-lg border border-[color:var(--bl-border)] bg-[var(--bl-panel)] px-2 text-xs text-[var(--bl-text)]"
      >
        <option value="">全部</option>
        {choices.map((choice) => (
          <option key={choice.id} value={choice.id}>
            {choice.label}
          </option>
        ))}
      </select>
    </span>
  );
}

type FilterBarProps = {
  value: PoolFilters;
  onChange: (next: PoolFilters) => void;
  filteredCount: number;
  total: number;
  placedCount: number;
  /** Owned by the pool so「清空筛选」can hand focus back to the search box. */
  searchRef: RefObject<HTMLInputElement | null>;
};

/**
 * Pool toolbar (design §6.4): keyword search, one single-select per dimension,
 * the「仅看未上榜」toggle, a live result count and「清空筛选」.
 *
 * The search box is the only debounced control: `draft` mirrors the typed text
 * and is pushed upward 150ms after the last keystroke. Every other control is
 * immediate. The count is the single `aria-live` region for the pool, so a
 * screen reader hears the result once per settled query instead of per key.
 *
 * 「清空筛选」 uses `aria-disabled` rather than `disabled`: a `disabled` button
 * becomes unfocusable the moment it clears the filters (activation and the
 * state change land in the same commit), which would drop keyboard focus to
 * `<body>` and restart Tab from the top of the page.
 */
export function FilterBar({
  value,
  onChange,
  filteredCount,
  total,
  placedCount,
  searchRef,
}: FilterBarProps) {
  // The search box needs to echo keystrokes immediately while the parent only
  // sees the query after the debounce. Instead of mirroring the prop in an
  // effect, the draft records the query it was typed against: as soon as the
  // parent's query differs from that base (the debounce landed, or filters were
  // cleared elsewhere) the box follows the parent again.
  const [draft, setDraft] = useState({ text: value.query, base: value.query });
  const text = draft.base === value.query ? draft.text : value.query;

  // Debounced push of the typed text. Restarts on every keystroke and is
  // cleared on unmount, so no stray update fires after the pool is gone.
  useEffect(() => {
    if (text === value.query) {
      return;
    }
    const timer = window.setTimeout(() => {
      onChange({ ...value, query: text });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [text, value, onChange]);

  const active = hasActiveFilters(value);
  // A pending debounced query is a filter too: keep the button live during the
  // 150ms window.
  const clearable = active || text !== value.query;

  const clearAll = (): void => {
    if (!clearable) {
      return;
    }
    setDraft({ text: '', base: value.query });
    onChange(EMPTY_FILTERS);
    // Conventional focus move: the filters are gone, so put the caret where the
    // user starts a new search instead of leaving it on a now-idle button.
    searchRef.current?.focus();
  };

  return (
    <div data-testid="filter-bar" className="flex flex-wrap items-center gap-2">
      <input
        ref={searchRef}
        type="search"
        aria-label="搜索卡片名称或编号"
        placeholder="搜索名称或编号"
        value={text}
        onChange={(event) => setDraft({ text: event.target.value, base: value.query })}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') {
            return;
          }
          // Esc clears immediately: it is an explicit action, not typing.
          event.preventDefault();
          setDraft({ text: '', base: value.query });
          onChange({ ...value, query: '' });
        }}
        className="min-h-11 min-w-[10rem] flex-1 rounded-lg border border-[color:var(--bl-border)] bg-[var(--bl-panel)] px-3 text-sm text-[var(--bl-text)] placeholder:text-[var(--bl-muted)]"
      />

      <ChoiceSelect
        label="属性"
        value={value.attribute ?? ''}
        choices={ATTRIBUTES}
        onChange={(raw) => {
          const next: AttrId | undefined = ATTRIBUTES.find((option) => option.id === raw)?.id;
          onChange({ ...value, attribute: next });
        }}
      />
      <ChoiceSelect
        label="阵营"
        value={value.faction ?? ''}
        choices={FACTIONS}
        onChange={(raw) => {
          const next: FactionId | undefined = FACTIONS.find((option) => option.id === raw)?.id;
          onChange({ ...value, faction: next });
        }}
      />
      <ChoiceSelect
        label="职业"
        value={value.career ?? ''}
        choices={CAREERS}
        onChange={(raw) => {
          const next: CareerId | undefined = CAREERS.find((option) => option.id === raw)?.id;
          onChange({ ...value, career: next });
        }}
      />
      <ChoiceSelect
        label="星级"
        value={value.star === undefined ? '' : String(value.star)}
        choices={STAR_CHOICES}
        onChange={(raw) => {
          const next = STAR_CHOICES.find((option) => option.id === raw);
          onChange({ ...value, star: next === undefined ? undefined : Number(next.id) });
        }}
      />

      <Chip
        active={value.onlyUnplaced}
        onClick={() => onChange({ ...value, onlyUnplaced: !value.onlyUnplaced })}
        className="min-h-11"
      >
        仅看未上榜
      </Chip>

      <p
        aria-live="polite"
        aria-atomic="true"
        className="text-xs text-[var(--bl-muted)]"
        data-testid="pool-count"
      >
        {active
          ? `筛选出 ${filteredCount} 张 · 全站已上榜 ${placedCount} 张`
          : `共 ${total} 张 · 全站已上榜 ${placedCount} 张`}
      </p>

      <Button
        size="sm"
        variant="ghost"
        onClick={clearAll}
        // Not `disabled`: see the component doc — focus must survive the clear.
        aria-disabled={!clearable}
        className={cn(!clearable && 'opacity-50')}
      >
        清空筛选
      </Button>
    </div>
  );
}
