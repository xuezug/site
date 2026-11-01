import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

/**
 * Shared modal behaviour for `<Dialog>` and the mobile navigation drawer:
 *
 * - moves focus into the panel when it opens,
 * - traps Tab / Shift+Tab inside the panel,
 * - closes on Escape,
 * - returns focus to the element that opened it (or to `returnFocusRef`).
 *
 * `onClose` is read through a ref so an inline callback does not restart the
 * effect (which would bounce focus around while the panel is open).
 */
export function useModalBehavior(
  open: boolean,
  onClose: () => void,
  containerRef: RefObject<HTMLElement | null>,
  returnFocusRef?: RefObject<HTMLElement | null>,
): void {
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const container = containerRef.current;
    const previouslyFocused =
      returnFocusRef?.current ??
      (document.activeElement instanceof HTMLElement ? document.activeElement : null);

    const focusables = (): HTMLElement[] => {
      if (container === null) {
        return [];
      }
      return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (element) => !element.hasAttribute('aria-hidden'),
      );
    };

    const firstFocusable = focusables()[0];
    if (firstFocusable !== undefined) {
      firstFocusable.focus();
    } else {
      container?.focus();
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }

      if (event.key !== 'Tab' || container === null) {
        return;
      }

      const items = focusables();
      const first = items[0];
      const last = items[items.length - 1];

      if (first === undefined || last === undefined) {
        event.preventDefault();
        container.focus();
        return;
      }

      const active = document.activeElement;

      if (event.shiftKey && (active === first || active === container)) {
        event.preventDefault();
        last.focus();
        return;
      }

      if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      if (previouslyFocused !== null && previouslyFocused.isConnected) {
        previouslyFocused.focus();
      }
    };
    // `onClose` is intentionally read from a ref; see the doc comment above.
  }, [open, containerRef, returnFocusRef]);
}
