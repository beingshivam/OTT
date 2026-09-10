import { KIND_LABEL, languageName } from '../data/platforms';
import type { Release } from '../types';

/**
 * The one-line description of a title: what it is, what language, what genre.
 *
 * Genre is dropped when it merely repeats the type — TMDB files documentaries
 * under the "Documentary" genre and reality shows under "Reality", so the naive
 * join produces "Reality · English · Reality".
 */
export function metaLine(release: Release, maxGenres = 2, withKind = true): string {
  const kind = KIND_LABEL[release.kind] ?? release.kind;
  const genres = release.genres
    .filter((g) => g.toLowerCase() !== kind.toLowerCase())
    .slice(0, maxGenres);

  return [withKind ? kind : '', release.languages.map(languageName).join(', '), genres.join(', ')]
    .filter(Boolean)
    .join(' · ');
}

/**
 * "2h 8m", "48m", or nothing.
 *
 * The feed has carried a runtime for two thirds of its films all along, and it
 * was reachable only by opening a title — so to anyone scanning the board the
 * honest answer to "does it show runtimes" was no. It is the second question
 * people ask after what a thing is, and often the deciding one on a weeknight,
 * which makes it worth the eight characters it costs on a line that already
 * exists.
 *
 * Empty string rather than a placeholder when it is missing: about a third of
 * rows have none, and "—" repeated down a column reads as a broken field. The
 * callers join on ' · ' and drop empties, so an absent runtime leaves no seam.
 */
export function runtimeLabel(minutes?: number): string {
  if (!minutes || minutes <= 0) return '';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/**
 * The same, but only where the number means what a reader will take it to mean.
 *
 * TMDB stores one figure per title. On a film that is the film; on a series it
 * is `episode_run_time`, the length of *an episode* — and "The Court · Series ·
 * 1h" on a line that otherwise describes the whole thing reads as a one-hour
 * series. It is carried by three of the twenty-four series in the feed anyway,
 * so suppressing it costs almost nothing and removes a claim that is wrong
 * more often than it is right.
 *
 * The detail sheet still shows it, under a label that says which it is.
 */
export function listRuntime(release: Release): string {
  if (release.kind === 'series' || release.kind === 'reality') return '';
  return runtimeLabel(release.runtimeMinutes);
}
