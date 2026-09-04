import { useEffect } from 'react';

/**
 * Keyboard navigation for people who live on the keyboard.
 *
 * Arrows step weeks, j/k walk the rows, Enter opens (rows are buttons, so that
 * comes free). Everything is suppressed while a field has focus or the sheet is
 * open, so typing "j" into search never moves the page underneath the cursor.
 */

interface Handlers {
  onPrevWeek: () => void;
  onNextWeek: () => void;
  /** True while the detail sheet owns the keyboard. */
  blocked: boolean;
}

function isTyping(): boolean {
  const el = document.activeElement;
  return (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement ||
    (el instanceof HTMLElement && el.isContentEditable)
  );
}

/** Move focus through whatever rows or cards are currently rendered. */
function step(delta: number) {
  const items = [...document.querySelectorAll<HTMLElement>('.row, .card')].filter(
    (el) => el.offsetParent !== null,
  );
  if (!items.length) return;
  const current = items.indexOf(document.activeElement as HTMLElement);
  const next = current === -1 ? (delta > 0 ? 0 : items.length - 1) : current + delta;
  const target = items[Math.max(0, Math.min(items.length - 1, next))];
  target?.focus();
  target?.scrollIntoView({ block: 'nearest' });
}

export function useKeyboard({ onPrevWeek, onNextWeek, blocked }: Handlers): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (blocked || isTyping() || e.metaKey || e.ctrlKey || e.altKey) return;

      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault();
          onPrevWeek();
          break;
        case 'ArrowRight':
          e.preventDefault();
          onNextWeek();
          break;
        case 'j':
          e.preventDefault();
          step(1);
          break;
        case 'k':
          e.preventDefault();
          step(-1);
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onPrevWeek, onNextWeek, blocked]);
}
