import { useEffect, useRef, useState } from 'react';
import { IconChevronDown, IconClose, IconSearch, IconSliders } from './icons';
import { KIND_LABEL, languageName, platform } from '../data/platforms';
import { activeFilterCount, toggle } from '../lib/filters';
import type { Filters, SortKey, TitleKind } from '../types';

interface Facets {
  platforms: [string, number][];
  languages: [string, number][];
  genres: [string, number][];
  kinds: [TitleKind, number][];
  total: number;
}

interface Props {
  filters: Filters;
  facets: Facets;
  resultCount: number;
  onChange: (next: Partial<Filters>) => void;
  onReset: () => void;
}

// Results are always grouped by release day — that calendar spine is the product.
// Sorting orders titles *within* each day.
const SORTS: { value: SortKey; label: string }[] = [
  { value: 'trending', label: 'Trending' },
  { value: 'rating', label: 'Top rated' },
  { value: 'az', label: 'A–Z' },
];

function Chip({
  label,
  count,
  accent,
  on,
  onClick,
}: {
  label: string;
  count?: number;
  accent?: string;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className="chip"
      data-on={on}
      onClick={onClick}
      aria-pressed={on}
      style={accent ? ({ '--chip-accent': accent } as React.CSSProperties) : undefined}
    >
      {accent && <span className="chip__dot" />}
      {label}
      {count != null && <span className="chip__n">{count}</span>}
    </button>
  );
}

export function Controls({ filters, facets, resultCount, onChange, onReset }: Props) {
  const [open, setOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const active = activeFilterCount(filters);

  // "/" to search, Escape to bail — the shortcuts power users try first.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      const typing = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
      if (e.key === '/' && !typing) {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (e.key === 'Escape' && typing) searchRef.current?.blur();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="controls">
      <div className="shell">
        <div className="controls__row">
          <div className="search">
            <IconSearch />
            <input
              ref={searchRef}
              type="search"
              placeholder="Search titles, cast, genres"
              value={filters.query}
              onChange={(e) => onChange({ query: e.target.value })}
              aria-label="Search this week's releases"
            />
            {filters.query ? (
              <button
                className="search__clear"
                onClick={() => onChange({ query: '' })}
                aria-label="Clear search"
              >
                <IconClose />
              </button>
            ) : (
              <kbd>/</kbd>
            )}
          </div>

          <button className="btn" data-active={open} onClick={() => setOpen((v) => !v)}>
            <IconSliders />
            <span className="btn__text">Filters</span>
            {active > 0 && <span className="btn__count">{active}</span>}
          </button>

          <div className="sort">
            <select
              value={filters.sort}
              onChange={(e) => onChange({ sort: e.target.value as SortKey })}
              aria-label="Sort releases"
            >
              {SORTS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
            <IconChevronDown />
          </div>
        </div>

        {/* Platform is the filter people reach for first, so it never hides in a panel. */}
        <div className="chips" role="group" aria-label="Filter by platform">
          {facets.platforms.map(([id, n]) => {
            const p = platform(id);
            return (
              <Chip
                key={id}
                label={p.short}
                count={n}
                accent={p.accent}
                on={filters.platforms.includes(id)}
                onClick={() => onChange({ platforms: toggle(filters.platforms, id) })}
              />
            );
          })}
        </div>

        {open && (
          <div className="panel">
            <div className="panel__group">
              <span className="panel__label">Type</span>
              <div className="panel__chips">
                {facets.kinds.map(([k, n]) => (
                  <Chip
                    key={k}
                    label={KIND_LABEL[k] ?? k}
                    count={n}
                    on={filters.kinds.includes(k)}
                    onClick={() => onChange({ kinds: toggle(filters.kinds, k) })}
                  />
                ))}
              </div>
            </div>

            <div className="panel__group">
              <span className="panel__label">Language</span>
              <div className="panel__chips">
                {facets.languages.map(([l, n]) => (
                  <Chip
                    key={l}
                    label={languageName(l)}
                    count={n}
                    on={filters.languages.includes(l)}
                    onClick={() => onChange({ languages: toggle(filters.languages, l) })}
                  />
                ))}
              </div>
            </div>

            {facets.genres.length > 0 && (
              <div className="panel__group">
                <span className="panel__label">Genre</span>
                <div className="panel__chips">
                  {facets.genres.map(([g, n]) => (
                    <Chip
                      key={g}
                      label={g}
                      count={n}
                      on={filters.genres.includes(g)}
                      onClick={() => onChange({ genres: toggle(filters.genres, g) })}
                    />
                  ))}
                </div>
              </div>
            )}

            <div className="panel__footer">
              <button className="btn" onClick={onReset} disabled={active === 0}>
                Reset filters
              </button>
            </div>
          </div>
        )}

        {/* Only worth the vertical space once it's telling you something the
            header doesn't — i.e. once a filter is actually narrowing the week. */}
        {active > 0 && (
          <div className="summary" aria-live="polite">
            <span>
              <strong>{resultCount}</strong> of <strong>{facets.total}</strong> releases
            </span>
            <button className="summary__clear" onClick={onReset}>
              Clear filters
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
