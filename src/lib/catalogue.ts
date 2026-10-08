import type { Release } from '../types';

/**
 * The back catalogue: good things streaming in India now, whatever their age.
 *
 * Fetched only when someone opens that lens, because most visits never leave
 * "this week" and loading it up front would slow the page everyone sees to
 * serve the page some people ask for.
 *
 * This comment used to say "it is a quarter of a megabyte". It was, when it
 * was written. By the time a reader reported that "the now streaming page
 * lags and is slow" the catalogue held 1,810 titles and the file was 1,475 KB
 * — six times the figure the comment still claimed, and the figure the
 * decision to fetch it in one piece rested on. A measurement in a comment
 * goes stale silently; this one cost the slowest page on the site.
 *
 * So the browser is served data/browse.json, which is the same rows without
 * the synopsis, backdrop and ranking bookkeeping it never renders from here —
 * see the generator in build-seo.mjs for what comes out and why each is safe.
 * The full catalogue.json stays where it is for the build and the grader.
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
    const url = new URL(`${import.meta.env.BASE_URL}data/browse.json`, location.origin).href;
    /*
     * No `cache: 'no-cache'`. It was forcing a revalidation round trip on
     * every single visit, which overrode the Cache-Control the edge sends and
     * meant a reader who opened this lens twice in a minute paid for it
     * twice. Freshness is the header's job — see public/_headers, which gives
     * this file an hour — and the header can be changed without shipping a
     * new bundle.
     */
    cached = fetch(url)
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
