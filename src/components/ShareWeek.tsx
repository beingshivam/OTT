import { useState } from 'react';
import { IconCheck, IconShare } from './icons';
import { KIND_LABEL, languageName, platform } from '../data/platforms';
import { download } from '../lib/download';
import { renderShareCard } from '../lib/shareCard';
import { formatWeekRange } from '../lib/week';
import type { Filters, Release } from '../types';

/**
 * Turns the week on screen into a PNG for a chat thread.
 *
 * On a phone this hands the file straight to the OS share sheet, so it lands in
 * WhatsApp in two taps — the exact path the forwarded calendar image already
 * takes. Elsewhere it downloads. Either way the card carries the URL, so the
 * share is a link back rather than a copy that leaves.
 */

interface Props {
  releases: Release[];
  filters: Filters;
}

type State = 'idle' | 'working' | 'done' | 'error';

/** Describes the active filters in the card's own words, so it explains itself. */
function describe(filters: Filters): string | undefined {
  const parts = [
    ...filters.platforms.map((p) => platform(p).short),
    ...filters.kinds.map((k) => KIND_LABEL[k] ?? k),
    ...filters.languages.map(languageName),
    ...filters.genres,
  ];
  if (filters.query) parts.push(`"${filters.query}"`);
  return parts.length ? parts.join(' · ') : undefined;
}

export function ShareWeek({ releases, filters }: Props) {
  const [state, setState] = useState<State>('idle');

  async function share() {
    if (state === 'working' || releases.length === 0) return;
    setState('working');
    try {
      const blob = await renderShareCard({
        releases,
        weekId: filters.weekId,
        filterNote: describe(filters),
        siteUrl: window.location.origin,
      });
      const file = new File([blob], `firstday-${filters.weekId}.png`, { type: 'image/png' });
      const text = `What's new ${formatWeekRange(filters.weekId)} — ${window.location.href}`;

      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], text });
        setState('idle');
        return;
      }

      download(blob, file.name);
      setState('done');
      setTimeout(() => setState('idle'), 2000);
    } catch (err) {
      // A cancelled share sheet is a normal outcome, not a failure.
      if ((err as Error)?.name === 'AbortError') setState('idle');
      else setState('error');
    }
  }

  return (
    <button
      className="btn btn--sm"
      onClick={share}
      disabled={releases.length === 0}
      aria-label="Share this week as an image"
    >
      {state === 'done' ? <IconCheck /> : <IconShare />}
      {state === 'working' ? 'Rendering…' : state === 'error' ? 'Try again' : 'Share'}
    </button>
  );
}
