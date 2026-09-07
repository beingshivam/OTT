import { useEffect, useRef, useState } from 'react';
import { IconCheck, IconGrid, IconRows, IconShare } from './icons';
import { download } from '../lib/download';
import { renderShareCard, renderPosterCard } from '../lib/shareCard';
import { BRAND } from '../data/brand';
import { formatWeekRange } from '../lib/week';
import type { Filters, Release } from '../types';

/**
 * Turning the week into something that travels.
 *
 * What this competes with is a screenshot somebody takes and forwards, and a
 * screenshot carries no address — it spreads the content and strands the site.
 * So the site renders the image itself, with the URL on it twice: beside the
 * wordmark at the top, where a thumbnail is read and a crop is least likely to
 * cut, and again in the footer. Every forward is then a link back, which turns
 * the most common thing people do with this page into the way it grows.
 *
 * Two shapes, because they win different glances. The board is the schedule —
 * dense, scannable, the thing someone deciding what to watch actually wants.
 * The posters are the argument for looking at all, which is what an image in a
 * chat thread is competing to be. Neither is a worse version of the other, so
 * neither replaces the other.
 *
 * On a phone both hand the file to the OS share sheet, so it lands in WhatsApp
 * in one tap. Everywhere else they download.
 */

interface Props {
  releases: Release[];
  filters: Filters;
}

type Kind = 'board' | 'posters';
type State = 'idle' | 'working' | 'done' | 'error';

export function ShareWeek({ releases, filters }: Props) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<State>('idle');
  const [busy, setBusy] = useState<Kind | null>(null);
  const wrap = useRef<HTMLDivElement>(null);

  // A menu that outlives the click that dismissed it is the oldest bug in
  // dropdowns; close on an outside press and on Escape.
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

  async function make(kind: Kind) {
    setBusy(kind);
    setState('working');
    try {
      const opts = {
        releases,
        weekId: filters.weekId,
        siteUrl: window.location.origin,
      };
      const blob = kind === 'board' ? await renderShareCard(opts) : await renderPosterCard(opts);
      const name = `${BRAND.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${filters.weekId}${
        kind === 'posters' ? '-posters' : ''
      }.png`;
      const file = new File([blob], name, { type: 'image/png' });
      const text = `${formatWeekRange(filters.weekId)} — ${window.location.origin.replace(/^https?:\/\//, '')}`;

      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], text });
      } else {
        download(blob, name);
      }
      setState('done');
      setOpen(false);
      setTimeout(() => setState('idle'), 2200);
    } catch (err) {
      // A cancelled share sheet is a normal outcome, not a failure.
      if (err instanceof DOMException && err.name === 'AbortError') setState('idle');
      else setState('error');
    } finally {
      setBusy(null);
    }
  }

  const disabled = releases.length === 0;

  return (
    <div className="share" ref={wrap}>
      <button
        className="iconbtn"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Share this week as an image"
        title="Share this week as an image"
      >
        {state === 'done' ? <IconCheck /> : <IconShare />}
      </button>

      {open && (
        <div className="share__menu" role="menu">
          <p className="share__note">
            Saves a picture of this week with {window.location.host} on it.
          </p>
          <button
            className="share__item"
            role="menuitem"
            onClick={() => make('board')}
            disabled={state === 'working'}
          >
            <IconRows />
            <span>
              <strong>Board image</strong>
              <small>Every title, grouped by platform</small>
            </span>
            {busy === 'board' && <span className="share__spin" aria-hidden="true" />}
          </button>
          <button
            className="share__item"
            role="menuitem"
            onClick={() => make('posters')}
            disabled={state === 'working'}
          >
            <IconGrid />
            <span>
              <strong>Poster image</strong>
              <small>The week as artwork</small>
            </span>
            {busy === 'posters' && <span className="share__spin" aria-hidden="true" />}
          </button>
          {state === 'error' && <p className="share__error">That didn't render. Try again?</p>}
        </div>
      )}
    </div>
  );
}
