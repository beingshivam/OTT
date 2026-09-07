import { interleaveByLanguage } from './rank';
import { toISODate } from './week';
import type { Release } from '../types';

/**
 * What arrived recently and can be watched now.
 *
 * The board answers "what is out this Friday to Thursday", which is the right
 * question on a Friday and a worse one on a Wednesday: a film that landed nine
 * days ago is still new to almost everyone, and the only way to reach it is to
 * notice the week arrows and step back. That is a lot to ask of someone whose
 * actual question is what to watch tonight.
 *
 * So this reads across weeks rather than within one, and it deliberately keeps
 * cinema releases alongside streaming ones. Every competitor doing this in
 * India is streaming-only and structurally cannot put "in cinemas now" next to
 * "landed on Netflix" — that pairing is the thing this site has and they do
 * not, and it belongs in the first row a visitor sees.
 */

/** Two weeks. Long enough to carry a quiet Tuesday, short enough that
 *  "just landed" stays true — a month would be a lie in a category where a
 *  fortnight is already old news. */
export const WINDOW_DAYS = 14;

/** Below this the row looks like a mistake rather than a selection, and the
 *  text strip it replaces is the better thing to show. */
export const MIN_ITEMS = 6;

/** More than a reader will ever scroll, and past this the tail is titles that
 *  did not earn a poster's worth of attention. */
export const MAX_ITEMS = 20;

export interface JustLanded {
  releases: Release[];
  /** The first day in the window, so the caller can say what "recently" meant. */
  from: string;
  to: string;
}

export function justLanded(
  all: Release[],
  region: string,
  today: Date = new Date(),
): JustLanded {
  const to = toISODate(today);
  const from = toISODate(new Date(today.getTime() - (WINDOW_DAYS - 1) * 86_400_000));

  const landed = all.filter(
    (r) =>
      r.regions?.includes(region) &&
      r.releaseDate >= from &&
      r.releaseDate <= to &&
      // A rail is artwork. A row without a poster would render as generated
      // fallback art beside real posters, which reads as a broken image rather
      // than a design — it is honest on the board, where it sits among text,
      // and conspicuous here. It stays on the board either way.
      Boolean(r.posterUrl),
  );

  /**
   * Newest first, and languages interleaved only within a day.
   *
   * The per-language rule exists because TMDB's popularity and vote counts
   * measure how well represented a language is in TMDB's audience, not how good
   * or how watched a title is — so those numbers cannot be compared across
   * languages. A release date carries no such bias: the 4th is the 4th in every
   * language. Interleaving the whole row would therefore trade a fair ordering
   * for a scrambled one, putting a twelve-day-old Bengali film above yesterday's
   * Hindi release and making "just landed" describe something the row is not
   * doing.
   *
   * So the two rules are applied where each is true. Days sort against each
   * other directly. Within one day, where the only tiebreaker left is heat and
   * heat is exactly the incomparable number, the languages interleave.
   */
  const byDay = new Map<string, Release[]>();
  for (const r of landed) {
    if (!byDay.has(r.releaseDate)) byDay.set(r.releaseDate, []);
    byDay.get(r.releaseDate)!.push(r);
  }

  const releases = [...byDay.keys()]
    .sort((a, b) => b.localeCompare(a))
    .flatMap((day) =>
      interleaveByLanguage(byDay.get(day)!, (a, b) => (b.heat ?? 0) - (a.heat ?? 0)),
    )
    .slice(0, MAX_ITEMS);

  return { releases, from, to };
}

/** The other direction. Shorter, because anticipation has a shorter reach than
 *  memory: a reader plans this weekend, not the one after next. */
export const SOON_DAYS = 21;

/**
 * What is about to arrive.
 *
 * The mirror of the row above, and it has to be a different selection rather
 * than the same one relabelled — "just landed" over a film that is not out for
 * a fortnight is simply false, and a row that lies about the one thing it
 * claims is worse than no row.
 *
 * Ordering flips with it. Landing is ranked newest-first because the freshest
 * arrival is the most interesting; landing *soon* is ranked nearest-first,
 * because the thing coming on Friday matters more than the thing coming in
 * three weeks. Same rule underneath: days sort against each other directly,
 * languages interleave only within a day.
 */
export function landingSoon(all: Release[], region: string, today: Date = new Date()): JustLanded {
  const from = toISODate(new Date(today.getTime() + 86_400_000));
  const to = toISODate(new Date(today.getTime() + SOON_DAYS * 86_400_000));

  const upcoming = all.filter(
    (r) =>
      r.regions?.includes(region) &&
      r.releaseDate >= from &&
      r.releaseDate <= to &&
      Boolean(r.posterUrl),
  );

  const byDay = new Map<string, Release[]>();
  for (const r of upcoming) {
    if (!byDay.has(r.releaseDate)) byDay.set(r.releaseDate, []);
    byDay.get(r.releaseDate)!.push(r);
  }

  const releases = [...byDay.keys()]
    .sort((a, b) => a.localeCompare(b))
    .flatMap((day) =>
      interleaveByLanguage(byDay.get(day)!, (a, b) => (b.heat ?? 0) - (a.heat ?? 0)),
    )
    .slice(0, MAX_ITEMS);

  return { releases, from, to };
}

/**
 * The catalogue's own row.
 *
 * /streaming is not a calendar — its rows have no meaningful recent date, and a
 * "just landed" row there would either be empty or be the homepage again. What
 * that page has instead is `popRank`, a position within a title's own language,
 * which is the only popularity number on this site that compares fairly.
 *
 * So this is the one row of the three that is not chronological at all, and it
 * still cannot be a plain sort: `popRank` is comparable within a language and
 * meaningless across them, so the interleave is doing the whole job here rather
 * than breaking ties.
 */
export function popularNow(catalogue: Release[], region: string): Release[] {
  const scoped = catalogue.filter(
    (r) => r.popRank != null && Boolean(r.posterUrl) && (!r.regions || r.regions.includes(region)),
  );
  return interleaveByLanguage(scoped, (a, b) => a.popRank! - b.popRank!).slice(0, MAX_ITEMS);
}
