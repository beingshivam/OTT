import type { ReleaseFeed, ReleaseWeek } from '../types';

/**
 * The feed is a static JSON file rebuilt by `scripts/fetch-releases.mjs` (via the
 * Friday GitHub Action). Keeping it static means the browser never holds an API
 * key, the page is cacheable at the CDN edge, and the site survives TMDB downtime.
 */
export async function loadFeed(signal?: AbortSignal): Promise<ReleaseFeed> {
  const url = `${import.meta.env.BASE_URL}data/releases.json`;
  const res = await fetch(url, { signal, cache: 'no-cache' });
  if (!res.ok) throw new Error(`Could not load the release feed (${res.status})`);
  const feed = (await res.json()) as ReleaseFeed;
  feed.weeks.sort((a, b) => a.id.localeCompare(b.id));
  return feed;
}

export function weekById(feed: ReleaseFeed | null, id: string): ReleaseWeek | undefined {
  return feed?.weeks.find((w) => w.id === id);
}
