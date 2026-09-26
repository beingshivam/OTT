/**
 * A genre, at the size it actually is.
 *
 * The /action page shipped 268 titles under a header promising a million, and
 * the owner called it a contradiction. It measures out like this:
 *
 *   genre        ours    streaming in India
 *   Action        268                  5749
 *   Comedy        285                  9088
 *   Thriller      251                  3921
 *   Romance       157                  4015
 *   Crime         222                  3507
 *   Horror         67                  1420
 *
 * A million was never going to be one genre in one country — that is TMDB's
 * whole worldwide catalogue, most of which India cannot stream. But 268 of
 * 5,749 is five percent, and a reader who came looking for action films was
 * being shown one in twenty of the ones they could watch tonight.
 *
 * Fetched a page at a time, from the edge, so the difference costs the reader
 * nothing until they scroll. The dated rows above stay the page's indexed
 * content; this is a grid underneath them, no more crawled than a search
 * result is.
 */
export type BrowseHit = {
  kind: 'film' | 'series';
  id: string;
  title: string;
  year: string | null;
  image: string | null;
  lang: string | null;
};

export type BrowsePage = {
  results: BrowseHit[];
  /** Everything in the genre, not what came back in this page. */
  total: number;
  /** TMDB files horror, romance and thriller series elsewhere — see the route. */
  filmsOnly: boolean;
  degraded: boolean;
};

export async function fetchBrowse(
  genre: string,
  page: number,
  signal?: AbortSignal,
): Promise<BrowsePage | null> {
  try {
    const res = await fetch(`/api/browse?g=${encodeURIComponent(genre)}&page=${page}`, { signal });
    if (!res.ok) return null;
    const body = await res.json();
    if (body.degraded || body.remote === false) {
      return { results: [], total: 0, filmsOnly: false, degraded: true };
    }
    return {
      results: body.results ?? [],
      total: body.total ?? 0,
      filmsOnly: Boolean(body.filmsOnly),
      degraded: false,
    };
  } catch {
    /* An aborted fetch lands here too, and the caller has moved on. */
    return null;
  }
}
