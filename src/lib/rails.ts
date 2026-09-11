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
  /** How many qualified before the row was capped. The segment control shows
   *  this rather than releases.length, which is MAX_ITEMS on any busy week and
   *  would have told a reader both sides held exactly twenty. */
  total: number;
  /** The first day in the window, so the caller can say what "recently" meant. */
  from: string;
  to: string;
  /**
   * How many leading cards to mark as the standouts.
   *
   * Zero on every row but the cinema one, which is the only row not ordered by
   * date — the badge is what tells a reader the order is attention rather than
   * recency, so a row too thin to have standouts sets nothing and says nothing.
   */
  trending?: number;
}

/**
 * The shared machinery: pick a date range, keep what belongs, order by day and
 * interleave languages within one.
 *
 * Extracted when the row gained segments and a third copy of this loop was
 * about to appear. The rules it encodes — days compare directly, popularity
 * does not compare across languages — are the same rules in every row, and
 * three hand-copied versions of them is three chances to fix a bug twice.
 */
function chronicle(
  all: Release[],
  region: string,
  opts: { from: string; to: string; newestFirst: boolean; where?: (r: Release) => boolean },
): JustLanded {
  const { from, to, newestFirst, where } = opts;
  const rows = all.filter(
    (r) =>
      r.regions?.includes(region) &&
      r.releaseDate >= from &&
      r.releaseDate <= to &&
      (!where || where(r)) &&
      Boolean(r.posterUrl),
  );

  const byDay = new Map<string, Release[]>();
  for (const r of rows) {
    if (!byDay.has(r.releaseDate)) byDay.set(r.releaseDate, []);
    byDay.get(r.releaseDate)!.push(r);
  }

  const releases = [...byDay.keys()]
    .sort((a, b) => (newestFirst ? b.localeCompare(a) : a.localeCompare(b)))
    .flatMap((day) =>
      interleaveByLanguage(byDay.get(day)!, (a, b) => (b.heat ?? 0) - (a.heat ?? 0)),
    )
    .slice(0, MAX_ITEMS);

  return { releases, from, to, total: rows.length };
}

/** True when a row is a cinema listing. A film can be both — showing in
 *  cinemas and already streaming — and belongs in both segments when it is. */
const showing = (r: Release) => r.platforms.includes('theatres');
const streaming = (r: Release) => r.platforms.some((p) => p !== 'theatres');

/**
 * How far back a film still counts as showing.
 *
 * A cinema run is four to eight weeks against streaming's fortnight, and the
 * two were sharing a window because they were one row. Splitting the row is
 * what makes the longer window possible: "just landed" over a five-week-old
 * film was false, "in cinemas" over one still playing is not.
 */
export const CINEMA_DAYS = 42;

/**
 * How many leading cards wear the badge.
 *
 * Three, because the question this answers is "what is the big film on right
 * now" and that question has about three answers in any given week. The badge
 * is a signpost rather than a cut — the whole row is ranked the same way — and
 * three is what a reader scanning a poster row takes in before they start
 * swiping.
 */
export const TRENDING_IN_CINEMAS = 3;

/**
 * What is playing now — the segment that had nowhere to live before, and the
 * only question on this site no streaming-only competitor can answer.
 *
 * The one row here that is not a calendar. Every other row answers "what is
 * new", where the date is the news and chronology is the honest spine. This one
 * answers "what is on", and for a medium where a hit plays for six weeks those
 * are different questions with different answers.
 *
 * Date order gave the wrong one, and not marginally. On 11 September the row
 * held twenty cards: three promoted on attention, and then seventeen films that
 * had opened in the previous forty-eight hours — heat 0 to 17, several with no
 * rating at all. Hanuman Ansh, rated 8.6 and still playing five weeks in, sat
 * seventieth of eighty-nine. A reader asking what is on at the cinema was being
 * shown two days of small openings and told that was the answer.
 *
 * So the whole row ranks by attention, not just its head. The films that opened
 * this morning are not lost — the board directly beneath this row is the
 * current week in date order, which is where "what opened today" belongs and
 * where it reads as news rather than as a ranking nobody made.
 *
 * And ranked flat, without the per-language interleave that guards every other
 * list on this site. That is a deliberate exception, asked for and worth
 * naming: interleaving asks each language for its best in turn, so a week that
 * one language genuinely owns comes out looking like a week five languages
 * shared. For a shortlist of what is big in Indian cinemas right now, that is a
 * fairness the reader did not ask for and cannot see the benefit of. The guard
 * still holds everywhere it was built for — the day-by-day rows, the catalogue,
 * the best-rated lists — where the job is to spread a field rather than to say
 * which film is the big one.
 */
export function inCinemas(all: Release[], region: string, today: Date = new Date()): JustLanded {
  const from = toISODate(new Date(today.getTime() - (CINEMA_DAYS - 1) * 86_400_000));
  const to = toISODate(today);

  /*
   * The count is everything playing, not everything with artwork.
   *
   * A poster row cannot show a card with no poster, so the row is gated on one.
   * But the count is what the heading prints and what the link to /in-cinemas
   * promises, and that page has no poster gate because it is a text board — so
   * the rail said 89 and the page it linked to said 93. Whichever number is
   * right, two of them is wrong.
   */
  const playing = all.filter(
    (r) => r.regions?.includes(region) && r.releaseDate >= from && r.releaseDate <= to && showing(r),
  );

  const releases = playing
    .filter((r) => Boolean(r.posterUrl))
    // Ties break to the newer film: two titles drawing equal attention, the one
    // that opened this week is the more useful answer to "what is on".
    .sort(
      (a, b) => (b.heat ?? 0) - (a.heat ?? 0) || b.releaseDate.localeCompare(a.releaseDate),
    )
    .slice(0, MAX_ITEMS);

  const row: JustLanded = { releases, from, to, total: playing.length };

  // A row with nothing but standouts is the whole row wearing a badge, which
  // tells a reader nothing. Then it is simply a short ranked row, unmarked.
  if (releases.length <= TRENDING_IN_CINEMAS) return row;
  return { ...row, trending: TRENDING_IN_CINEMAS };
}

/** The same fortnight the mixed row always used, narrowed to things you can
 *  actually stream tonight. */
export function landedOnOtt(all: Release[], region: string, today: Date = new Date()): JustLanded {
  return chronicle(all, region, {
    from: toISODate(new Date(today.getTime() - (WINDOW_DAYS - 1) * 86_400_000)),
    to: toISODate(today),
    newestFirst: true,
    where: streaming,
  });
}

export function justLanded(
  all: Release[],
  region: string,
  today: Date = new Date(),
): JustLanded {
  /**
   * Newest first, and languages interleaved only within a day — see chronicle,
   * which now owns both rules.
   *
   * The per-language rule exists because TMDB's popularity and vote counts
   * measure how well represented a language is in TMDB's audience, not how good
   * or how watched a title is — so those numbers cannot be compared across
   * languages. A release date carries no such bias: the 4th is the 4th in every
   * language. Interleaving the whole row would trade a fair ordering for a
   * scrambled one, putting a twelve-day-old Bengali film above yesterday's
   * Hindi release and making "just landed" describe something the row is not
   * doing.
   *
   * No `where`: this is the mixed row, cinema beside streaming, which is the
   * pairing the site is built on. The segments narrow it; they do not replace
   * it, and /upcoming and the prerendered pages still read it whole.
   */
  return chronicle(all, region, {
    from: toISODate(new Date(today.getTime() - (WINDOW_DAYS - 1) * 86_400_000)),
    to: toISODate(today),
    newestFirst: true,
  });
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
  return chronicle(all, region, {
    from: toISODate(new Date(today.getTime() + 86_400_000)),
    to: toISODate(new Date(today.getTime() + SOON_DAYS * 86_400_000)),
    // Nearest-first, the opposite of every other row: the thing coming on
    // Friday matters more than the thing coming in three weeks.
    newestFirst: false,
  });
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
