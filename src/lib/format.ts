import { KIND_LABEL, languageName } from '../data/platforms';
import type { Release } from '../types';

/**
 * The one-line description of a title: what it is, what language, what genre.
 *
 * Genre is dropped when it merely repeats the type — TMDB files documentaries
 * under the "Documentary" genre and reality shows under "Reality", so the naive
 * join produces "Reality · English · Reality".
 */
export function metaLine(release: Release, maxGenres = 2): string {
  const kind = KIND_LABEL[release.kind] ?? release.kind;
  const genres = release.genres
    .filter((g) => g.toLowerCase() !== kind.toLowerCase())
    .slice(0, maxGenres);

  return [kind, release.languages.map(languageName).join(', '), genres.join(', ')]
    .filter(Boolean)
    .join(' · ');
}
