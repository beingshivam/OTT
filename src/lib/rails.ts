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

/**
 * True when a film is something you can still only see in a cinema.
 *
 * This used to be "has a theatrical listing", on the reasoning that a film can
 * be both and belongs in both rows when it is. Day-and-date releases exist, so
 * the reasoning is not wrong — it is just not how Indian releases usually work.
 * The normal shape is a theatrical run that *ends*, and then a streaming date,
 * and the window here is six weeks, which is long enough to span both.
 *
 * The result was absurd and was reported as such: Vishwanath & Sons led the
 * "In cinemas" row wearing a Netflix badge, with DC on Sun NXT and G.D.N on
 * Netflix beside it. Somebody reading that row is deciding whether to book a
 * ticket. A film they can stream at home tonight is not an answer to that
 * question, whatever its opening date says.
 *
 * So a streaming platform retires the cinema listing from this row. The row
 * itself keeps both — it opened in cinemas, and that is true and belongs on its
 * week and on its page — but "on at the cinema right now" is a claim only one
 * of them can support.
 */
const showing = (r: Release) =>
  r.platforms.includes('theatres') && !r.platforms.some((p) => p !== 'theatres');

/**
 * True when we can tell someone where to watch it.
 *
 * Every platform in the feed is now a real service, so this is simply "not a
 * cinema listing". It used to have to exclude a placeholder as well — see the
 * digital pass in scripts/fetch-releases.mjs for why that no longer exists.
 */
const streaming = (r: Release) => r.platforms.some((p) => p !== 'theatres');

/**
 * Whose audience the attention number describes.
 *
 * TMDB popularity means a different thing on either side of this line. For an
 * Indian production the people looking a title up are broadly the people who
 * could buy a ticket here; for an import they are the world, and Mutiny's 343
 * against Hanuman Ansh's 34 is a fact about Jason Statham's global following
 * rather than about what is filling seats in India.
 *
 * So an import is never crowned. It keeps its place in the row — it is playing,
 * and someone may want it — but the badge is a claim about Indian cinemas and
 * that claim is the one thing this number cannot support.
 *
 * Only ever demotes on positive evidence. Eighteen of the ninety-three films in
 * the window have no production country recorded at all, including obviously
 * Indian ones, so an unknown origin is treated as local. And India among several
 * counts as India: Mirzapur: The Movie is IN/US and is not an import.
 */
const imported = (r: Release) => Boolean(r.origin?.length) && !r.origin!.includes('IN');

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

  /*
   * The badged few are the ones the claim can be made about.
   *
   * Straight heat put Mutiny second — a British-American action picture ahead
   * of everything in Indian cinemas except Mirzapur, on a popularity score
   * earned worldwide. Reported as not making sense, and it does not.
   *
   * Promoting the eligible three to the front rather than badging them where
   * they sit: badges landing on cards one, three and four read as a bug, and
   * the row's first three cards are the ones anyone actually sees.
   */
  const lead = releases.filter((r) => !imported(r)).slice(0, TRENDING_IN_CINEMAS);
  if (lead.length < TRENDING_IN_CINEMAS) return { ...row, trending: 0 };

  const crowned = new Set(lead.map((r) => r.id));
  return {
    ...row,
    trending: TRENDING_IN_CINEMAS,
    releases: [...lead, ...releases.filter((r) => !crowned.has(r.id))],
  };
}

/**
 * How far back this row reaches when the reader has narrowed the page.
 *
 * "When I select this filter the top rails are gone." Mostly that was a fake
 * platform belonging to neither row, and that is fixed at the source. What was
 * left is smaller and real: Shudder has one title in the feed and it landed in
 * July, so a fortnight-wide row filtered to Shudder is empty, the band collapses
 * and tapping a chip still makes two thirds of the page disappear.
 *
 * Widening is honest here and would not be on the cinema row. "On right now" is
 * a claim about the present, and a film that reached Shudder in July is on
 * Shudder right now — that is what a subscription is. A film that opened in
 * cinemas in July is not still playing, which is why that row keeps its six
 * weeks and this one does not have to.
 *
 * Only when the reader asked. Unfiltered, a fortnight is the news and a row
 * reaching back a year would bury it.
 */
export const NARROWED_DAYS = 365;

/**
 * The same fortnight the mixed row always used, narrowed to things you can
 * actually stream tonight.
 *
 * This one keeps its calendar, and the asymmetry with the cinema row above is
 * deliberate rather than an oversight. A cinema run lasts six weeks, so date
 * order there is close to noise — the biggest film on the board sat nineteenth.
 * A streaming drop's news value is measured in days inside a fourteen-day
 * window, so "what landed" is a real ordering here and throwing it away would
 * cost more than it bought.
 *
 * What it gains is the front of the row. Asked for, and right: strictly
 * newest-first, a Friday fills the visible cards with whatever dropped that
 * morning and buries the week's biggest arrival behind it. So the same few
 * lead on attention and wear the same badge, and everything behind them is the
 * chronology it always was.
 */
export function landedOnOtt(
  all: Release[],
  region: string,
  today: Date = new Date(),
  days: number = WINDOW_DAYS,
): JustLanded {
  const row = chronicle(all, region, {
    from: toISODate(new Date(today.getTime() - (days - 1) * 86_400_000)),
    to: toISODate(today),
    newestFirst: true,
    where: streaming,
  });

  /* The badge says "Trending", which is a claim about now. Across a widened
     window it would be crowning whatever happened to be the year's biggest,
     so the widened row is a plain chronology. */
  if (days !== WINDOW_DAYS) return row;
  if (row.releases.length <= TRENDING_IN_CINEMAS || row.total <= TRENDING_IN_CINEMAS) return row;

  /*
   * Ranked across the whole window rather than within a day, because that is
   * what the badge claims. Imports are ineligible here for the same reason as
   * in cinemas — a global popularity score is not evidence of Indian demand —
   * and the row simply says nothing rather than crowning one when there are not
   * enough local titles to fill the shortlist.
   */
  const lead = [...row.releases]
    .filter((r) => !imported(r))
    .sort((a, b) => (b.heat ?? 0) - (a.heat ?? 0) || b.releaseDate.localeCompare(a.releaseDate))
    .slice(0, TRENDING_IN_CINEMAS);
  if (lead.length < TRENDING_IN_CINEMAS) return row;

  const crowned = new Set(lead.map((r) => r.id));
  return {
    ...row,
    trending: lead.length,
    releases: [...lead, ...row.releases.filter((r) => !crowned.has(r.id))].slice(0, MAX_ITEMS),
  };
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
