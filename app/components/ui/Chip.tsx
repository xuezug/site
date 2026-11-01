import type { ButtonHTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

type ChipProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  active?: boolean;
};

/** Toggleable filter chip; `aria-pressed` mirrors `active`. */
export function Chip({ active = false, type = 'button', className, ...rest }: ChipProps) {
  return (
    <button
      type={type}
      aria-pressed={active}
      className={cn(
        'inline-flex min-h-10 items-center justify-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors',
        active
          ? 'border-[color:var(--bl-accent)] bg-[var(--bl-accent-soft)] text-[var(--bl-accent-text)]'
          : 'border-[color:var(--bl-border)] bg-transparent text-[var(--bl-muted)] hover:border-[color:var(--bl-border-strong)] hover:text-[var(--bl-text)]',
        className,
      )}
      {...rest}
    />
  );
}
