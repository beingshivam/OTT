import { useState } from 'react';
import {
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconGrid,
  IconRows,
  IconSliders,
} from './icons';
import { PlatformLogo } from './PlatformLogo';
import { KIND_LABEL, REGIONS, languageName, platform } from '../data/platforms';
import { activeFilterCount, toggle } from '../lib/filters';
import type { Filters, SortKey, TitleKind } from '../types';

interface Facets {
  platforms: [string, number][];
  languages: [string, number][];
  genres: [string, number][];
  kinds: [TitleKind, number][];
  total: number;
}

/**
 * The board's own heading, and the controls that act on it.
 *
 * These used to live in the page header: the week in one band, the count and
 * freshness in another, the view toggle beside them, filters and sort in a
 * third. Six bands stood between a phone and the first film, and every one of
 * them described the board while sitting nowhere near it.
 *
 * Position is what makes a control legible. A view toggle at the top of the
 * page reads as a mode switch for everything on it — which stopped being true
 * the moment a poster rail appeared above the board. Sitting on the board's own
 * heading, it says what it actually does: this is how *this list* renders.
 * Same for the week, which labels the board rather than the page, and for the
 * filters, which narrow the board and nothing else.
 */
interface Props {
  filters: Filters;
  facets: Facets;
  resultCount: number;
  onChange: (next: Partial<Filters>) => void;
  onReset: () => void;
  /** What the board below is showing: "4–10 Sep 2026", or "649 titles" on a
   *  lens whose intro has already named it a line above. */
  heading: string;
  /** False where `heading` is already the count, so it is not printed twice. */
  showCount?: boolean;
  /** Absent on a lens with no weeks to step through — a month, the catalogue.
   *  `today` is present only when the reader has stepped away from the current
   *  week: two arrows will get them back eventually, and a way back in one tap
   *  is the difference between a stepper you explore and one you avoid. */
  step?: {
    back: () => void;
    forward: () => void;
    canBack: boolean;
    canForward: boolean;
    today?: () => void;
  };
  /** How fresh the data is, phrased by the caller. */
  freshness?: { label: string; title: string };
  view: 'board' | 'grid';
  onView: (v: 'board' | 'grid') => void;
  /** Which country's calendar this is. Down here rather than in the header
   *  because it is guessed correctly for almost everyone, changed roughly once
   *  per device, and was spending permanent header width to say "India" to
   *  people who live in India. */
  region: string;
  onRegion: (code: string) => void;
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

export function Controls({
  filters,
  facets,
  resultCount,
  onChange,
  onReset,
  heading,
  showCount = true,
  step,
  freshness,
  view,
  onView,
  region,
  onRegion,
}: Props) {
  const [open, setOpen] = useState(false);
  const active = activeFilterCount(filters);

  return (
    <div className="controls">
      <div className="shell">
        <div className="controls__row">
          {freshness && (
            <span className="controls__fresh" title={freshness.title}>
              <i />
              <span className="controls__fresh-label">{freshness.label}</span>
            </span>
          )}
          <h2 className="controls__heading">
            {heading}
            {showCount && <span className="controls__count"> · {facets.total} titles</span>}
          </h2>

          {step && (
            <span className="weeknav" role="group" aria-label="Change week">
              <button className="weeknav__btn" onClick={step.back} disabled={!step.canBack} aria-label="Previous week">
                <IconChevronLeft />
              </button>
              <button className="weeknav__btn" onClick={step.forward} disabled={!step.canForward} aria-label="Next week">
                <IconChevronRight />
              </button>
              {step.today && (
                <button className="weeknav__today" onClick={step.today}>
                  This week
                </button>
              )}
            </span>
          )}

          {/*
            Icons on a phone, words on a desktop — the same trade the Share
            button makes. Rows and a grid are the two most legible icons in
            software, and at 390px the words cost more than they explain.
            aria-pressed rather than a visual state alone, because this is a
            two-way toggle and a screen reader has no colour to read.
          */}
          <span className="viewtoggle" role="group" aria-label="Layout">
            {/* aria-label as well as the word, because the word is the half
                that disappears. .btn__text is display:none below the desktop
                breakpoint, which removes it from the accessibility tree along
                with the pixels — so on a phone these were two buttons a screen
                reader could only announce as "button", and the Filters control
                beside them was a third. Found by a keyboard-and-name sweep, not
                by looking. */}
            <button aria-label="Board view" data-on={view === 'board'} aria-pressed={view === 'board'} onClick={() => onView('board')}>
              <IconRows />
              <span className="btn__text">Board</span>
            </button>
            <button aria-label="Poster view" data-on={view === 'grid'} aria-pressed={view === 'grid'} onClick={() => onView('grid')}>
              <IconGrid />
              <span className="btn__text">Posters</span>
            </button>
          </span>

          <button className="btn" aria-label="Filters" data-active={open} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
            <IconSliders />
            <span className="btn__text">Filters</span>
            {active > 0 && <span className="btn__count">{active}</span>}
          </button>
        </div>

        {/*
          Platform chips, in the poster view only.
          
          In board view every platform is already a labelled column carrying its
          own count, so a row of platform chips directly above it spent 44px
          restating the next section. The grid has no columns and no other
          platform wayfinding, which is exactly where they earn their place.
        */}
        {view === 'grid' && (
        <div className="chips" role="group" aria-label="Filter by platform">
          {facets.platforms.map(([id, n]) => {
            const p = platform(id);
            const on = filters.platforms.includes(id);
            return (
              <button
                key={id}
                className="chip chip--logo"
                data-on={on}
                aria-pressed={on}
                style={{ '--chip-accent': p.accent } as React.CSSProperties}
                onClick={() => onChange({ platforms: toggle(filters.platforms, id) })}
              >
                <PlatformLogo platformId={id} size={18} />
                {p.short}
                <span className="chip__n">{n}</span>
              </button>
            );
          })}
        </div>
        )}

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

            <div className="panel__group">
              <span className="panel__label">Region</span>
              <label className="region">
                <span aria-hidden="true">{REGIONS.find((r) => r.code === region)?.flag ?? '🌐'}</span>
                <span className="sr-only">Region</span>
                <select value={region} onChange={(e) => onRegion(e.target.value)}>
                  {REGIONS.map((r) => (
                    <option key={r.code} value={r.code}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {/* Moved in from the row beside search. It is a narrowing control
                like the rest, it was the only one wearing a different shape,
                and "Trending" sitting in a dropdown beside "Filters" read as a
                second filter rather than an ordering. */}
            <div className="panel__group">
              <span className="panel__label">Order</span>
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
