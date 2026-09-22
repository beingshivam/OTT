import { useEffect, useRef, useState } from 'react';
import { IconCalendar, IconClose, IconGrid, IconSparkle, IconTicket } from './icons';
import { EmailSignup } from './EmailSignup';
import { ShareWeek } from './ShareWeek';
import { EMAIL_ENDPOINT } from '../data/config';
import type { Filters, Release } from '../types';

/**
 * Everything that used to live beside the wordmark.
 *
 * The header held a mark, a wordmark, an Instagram link, a share popover, a
 * subscribe popover and a search toggle. At 390px that is six controls and a
 * name across 358 usable pixels, and search — the one control that earns its
 * place, and the one this site's highest-intent traffic arrives wanting — was
 * reduced to a 34px circle at the end of the row.
 *
 * So search takes the header and everything else comes in here. Nothing is
 * removed: the two popovers open inline as sections rather than as popovers of
 * their own, which is also how they stop being two menus that can be open at
 * once on top of each other.
 *
 * The three lenses are repeated here from the band below. That band stays —
 * it is the primary way to change what the board is showing, it is prerendered,
 * and it carries `aria-current` — but a reader who has scrolled a screen and a
 * half of releases should not have to scroll back to change view.
 */

interface Props {
  /** What a share card would be drawn from; empty disables the two items. */
  releases: Release[];
  filters: Filters;
  /** False on a month page or the catalogue, where a card cannot honestly name
   *  the week it holds — the same condition that used to hide the share
   *  button entirely. */
  canShare: boolean;
}

export function HeaderMenu({ releases, filters, canShare }: Props) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  /* The board behind a full-height phone panel should not scroll under it —
     the oldest and most obvious drawer bug. */
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    if (open) requestAnimationFrame(() => panel.current?.focus());
  }, [open]);

  return (
    <div className="hmenu" ref={wrap} data-open={open || undefined}>
      <button
        className="hmenu__toggle"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={open ? 'Close menu' : 'Menu'}
      >
        {open ? <IconClose /> : <Bars />}
      </button>

      {open && (
        <>
          <div className="hmenu__scrim" onClick={() => setOpen(false)} aria-hidden="true" />
          <div className="hmenu__panel" ref={panel} tabIndex={-1} role="dialog" aria-label="Menu">
            <nav className="hmenu__group" aria-label="Browse">
              <a className="hmenu__item" href="/">
                <IconCalendar />
                <span>
                  <strong>This week</strong>
                  <small>Friday to Thursday, every platform</small>
                </span>
              </a>
              <a className="hmenu__item" href="/streaming">
                <IconGrid />
                <span>
                  <strong>Now streaming</strong>
                  <small>The back catalogue, worth watching</small>
                </span>
              </a>
              <a className="hmenu__item" href="/upcoming">
                <IconTicket />
                <span>
                  <strong>Coming soon</strong>
                  <small>Dates already announced</small>
                </span>
              </a>
              <a className="hmenu__item" href="/changes">
                <IconSparkle />
                <span>
                  <strong>What changed today</strong>
                  <small>Dates moved, platforms named</small>
                </span>
              </a>
            </nav>

            {/* Inline rather than a popover inside a popover. The two used to
                be separate menus in the header and could both be open at once,
                overlapping. */}
            {canShare && (
              <div className="hmenu__group">
                <p className="hmenu__label">Share this week</p>
                <ShareWeek releases={releases} filters={filters} inline />
              </div>
            )}

            {EMAIL_ENDPOINT && (
              <div className="hmenu__group">
                <p className="hmenu__label">Get the Friday list</p>
                <p className="hmenu__pitch">Each week's releases, in your inbox.</p>
                <EmailSignup />
              </div>
            )}

          </div>
        </>
      )}
    </div>
  );
}

/** Three rules. Drawn here rather than in icons.tsx because it is the only
 *  place a hamburger appears and it shares nothing with the set. */
const Bars = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
    <path d="M4 7h16M4 12h16M4 17h16" />
  </svg>
);
