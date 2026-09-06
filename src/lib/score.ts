import type { Release } from '../types';

/**
 * Which score a title shows, and whether it can be leaned on.
 *
 * Two sources sit on every row and they are not interchangeable: TMDB polls a
 * small, self-selecting crowd, IMDb a very large one, and the same film lands a
 * few tenths apart on each. Five places in the app read a score — the card, the
 * detail sheet, the title page, the "best rated" pill and the ranked sort — and
 * each had its own rule. Left that way, adding IMDb anywhere would have had the
 * card showing one number while the sort beside it ordered by another, which is
 * the sort of disagreement a reader notices and cannot explain.
 *
 * So the choice is made once, here.
 *
 * IMDb wins where it is trustworthy, because where it has data it has far more
 * of it: Silo's 8.1 rests on 218,000 votes, and no TMDB figure on this feed
 * comes close to that. It does not always have data — of 124 released India
 * rows it scored 9, against TMDB's 45 — because its coverage of Indian regional
 * cinema is thin. So TMDB remains the fallback rather than being replaced.
 */

/** Worth drawing the eye to: genuinely well-liked, on enough votes to mean it. */
export const STRONG_SCORE = 7.5;

/** TMDB's crowd is small enough that a handful of votes is noise. */
export const TMDB_MIN_VOTES = 50;

/**
 * IMDb's floor is far higher because its failure mode is different: not a thin
 * sample drifting, but a small film's fans arriving in a block.
 */
export const IMDB_MIN_VOTES = 1000;

/**
 * Above this, disbelieve it.
 *
 * The best-reviewed film on IMDb sits around 9.3, so a title claiming better
 * than the best film ever made is reporting a campaign rather than a reception.
 * This feed already contains one: a small theatrical release at a flat 10.0
 * from 1,029 votes — over the vote floor, and still not a real number. A vote
 * minimum alone does not catch that, which is why there is a ceiling as well;
 * ranked by score without it, that title would have led the page.
 */
export const IMDB_MAX_CREDIBLE = 9.5;

export interface Score {
  value: number;
  votes?: number;
  /** Named in the tooltip, because a number with no provenance invites the
   *  reader to assume it came from wherever they already trust. */
  source: 'IMDb' | 'TMDB';
  /** Enough votes behind it to be worth acting on. */
  confident: boolean;
  /** Well-liked *and* confident — the only combination that earns the colour. */
  strong: boolean;
}

export function scoreOf(release: Release): Score | null {
  const { imdbRating, imdbVotes } = release;

  if (
    imdbRating != null &&
    imdbVotes != null &&
    imdbVotes >= IMDB_MIN_VOTES &&
    imdbRating <= IMDB_MAX_CREDIBLE
  ) {
    return {
      value: imdbRating,
      votes: imdbVotes,
      source: 'IMDb',
      confident: true,
      strong: imdbRating >= STRONG_SCORE,
    };
  }

  if (release.rating == null) return null;

  /**
   * A missing vote count means a hand-checked curated row, not a thinly-voted
   * one — every discovered score carries its count by construction. Reading
   * undefined as zero demoted exactly the wrong titles: Silo at 8.2 rendered in
   * the same grey as a 5.5, because the vote gate meant for noisy crowd scores
   * was being applied to a score that was never a crowd score.
   */
  const confident = release.votes == null || release.votes >= TMDB_MIN_VOTES;
  return {
    value: release.rating,
    votes: release.votes,
    source: 'TMDB',
    confident,
    strong: release.rating >= STRONG_SCORE && confident,
  };
}

/** The tooltip, phrased the same everywhere it appears. */
export function scoreTitle(score: Score): string {
  const n = score.value.toFixed(1);
  if (!score.votes) return `${n} on ${score.source}`;
  return `${n} on ${score.source}, from ${score.votes.toLocaleString()} vote${
    score.votes === 1 ? '' : 's'
  }`;
}
