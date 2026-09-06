import type { Filters, Release, SortKey, TitleKind } from '../types';
import { scoreOf } from './score';

export const EMPTY_FILTERS: Omit<Filters, 'weekId' | 'region'> = {
  platforms: [],
  kinds: [],
  languages: [],
  genres: [],
  query: '',
  sort: 'trending',
};

/** Cheap fuzzy-ish match: every whitespace-separated term must appear somewhere. */
function matchesQuery(r: Release, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = [r.title, r.director ?? '', ...(r.cast ?? []), ...r.genres].join(' ').toLowerCase();
  return q.split(/\s+/).every((term) => hay.includes(term));
}

export function applyFilters(releases: Release[], f: Filters): Release[] {
  const out = releases.filter((r) => {
    if (!r.regions.includes(f.region)) return false;
    if (f.platforms.length && !r.platforms.some((p) => f.platforms.includes(p))) return false;
    if (f.kinds.length && !f.kinds.includes(r.kind)) return false;
    if (f.languages.length && !r.languages.some((l) => f.languages.includes(l))) return false;
    if (f.genres.length && !r.genres.some((g) => f.genres.includes(g))) return false;
    return matchesQuery(r, f.query);
  });
  return sortReleases(out, f.sort);
}

export function sortReleases(releases: Release[], sort: SortKey): Release[] {
  const out = [...releases];
  switch (sort) {
    case 'newest':
      return out.sort(
        (a, b) => a.releaseDate.localeCompare(b.releaseDate) || (b.heat ?? 0) - (a.heat ?? 0),
      );
    case 'rating': {
      // Through lib/score.ts, so the order matches the number each card shows —
      // sorting by TMDB while the cards displayed IMDb would put an 8.1 above
      // an 8.6 in plain sight. Unrated titles sink rather than pretending to be
      // zero-star.
      const value = (r: Release) => scoreOf(r)?.value ?? -1;
      return out.sort((a, b) => value(b) - value(a) || (b.heat ?? 0) - (a.heat ?? 0));
    }
    case 'az':
      return out.sort((a, b) => a.title.localeCompare(b.title));
    case 'trending':
    default:
      return out.sort(
        (a, b) => (b.heat ?? 0) - (a.heat ?? 0) || a.releaseDate.localeCompare(b.releaseDate),
      );
  }
}

/** Only offer facets that exist in the current region's data — no dead-end chips. */
export function facetsFor(releases: Release[], region: string) {
  const scoped = releases.filter((r) => r.regions.includes(region));
  const platforms = new Map<string, number>();
  const languages = new Map<string, number>();
  const genres = new Map<string, number>();
  const kinds = new Map<TitleKind, number>();

  for (const r of scoped) {
    for (const p of r.platforms) platforms.set(p, (platforms.get(p) ?? 0) + 1);
    for (const l of r.languages) languages.set(l, (languages.get(l) ?? 0) + 1);
    for (const g of r.genres) genres.set(g, (genres.get(g) ?? 0) + 1);
    kinds.set(r.kind, (kinds.get(r.kind) ?? 0) + 1);
  }
  const byCount = <T,>(m: Map<T, number>) =>
    [...m.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));

  return {
    platforms: byCount(platforms),
    languages: byCount(languages),
    genres: byCount(genres),
    kinds: byCount(kinds),
    total: scoped.length,
  };
}

export function activeFilterCount(f: Filters): number {
  return (
    f.platforms.length + f.kinds.length + f.languages.length + f.genres.length + (f.query ? 1 : 0)
  );
}

export function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}
