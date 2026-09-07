import { useCallback, useEffect, useRef, useState } from 'react';
import { PosterArt } from './PosterArt';
import { PlatformLogo } from './PlatformLogo';
import { IconChevronLeft, IconChevronRight } from './icons';
import { platform } from '../data/platforms';
import { scoreOf } from '../lib/score';
import { WINDOW_DAYS } from '../lib/justLanded';
import type { Release } from '../types';

/**
 * The first thing a visitor sees, and the only place on the site that leads
 * with artwork.
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
 */

interface Props {
  releases: Release[];
  onOpen: (r: Release) => void;
  today: Date;
}

export function JustLanded({ releases, onOpen, today }: Props) {
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

  if (!releases.length) return null;

  return (
    <section className="landed" aria-labelledby="landed-heading">
      <div className="landed__head">
        <h2 className="landed__title" id="landed-heading">
          Just landed
        </h2>
        <p className="landed__sub">Out in the last {WINDOW_DAYS} days — streaming and in cinemas</p>
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
                aria-label={`${r.title} — ${p.name}, ${landedLabel(r.releaseDate, today)}`}
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
                <span className="landed__meta">{landedLabel(r.releaseDate, today)}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * How long ago, in the words a person uses.
 *
 * A date under a poster ("2026-09-04") is a database row. "Today" and
 * "Yesterday" are what makes the row feel live, and past that the number of
 * days is what a reader is actually judging — not which Tuesday it was.
 */
export function landedLabel(iso: string, today: Date): string {
  const days = Math.round(
    (Date.parse(`${todayISO(today)}T00:00:00Z`) - Date.parse(`${iso}T00:00:00Z`)) / 86_400_000,
  );
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 14) return 'Last week';
  return '2 weeks ago';
}

function todayISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}
