import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

export type ToastTone = 'info' | 'error';

type ToastItem = {
  id: number;
  message: string;
  tone: ToastTone;
};

export type ToastApi = {
  show: (message: string, tone?: ToastTone) => void;
};

const TOAST_TTL_MS = 3000;
const MAX_TOASTS = 3;

const ToastContext = createContext<ToastApi | null>(null);

/**
 * Fixed, bottom-centred toast stack (role="status", 3s lifetime, at most 3 at
 * once). It is anchored to the viewport bottom so it never covers the sidebar
 * or the mobile top bar, and it is not a portal so it also renders when the
 * whole app is prerendered.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const show = useCallback((message: string, tone: ToastTone = 'info') => {
    nextId.current += 1;
    const id = nextId.current;
    setToasts((current) => [...current, { id, message, tone }].slice(-MAX_TOASTS));
  }, []);

  useEffect(() => {
    for (const toast of toasts) {
      if (!timers.current.has(toast.id)) {
        timers.current.set(
          toast.id,
          setTimeout(() => {
            timers.current.delete(toast.id);
            dismiss(toast.id);
          }, TOAST_TTL_MS),
        );
      }
    }

    for (const [id, timer] of timers.current) {
      if (!toasts.some((toast) => toast.id === id)) {
        clearTimeout(timer);
        timers.current.delete(id);
      }
    }
  }, [toasts, dismiss]);

  useEffect(
    () => () => {
      for (const timer of timers.current.values()) {
        clearTimeout(timer);
      }
      timers.current.clear();
    },
    [],
  );

  const api = useMemo<ToastApi>(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[80] flex flex-col items-center gap-2 px-4">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role="status"
            className={cn(
              'pointer-events-auto max-w-md rounded-lg border px-4 py-2 text-sm shadow-lg',
              toast.tone === 'error'
                ? 'border-[color:var(--bl-danger)] bg-[#2a1113] text-[#fecdd3]'
                : 'border-[color:var(--bl-border-strong)] bg-[var(--bl-panel)] text-[var(--bl-text)]',
            )}
          >
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

// The provider and its hook intentionally live together; the hook is not a
// component, so fast refresh only reloads this module (accepted trade-off).
// eslint-disable-next-line react-refresh/only-export-components
export function useToast(): ToastApi {
  const api = useContext(ToastContext);

  if (api === null) {
    throw new Error('useToast must be used inside <ToastProvider>.');
  }

  return api;
}
