import type { Filters, SortKey, TitleKind } from '../types';
import type { Route } from './route';

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

/**
 * `route` is what the path already says — /netflix means the Netflix platform,
 * /w/<date> means that week. It seeds the filters the page was built to show,
 * and an explicit query parameter still wins over it, so a link like
 * /netflix?p=netflix,prime keeps working and stays shareable.
 */
export function readFilters(
  defaults: Pick<Filters, 'weekId' | 'region'>,
  route: Route | null = null,
): Filters {
  const p = new URLSearchParams(window.location.search);
  const sort = p.get('sort') as SortKey | null;
  const platforms = list(p, 'p');
  const languages = list(p, 'l');
  return {
    weekId: p.get('w') ?? route?.weekId ?? defaults.weekId,
    region: p.get('r') ?? defaults.region,
    platforms: platforms.length ? platforms : (route?.platforms ?? []),
    kinds: list(p, 't').filter((k): k is TitleKind => KIND_VALUES.includes(k as TitleKind)),
    languages: languages.length ? languages : (route?.languages ?? []),
    genres: list(p, 'g'),
    query: p.get('q') ?? '',
    sort: sort && SORT_VALUES.includes(sort) ? sort : 'trending',
  };
}

/** True when a filter is exactly what the path already says, and so does not
 *  need repeating in the query string. */
const sameList = (a: string[], b: string[] | undefined) =>
  b !== undefined && a.length === b.length && a.every((x, i) => x === b[i]);

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
  route: Route | null = null,
): void {
  const p = new URLSearchParams();
  /**
   * Anything the path already states is left out of the query.
   *
   * Without this, landing on /netflix immediately rewrote the address to
   * /netflix?p=netflix — the same content reachable at two URLs, which is the
   * duplicate-content problem the per-page canonicals exist to avoid, created
   * by our own code a tick after the page loaded.
   */
  if (pinned.week && f.weekId !== defaults.weekId && f.weekId !== route?.weekId) p.set('w', f.weekId);
  if (pinned.region) p.set('r', f.region);
  if (f.platforms.length && !sameList(f.platforms, route?.platforms)) p.set('p', f.platforms.join(','));
  if (f.kinds.length) p.set('t', f.kinds.join(','));
  if (f.languages.length && !sameList(f.languages, route?.languages)) p.set('l', f.languages.join(','));
  if (f.genres.length) p.set('g', f.genres.join(','));
  if (f.query) p.set('q', f.query);
  if (f.sort !== 'trending') p.set('sort', f.sort);

  const qs = p.toString();
  const next = `${window.location.pathname}${qs ? `?${qs}` : ''}`;
  if (next !== `${window.location.pathname}${window.location.search}`) {
    window.history.replaceState(null, '', next);
  }
}
