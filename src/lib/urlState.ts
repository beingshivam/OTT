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
 * `pinWeek` is false while the week was chosen *for* the reader — the landing
 * jump to the nearest stocked week. Writing that into the URL would freeze a
 * bookmark or a shared link to whichever week happened to be current when it was
 * copied, which is precisely wrong for a page about what's new this week. Only an
 * explicit week change belongs in the URL.
 */
export function writeFilters(
  f: Filters,
  defaults: Pick<Filters, 'weekId' | 'region'>,
  pinWeek: boolean,
): void {
  const p = new URLSearchParams();
  if (pinWeek && f.weekId !== defaults.weekId) p.set('w', f.weekId);
  if (f.region !== defaults.region) p.set('r', f.region);
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
