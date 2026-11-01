import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

type FieldProps = {
  label: string;
  htmlFor: string;
  hint?: string;
  className?: string;
  children: ReactNode;
};

/**
 * Label + control + optional hint. The hint id is derived from `htmlFor`
 * (`<htmlFor>-hint`) so callers can reference it with `aria-describedby`.
 */
export function Field({ label, htmlFor, hint, className, children }: FieldProps) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={htmlFor} className="text-xs font-medium text-[var(--bl-muted)]">
        {label}
      </label>
      {children}
      {hint !== undefined ? (
        <p id={`${htmlFor}-hint`} className="text-xs text-[var(--bl-muted)]">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
