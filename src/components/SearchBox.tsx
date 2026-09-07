import { useEffect, useRef, useState } from 'react';
import { IconClose, IconSearch } from './icons';

/**
 * Search, in the header.
 *
 * It used to sit five bands down, inside the filter row, which put it below the
 * week, the counts, the lenses and the view toggle. That is the wrong order for
 * this site: a large share of arrivals come from someone searching "<film> OTT
 * release date", and what they want on landing is to type a second title. Every
 * app they use puts search in the top bar, and so does this now.
 *
 * On a phone it is an icon that expands, because a header holding a wordmark, a
 * full input and two icons at 390px holds none of them well. On anything wider
 * the field is simply there — a control that is always visible beats one that
 * costs a tap, whenever there is room for it.
 */

interface Props {
  value: string;
  onChange: (value: string) => void;
}

/** Below this the header cannot hold an input and the wordmark at once. */
const ROOM_FOR_A_FIELD = 720;

export function SearchBox({ value, onChange }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [wide, setWide] = useState(
    () => typeof window !== 'undefined' && window.innerWidth >= ROOM_FOR_A_FIELD,
  );
  /** Only meaningful on a narrow screen; a wide one is always open. */
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${ROOM_FOR_A_FIELD}px)`);
    const read = () => setWide(mq.matches);
    read();
    mq.addEventListener('change', read);
    return () => mq.removeEventListener('change', read);
  }, []);

  // "/" to search, Escape to bail — the shortcuts power users try first. Kept
  // with the field rather than left behind in the filter row it came from.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      const typing = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
      if (e.key === '/' && !typing) {
        e.preventDefault();
        setOpen(true);
        // The field may be rendering this frame; focus once it exists.
        requestAnimationFrame(() => input.current?.focus());
      }
      if (e.key === 'Escape' && typing) input.current?.blur();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /**
   * A query typed and then hidden would filter the board with nothing on screen
   * explaining why, so the field stays open while it holds one.
   */
  const shown = wide || open || value.length > 0;

  return (
    <div className="searchbox" data-open={shown || undefined}>
      {!shown && (
        <button
          className="searchbox__toggle"
          onClick={() => {
            setOpen(true);
            requestAnimationFrame(() => input.current?.focus());
          }}
          aria-label="Search titles, cast and genres"
          aria-expanded={false}
        >
          <IconSearch />
        </button>
      )}

      {shown && (
        <div className="search">
          <IconSearch />
          <input
            ref={input}
            type="search"
            placeholder="Search titles, cast, genres"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onBlur={() => {
              // Collapse again on a narrow screen once it is empty and unused.
              if (!wide && !value) setOpen(false);
            }}
            aria-label="Search titles, cast and genres"
          />
          {value ? (
            <button className="search__clear" onClick={() => onChange('')} aria-label="Clear search">
              <IconClose />
            </button>
          ) : (
            wide && <kbd>/</kbd>
          )}
        </div>
      )}
    </div>
  );
}
