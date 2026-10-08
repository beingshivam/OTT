import type { ReleaseFeed, ReleaseWeek } from '../types';

/**
 * The feed is a static JSON file rebuilt by `scripts/fetch-releases.mjs` (via the
 * Friday GitHub Action). Keeping it static means the browser never holds an API
 * key, the page is cacheable at the CDN edge, and the site survives TMDB downtime.
 */
export async function loadFeed(signal?: AbortSignal): Promise<ReleaseFeed> {
  // Single-file builds embed the feed in the page so the whole app is one
  // self-contained HTML file that works from a file:// URL or a paste-in host.
  const embedded = document.getElementById('release-feed')?.textContent;
  if (embedded) return normalise(JSON.parse(embedded) as ReleaseFeed);

  /**
   * Resolved against the deploy's base, not the current page.
   *
   * document.baseURI is the page's own URL, so on /theatres this asked for
   * /theatres/data/releases.json and on /w/<date> for one level deeper still —
   * a 404 on every page but the homepage. BASE_URL is whatever vite.config
   * pinned ('/' here), which is the same answer from every page.
   */
  const url = new URL(`${import.meta.env.BASE_URL}data/releases.json`, location.origin).href;
  /*
   * No `cache: 'no-cache'`, which was costing a 443 KB download far more
   * often than once.
   *
   * App.tsx loads the feed in an effect keyed on `route`, so every move
   * between lenses, weeks and title sheets re-ran it — and `no-cache` forces
   * a revalidation round trip each time, overriding the five-minute
   * Cache-Control the edge already sends. On the throttled mid-range phone
   * most of this audience browses on, that is most of a second of nothing
   * happening on every tap, which is what "lags" describes.
   *
   * Freshness is the header's job. It can also be retuned without shipping a
   * new bundle, which this could not.
   */
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Could not load the release feed (${res.status})`);
  return normalise((await res.json()) as ReleaseFeed);
}

function normalise(feed: ReleaseFeed): ReleaseFeed {
  feed.weeks.sort((a, b) => a.id.localeCompare(b.id));
  return feed;
}

export function weekById(feed: ReleaseFeed | null, id: string): ReleaseWeek | undefined {
  return feed?.weeks.find((w) => w.id === id);
}
