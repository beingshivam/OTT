import { PLATFORMS, LANGUAGES } from '../data/platforms';
import { collectionBySlug } from '../data/collections';
import type { Filters } from '../types';

/**
 * The URL path, as a filter.
 *
 * The site was one URL for its whole life, and everything lived in the query
 * string. That is fine for sharing a view and useless for search: one URL is
 * one page in Google's index no matter how much content passes through it, so
 * the board could only ever rank for one cluster of queries while the feed
 * carried enough material for dozens.
 *
 * So the paths that matter are now real pages, each prerendered at build time
 * with its own title, description and canonical (scripts/build-seo.mjs). This
 * is the other half: when one of those pages loads, the app has to open showing
 * what the page promised, or a reader arriving from a search result gets the
 * whole week instead of the Netflix page they clicked.
 *
 *   /netflix          a platform, by its registry id
 *   /tamil            a language, by its English name lowercased
 *   /south            a collection of languages (see data/collections.ts)
 *   /w/2026-09-04     one week, by the ISO date of its Friday
 *   /releases/september-2026
 *                     one calendar month
 *   /upcoming         everything not out yet
 *   /ott-release-date/<slug>
 *                     one theatrical film, answering when it reaches streaming
 *
 * Anything else — including "/" — returns null and the app behaves exactly as
 * it did before this file existed. That is deliberate: the homepage is live and
 * this is not the change that should put it at risk.
 */

/**
 * The share of the whole feed above which a page stops being a distinct page.
 *
 * /movies would have been 143 of 183 rows and /drama 85 — documents so close
 * to the homepage that they compete with it rather than add to it, and two
 * near-identical pages is how you lose the better one. Expressed as a rule
 * rather than a blocklist so a genre that swells one month is caught without
 * anyone noticing it happened.
 */
export const MAX_PAGE_SHARE = 0.6;

/**
 * How many titles a page needs before it is worth publishing.
 *
 * A per-platform page listing one film is thin programmatic content — the exact
 * shape Google's helpful-content system demotes, and enough of them can drag
 * the pages that are good down with them. Seven of the first thirty-five pages
 * generated had a single row.
 *
 * The threshold is self-correcting rather than a hand-kept blocklist: a
 * platform or language crosses it on its own as the feed fills, and drops back
 * out if it dries up. The build reads this exact constant (scripts/build-seo.mjs
 * parses it) so the links the app renders and the pages that exist can never
 * disagree — a link to a page the build skipped would land on the SPA fallback
 * and show the whole week under a URL promising one platform.
 */
export const MIN_PAGE_ROWS = 5;

/**
 * A stretch of dates, for the pages that are not about one week.
 *
 * Every other route narrows the board *within* a week: /netflix is the week
 * filtered to one platform. A month is the opposite — it spans weeks, and the
 * week stepper that sits above the board is meaningless on it. So a span
 * carries its own dates and the app reads rows straight from the feed across
 * every week, ignoring `weekId` entirely.
 *
 * Kept out of `Filters` on purpose. Filters are what a reader toggles and what
 * gets written into the query string; a span is a property of the page itself,
 * chosen by the path and not adjustable from the UI. Threading it through the
 * filter machinery would have put a date range in the URL of every page that
 * does not have one.
 */
export interface Span {
  /** Inclusive ISO bounds. */
  from: string;
  to: string;
  /** What the page calls itself: "September 2026", "Coming soon". */
  label: string;
  kind: 'month' | 'upcoming';
}

/** Full English month names, lowercased — the slug is the word people would
 *  type. The build reads this array out of this file (scripts/build-seo.mjs)
 *  rather than keeping its own, so a page and the route that resolves it are
 *  spelled the same by construction. */
export const MONTH_SLUGS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

/** Title case for the heading, from the same array as the slug. */
const monthLabel = (i: number, year: number) =>
  `${MONTH_SLUGS[i][0].toUpperCase()}${MONTH_SLUGS[i].slice(1)} ${year}`;

const pad = (n: number) => String(n).padStart(2, '0');

/** Builds the span for a month, given its index and year. Exported so the
 *  build can derive identical bounds without reimplementing month lengths. */
export function monthSpan(monthIndex: number, year: number): Span {
  // Day 0 of the next month is the last day of this one, which is also how
  // February and leap years come out right without a table.
  const last = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  return {
    from: `${year}-${pad(monthIndex + 1)}-01`,
    to: `${year}-${pad(monthIndex + 1)}-${pad(last)}`,
    label: monthLabel(monthIndex, year),
    kind: 'month',
  };
}

/** Everything still to come, as of the moment it is asked.
 *
 *  Computed rather than baked in, so the page is right on a Tuesday three
 *  weeks after the build that prerendered it — a title that has since opened
 *  drops out on the client instead of sitting under a heading calling it
 *  upcoming. */
export function upcomingSpan(today = new Date()): Span {
  const from = new Date(today.getTime() + 86_400_000).toISOString().slice(0, 10);
  return { from, to: '9999-12-31', label: 'Coming soon', kind: 'upcoming' };
}

export type Route = Partial<Pick<Filters, 'platforms' | 'languages' | 'kinds' | 'genres' | 'weekId'>> & {
  /** Set when the path was a collection, so the page can name itself after the
   *  group rather than after the first language in it. */
  collection?: string;
  /** Set when the path names one title. Unlike every other route this is not a
   *  filter over the board — the app renders a different page entirely. */
  titleSlug?: string;
  /** Set when the path names a stretch of dates rather than a week. The board
   *  reads across weeks and the week stepper steps aside. */
  span?: Span;
};

/** Language slugs, derived from the same table the app renders from, so a
 *  renamed language cannot leave a stale URL behind. */
const LANGUAGE_BY_SLUG = new Map(
  Object.entries(LANGUAGES).map(([code, name]) => [name.toLowerCase(), code]),
);

const PLATFORM_IDS = new Set(PLATFORMS.map((p) => p.id));

/** A Friday, as the build writes it. Anything else is not one of our pages. */
const WEEK_PATH = /^\/w\/(\d{4}-\d{2}-\d{2})$/;

/** One title's page. The slug is stamped onto the feed by the build
 *  (scripts/slug.mjs), never derived here, so the two cannot disagree. */
const TITLE_PATH = /^\/ott-release-date\/([a-z0-9-]+)$/;

/** One calendar month, as "/releases/september-2026". */
const MONTH_PATH = /^\/releases\/([a-z]+)-(\d{4})$/;

export function routeFilters(pathname: string): Route | null {
  // Trailing slashes are the same page — Cloudflare serves /netflix and
  // /netflix/ from the same file, so both must resolve here too.
  const path = pathname.replace(/\/+$/, '') || '/';
  if (path === '/') return null;

  const week = WEEK_PATH.exec(path);
  if (week) return { weekId: week[1] };

  const title = TITLE_PATH.exec(path);
  if (title) return { titleSlug: title[1] };

  if (path === '/upcoming') return { span: upcomingSpan() };

  const month = MONTH_PATH.exec(path);
  if (month) {
    const index = MONTH_SLUGS.indexOf(month[1]);
    const year = Number(month[2]);
    // An unrecognised month name or an implausible year falls through to null
    // rather than resolving to a page the build never wrote.
    if (index >= 0 && year >= 2000 && year <= 2100) return { span: monthSpan(index, year) };
    return null;
  }

  const slug = path.slice(1).toLowerCase();
  if (PLATFORM_IDS.has(slug)) return { platforms: [slug] };

  // Before single languages: a collection's slug is checked against its own
  // table, and the build refuses to publish two pages at the same path, so a
  // collection named after a language cannot silently shadow one.
  const collection = collectionBySlug(slug);
  if (collection) {
    return {
      ...(collection.languages ? { languages: collection.languages } : {}),
      ...(collection.kinds ? { kinds: collection.kinds as Route['kinds'] } : {}),
      ...(collection.genres ? { genres: collection.genres } : {}),
      collection: slug,
    };
  }

  const language = LANGUAGE_BY_SLUG.get(slug);
  if (language) return { languages: [language] };

  return null;
}
