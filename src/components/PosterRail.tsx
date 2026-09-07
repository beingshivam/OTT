import { useCallback, useEffect, useRef, useState } from 'react';
import { PosterArt } from './PosterArt';
import { PlatformLogo } from './PlatformLogo';
import { IconChevronLeft, IconChevronRight } from './icons';
import { platform } from '../data/platforms';
import { scoreOf } from '../lib/score';
import type { Release } from '../types';

/**
 * A row of posters, and the only place on the site that leads with artwork.
 *
 * The board deliberately does not: it is a schedule, and a schedule is read
 * fastest as text. But a schedule answers "what came out", and most people
 * arrive asking "what should I watch", which is a question posters answer and
 * a list of names does not. Both questions are real; they just need different
 * shapes, and until now the site only had one of them.
 *
 * This replaces the text strip that used to sit here rather than joining it.
 * That strip's own comment argued a poster rail would push the board under the
 * fold, which was true when it was written and is not now: the header stack
 * above it gave back 139px first. Two editorial bands above a board is one too
 * many whatever they contain.
 *
 * Nothing auto-advances. A carousel that moves on its own takes the reader's
 * place away mid-sentence, is unusable with a screen reader, and reliably
 * measures worse than one that waits. This waits.
 *
 * One component, three rows, because each lens is asking a different question
 * and the same row on all three would be wrong twice over: "just landed" on a
 * page of films that are not out yet is a false statement, and on the back
 * catalogue it is the homepage again. So the selection and the wording belong
 * to the caller and only the behaviour lives here.
 */

interface Props {
  /** What the row is. Short — it competes with the board for attention. */
  title: string;
  /** The qualification the heading cannot carry. Hidden on narrow screens. */
  subtitle: string;
  releases: Release[];
  onOpen: (r: Release) => void;
  /** The line under each poster. Given the row rather than fixed inside it,
   *  because "3 days ago" is the right answer on one lens and "In 5 days" or a
   *  year is the right answer on another — and a rail that decides this for its
   *  caller ends up printing "2 weeks ago" over a film that is not out yet. */
  caption: (r: Release) => string;
  /**
   * Optional two-way split of the same row.
   *
   * The homepage row carries cinema and streaming together, which is the
   * pairing this site has and the streaming-only competitors structurally
   * cannot — but mixed, a cinema release is just another poster, and the run it
   * is in the middle of is invisible. Segmenting says the two are different
   * kinds of thing without giving cinema a whole tab in the nav.
   *
   * Absent on the other lenses, where there is nothing to split: /upcoming is
   * all announcements and the catalogue has no cinema in it at all.
   */
  segments?: { id: string; label: string; count: number }[];
  active?: string;
  onSegment?: (id: string) => void;
  /**
   * A sub-row inside a titled section, rather than a section of its own.
   *
   * Smaller cards and an h3, so two of these cost roughly what one full row
   * cost and the board does not get pushed off the fold. Used by the homepage
   * pair; the single rows on the other lenses stay full size.
   */
  compact?: boolean;
}

/** Headings need ids to be referenced, and two rows on one page cannot share
 *  one — the second would label itself with the first row's name. */
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function PosterRail({
  title,
  subtitle,
  releases,
  onOpen,
  caption,
  segments,
  active,
  onSegment,
  compact,
}: Props) {
  const track = useRef<HTMLUListElement>(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);

  /**
   * Which arrows are live, and whether there is anything to scroll at all.
   *
   * Read from the element rather than assumed from the count: the same twelve
   * cards overflow a phone and fit a wide desktop, and an arrow that scrolls
   * nothing is worse than no arrow.
   */
  const measure = useCallback(() => {
    const el = track.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setAtStart(el.scrollLeft <= 1);
    setAtEnd(el.scrollLeft >= max - 1);
  }, []);

  useEffect(() => {
    measure();
    const el = track.current;
    if (!el) return;
    // Resizing changes how many cards fit, so the arrows have to be re-read.
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure, releases]);

  const page = (dir: 1 | -1) => {
    const el = track.current;
    if (!el) return;
    // Just under a full viewport, so the card at the edge stays half in shot
    // and the reader keeps their place instead of jumping to unfamiliar cards.
    const step = Math.max(160, el.clientWidth * 0.8);
    el.scrollBy({
      left: dir * step,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    });
  };

  // With segments the row stays even when this one is empty: the control is the
  // only way back to the other side, and a row that vanishes on tap strands the
  // reader on a page that just lost the thing they were using.
  if (!releases.length && !segments) return null;

  return (
    <section
      className={compact ? 'landed landed--sub' : 'landed'}
      aria-labelledby={`landed-${slug(title)}`}
    >
      <div className="landed__head">
        {compact ? (
          <h3 className="landed__title" id={`landed-${slug(title)}`}>
            {title}
          </h3>
        ) : (
          <h2 className="landed__title" id={`landed-${slug(title)}`}>
            {title}
          </h2>
        )}
        {segments ? (
          <div className="landed__segs" role="tablist" aria-label={title}>
            {segments.map((s) => (
              <button
                key={s.id}
                role="tab"
                aria-selected={s.id === active}
                className="landed__seg"
                onClick={() => onSegment?.(s.id)}
              >
                {s.label}
                <span className="landed__segn">{s.count}</span>
              </button>
            ))}
          </div>
        ) : (
          <p className="landed__sub">{subtitle}</p>
        )}
        {/* Hidden from assistive tech: these duplicate the arrow keys and the
            track's own scrolling, and announcing "previous/next" twice on a
            list that is already navigable is noise. */}
        <div className="landed__arrows" aria-hidden="true">
          <button className="landed__arrow" onClick={() => page(-1)} disabled={atStart} tabIndex={-1}>
            <IconChevronLeft />
          </button>
          <button className="landed__arrow" onClick={() => page(1)} disabled={atEnd} tabIndex={-1}>
            <IconChevronRight />
          </button>
        </div>
      </div>

      {/* The edges say whether there is more, which the arithmetic cannot.
          A partial card at the right edge is the usual cue and it only works
          when the cards happen not to divide the track evenly — at 1280px they
          divide it almost exactly, 6.96 cards, and the row reads as finished.
          A fade that follows the actual scroll position is true at every width. */}
      {!releases.length && (
        <p className="landed__none">Nothing here in this window — try the other side.</p>
      )}
      <ul
        className="landed__track"
        ref={track}
        onScroll={measure}
        data-more={!atEnd || undefined}
        data-back={!atStart || undefined}
      >
        {releases.map((r, i) => {
          const p = platform(r.platforms[0]);
          const score = scoreOf(r);
          return (
            <li className="landed__cell" key={r.id}>
              <button
                className="landed__card"
                onClick={() => onOpen(r)}
                aria-label={`${r.title} — ${p.name}, ${caption(r)}`}
              >
                <span className="landed__art">
                  <PosterArt
                    title={r.title}
                    platformId={p.id}
                    imageUrl={r.posterUrl}
                    className="landed__img"
                    quiet
                    /* The first few are on screen before anything scrolls, so
                       they should not wait for the lazy loader; the rest
                       should. */
                    eager={i < 4}
                  />
                  <span className="landed__badge">
                    <PlatformLogo platformId={p.id} size={18} />
                  </span>
                  {score && (
                    <span className="landed__score" data-strong={score.strong || undefined}>
                      ★ {score.value.toFixed(1)}
                    </span>
                  )}
                </span>
                <span className="landed__name">{r.title}</span>
                <span className="landed__meta">{caption(r)}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * How near a date is, in the words a person uses, in either direction.
 *
 * A date under a poster ("2026-09-04") is a database row. "Today" and
 * "Tomorrow" are what make a row feel live, and past that the number of days is
 * what a reader is judging — not which Tuesday it was.
 *
 * Both directions in one function on purpose: the past-only version printed
 * "2 weeks ago" for everything it did not recognise, which was correct for the
 * one row that existed and would have been a confident lie the moment a second
 * row showed films that had not come out yet.
 */
export function relativeDay(iso: string, today: Date): string {
  const days = Math.round(
    (Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${todayISO(today)}T00:00:00Z`)) / 86_400_000,
  );
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days === -1) return 'Yesterday';
  if (days < 0) {
    const ago = -days;
    if (ago < 7) return `${ago} days ago`;
    if (ago < 14) return 'Last week';
    return `${Math.round(ago / 7)} weeks ago`;
  }
  if (days < 7) return `In ${days} days`;
  if (days < 14) return 'Next week';
  return `In ${Math.round(days / 7)} weeks`;
}

function todayISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}
