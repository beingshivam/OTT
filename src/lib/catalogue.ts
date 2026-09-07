import type { Release } from '../types';

/**
 * The back catalogue: good things streaming in India now, whatever their age.
 *
 * Fetched only when someone opens that lens. It is a quarter of a megabyte and
 * most visits never leave "this week", so loading it up front would slow the
 * page everyone sees to serve the page some people ask for.
 *
 * Its rows are ordinary `Release` objects — same ids, platforms, languages and
 * genres — so the board, the poster grid, the filters and the search all work
 * on it untouched. What it does not carry is a week: these titles are not
 * releases in the calendar sense, and nothing here should give them one.
 */

export interface Catalogue {
  generatedAt: string;
  region: string;
  titles: Release[];
}

let cached: Promise<Catalogue> | null = null;

/**
 * Memoised on the promise rather than the result, so two lens switches in quick
 * succession share one request instead of racing two.
 */
export function loadCatalogue(): Promise<Catalogue> {
  if (!cached) {
    const url = new URL(`${import.meta.env.BASE_URL}data/catalogue.json`, location.origin).href;
    cached = fetch(url, { cache: 'no-cache' })
      .then((res) => {
        if (!res.ok) throw new Error(`Could not load the catalogue (${res.status})`);
        return res.json() as Promise<Catalogue>;
      })
      .catch((e) => {
        // Cleared so a failed load can be retried by switching lens again,
        // rather than poisoning every later attempt with the same rejection.
        cached = null;
        throw e;
      });
  }
  return cached;
}
