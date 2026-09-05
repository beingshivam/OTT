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
 *
 * Anything else — including "/" — returns null and the app behaves exactly as
 * it did before this file existed. That is deliberate: the homepage is live and
 * this is not the change that should put it at risk.
 */

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

export type Route = Partial<Pick<Filters, 'platforms' | 'languages' | 'weekId'>> & {
  /** Set when the path was a collection, so the page can name itself after the
   *  group rather than after the first language in it. */
  collection?: string;
};

/** Language slugs, derived from the same table the app renders from, so a
 *  renamed language cannot leave a stale URL behind. */
const LANGUAGE_BY_SLUG = new Map(
  Object.entries(LANGUAGES).map(([code, name]) => [name.toLowerCase(), code]),
);

const PLATFORM_IDS = new Set(PLATFORMS.map((p) => p.id));

/** A Friday, as the build writes it. Anything else is not one of our pages. */
const WEEK_PATH = /^\/w\/(\d{4}-\d{2}-\d{2})$/;

export function routeFilters(pathname: string): Route | null {
  // Trailing slashes are the same page — Cloudflare serves /netflix and
  // /netflix/ from the same file, so both must resolve here too.
  const path = pathname.replace(/\/+$/, '') || '/';
  if (path === '/') return null;

  const week = WEEK_PATH.exec(path);
  if (week) return { weekId: week[1] };

  const slug = path.slice(1).toLowerCase();
  if (PLATFORM_IDS.has(slug)) return { platforms: [slug] };

  // Before single languages: a collection's slug is checked against its own
  // table, and the build refuses to publish two pages at the same path, so a
  // collection named after a language cannot silently shadow one.
  const collection = collectionBySlug(slug);
  if (collection) return { languages: collection.languages, collection: slug };

  const language = LANGUAGE_BY_SLUG.get(slug);
  if (language) return { languages: [language] };

  return null;
}
