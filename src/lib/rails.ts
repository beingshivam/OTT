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
   * How many of the leading releases are there on merit rather than on date.
   *
   * Zero on every row but the cinema one. The caller marks this many cards and
   * says nothing otherwise, so a row that could not rank anything degrades to
   * the plain chronological row it always was.
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
 * How many cinema listings lead on attention rather than on date.
 *
 * Three, because the question this answers is "what is the big film on right
 * now" and that question has about three answers in any given week. More and it
 * stops being a shortlist; fewer and a reader whose language is not one of them
 * gets nothing.
 */
export const TRENDING_IN_CINEMAS = 3;

/**
 * What is playing now — the segment that had nowhere to live before, and the
 * only question on this site no streaming-only competitor can answer.
 *
 * Sorted newest-first like every other row, with one exception at the front: a
 * cinema run lasts six weeks, so date order buries the biggest film on the
 * board the moment a quieter Friday follows it. Mirzapur: The Movie was the
 * highest-attention title in Indian cinemas — heat 95 against a field where
 * second place was 85 — and sat nineteenth in this row, behind eighteen films
 * that had merely opened more recently. A reader asking what is on right now
 * was being answered with what opened last, which is a different question and
 * the wrong one for a medium where a hit plays for a month.
 *
 * So the top few by attention are promoted to the front and the rest keep their
 * chronology. Promoted through interleaveByLanguage rather than raw heat,
 * because that is this site's spine: TMDB popularity is not comparable across
 * languages, and a straight sort would let one language own the shortlist on a
 * week when it happens to be loud. Interleaving takes the best of each language
 * in turn, so three slots mean up to three languages.
 */
export function inCinemas(all: Release[], region: string, today: Date = new Date()): JustLanded {
  const row = chronicle(all, region, {
    from: toISODate(new Date(today.getTime() - (CINEMA_DAYS - 1) * 86_400_000)),
    to: toISODate(today),
    newestFirst: true,
    where: showing,
  });

  /*
   * The count is everything playing, not everything with artwork.
   *
   * chronicle() gates on a poster, correctly — a poster row cannot show a card
   * with no poster. But it then reports that filtered number as the total, and
   * the total is what the heading prints and what the link to /in-cinemas
   * promises. The page has no poster gate because it is a text board, so the
   * rail said 89 and the page it linked to said 93. Whichever number is right,
   * two of them is wrong.
   */
  const playing = all.filter(
    (r) =>
      r.regions?.includes(region) &&
      r.releaseDate >= row.from &&
      r.releaseDate <= row.to &&
      showing(r),
  ).length;
  row.total = playing;

  const ranked = interleaveByLanguage(
    all.filter(
      (r) =>
        r.regions?.includes(region) &&
        r.releaseDate >= row.from &&
        r.releaseDate <= row.to &&
        showing(r) &&
        Boolean(r.posterUrl),
    ),
    (a, b) => (b.heat ?? 0) - (a.heat ?? 0),
    // By best rather than by count: the default asks which language has the
    // most films out, which is not the question a shortlist answers. See
    // interleaveByLanguage.
    'best',
  ).slice(0, TRENDING_IN_CINEMAS);

  // Nothing to promote is a real state — a week where the whole row opened on
  // one day, or a region with three cinema listings — and it has to read as the
  // ordinary row rather than as a shortlist of everything there is.
  if (ranked.length < TRENDING_IN_CINEMAS || row.total <= TRENDING_IN_CINEMAS) return row;

  const lead = new Set(ranked.map((r) => r.id));
  return {
    ...row,
    trending: ranked.length,
    // The tail keeps the date order it already had; only the front is re-cut.
    // Re-sliced to MAX_ITEMS because promoting from deep in the window can pull
    // in titles the cap had excluded.
    releases: [...ranked, ...row.releases.filter((r) => !lead.has(r.id))].slice(0, MAX_ITEMS),
  };
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
