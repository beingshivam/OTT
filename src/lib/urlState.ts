import type { Filters, SortKey, TitleKind } from '../types';

/**
 * Filters live in the URL so any view is shareable — "here's every Tamil film
 * dropping this week" is a link, not a screenshot. No login needed to share state.
 */

const KIND_VALUES: TitleKind[] = ['film', 'series', 'documentary', 'reality', 'anime', 'special'];
const SORT_VALUES: SortKey[] = ['trending', 'newest', 'rating', 'az'];

function list(params: URLSearchParams, key: string): string[] {
  const raw = params.get(key);
  return raw ? raw.split(',').filter(Boolean) : [];
}

export function readFilters(defaults: Pick<Filters, 'weekId' | 'region'>): Filters {
  const p = new URLSearchParams(window.location.search);
  const sort = p.get('sort') as SortKey | null;
  return {
    weekId: p.get('w') ?? defaults.weekId,
    region: p.get('r') ?? defaults.region,
    platforms: list(p, 'p'),
    kinds: list(p, 't').filter((k): k is TitleKind => KIND_VALUES.includes(k as TitleKind)),
    languages: list(p, 'l'),
    genres: list(p, 'g'),
    query: p.get('q') ?? '',
    sort: sort && SORT_VALUES.includes(sort) ? sort : 'trending',
  };
}

/**
 * `pinned` separates what the reader chose from what was chosen for them.
 *
 * The landing jump to the nearest stocked week, and the region guessed from the
 * browser locale, are both defaults — writing them into the URL would freeze a
 * bookmark or a shared link to whichever week happened to be current when it was
 * copied, which is precisely wrong for a page about what's new this week.
 *
 * An explicit choice is the opposite: it has to survive the link, and for the
 * region it is written unconditionally rather than compared against the default.
 * Comparing was the bug — picking a region also saved it as the reader's own
 * default, so the two were equal by the time this ran and `r` was never written
 * at all. Sharing a US board sent a link that rendered as India for anyone whose
 * own default was India.
 */
export function writeFilters(
  f: Filters,
  defaults: Pick<Filters, 'weekId' | 'region'>,
  pinned: { week: boolean; region: boolean },
): void {
  const p = new URLSearchParams();
  if (pinned.week && f.weekId !== defaults.weekId) p.set('w', f.weekId);
  if (pinned.region) p.set('r', f.region);
  if (f.platforms.length) p.set('p', f.platforms.join(','));
  if (f.kinds.length) p.set('t', f.kinds.join(','));
  if (f.languages.length) p.set('l', f.languages.join(','));
  if (f.genres.length) p.set('g', f.genres.join(','));
  if (f.query) p.set('q', f.query);
  if (f.sort !== 'trending') p.set('sort', f.sort);

  const qs = p.toString();
  const next = `${window.location.pathname}${qs ? `?${qs}` : ''}`;
  if (next !== `${window.location.pathname}${window.location.search}`) {
    window.history.replaceState(null, '', next);
  }
}
