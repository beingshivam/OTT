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
