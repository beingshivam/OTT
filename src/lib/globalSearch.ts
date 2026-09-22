import type { Release } from '../types';

/**
 * One search box over two corpora, and the seam between them made visible.
 *
 * The site's own search reads what the browser has loaded — the calendar and
 * the back catalogue, 963 titles — and knows no people at all. Everything else
 * comes from /api/search, which proxies TMDB. Neither half is the whole
 * answer:
 *
 *   local   small, but it knows where to watch the thing and has a page for it
 *   remote  a million titles and every actor, and it knows none of that
 *
 * So they are never silently mixed. A reader has to be able to tell which
 * results the site can say something about, because the difference is the
 * entire value of the site: "on Netflix from Friday" versus "this film exists".
 * Merging them into one ranked list would bury the three rows that answer the
 * question under twenty that do not.
 */

export interface RemoteHit {
  kind: 'film' | 'series' | 'person';
  id: string;
  title?: string;
  name?: string;
  year?: string | null;
  image?: string | null;
  lang?: string | null;
  role?: string | null;
  knownFor?: string[];
}

export interface SearchState {
  /** Whether the proxy has a credential at all, as opposed to having one and
   *  coming back empty. Only the empty state reads it, to tell "we searched a
   *  million titles and there is no such film" from "we searched ours". */
  remote: boolean;
  /** True when TMDB was reachable but did not answer. The local half still
   *  rendered, so this is a smaller search rather than a broken one. */
  degraded: boolean;
  hits: RemoteHit[];
  total: number;
}

export const EMPTY: SearchState = { remote: false, degraded: false, hits: [], total: 0 };

/**
 * One placeholder, sized for the narrowest phone.
 *
 * There were two: this, and "Search films, series and people" for the case
 * where the Worker has no TMDB credential and the search really is only nine
 * hundred rows. The owner's call is one line, and phone first — and the
 * fallback was the worse of the two on a phone by every measure. At 360px the
 * field is about 200px wide; three nouns and two commas ran past it and
 * truncated to "Search films, series and…", which promises less than the site
 * does and reads like a field that has not finished loading.
 *
 * It costs the mount-time probe that existed only to choose between them —
 * one request per page load, on Indian mobile data, to pick a string.
 *
 * What it buys is a claim that is true once TMDB is reachable and not before,
 * so binding the token is what makes the header honest. docs/search-setup.md
 * is the step, and /api/watchdog reports whether it landed.
 */
export const PLACEHOLDER = 'Search 1M+ titles';

/**
 * Titles the local half already has, so the same film is not offered twice.
 *
 * The proxy returns ids in the feed's own shape (`m-1234`, `t-77`) precisely
 * so this can be a set lookup rather than a fuzzy title match. A `~ott` row is
 * the same film as its cinema listing, so the suffix is stripped before
 * comparing — otherwise a film with an announced streaming date appears in
 * both halves.
 */
export function withoutLocal(hits: RemoteHit[], local: Release[]): RemoteHit[] {
  const seen = new Set(local.map((r) => String(r.id).replace(/~[a-z]+$/, '')));
  return hits.filter((h) => h.kind === 'person' || !seen.has(h.id));
}

/**
 * The local half: what the reader has already downloaded.
 *
 * Deliberately not fuzzy. This runs on every keystroke over a thousand rows,
 * and a scorer nobody can reason about is impossible to defend the first time
 * it puts the wrong film first. But a plain substring is not enough either:
 * "raji" matched Apa**raji**to ahead of every Rajinikanth film in the feed,
 * because both are substrings and nothing said which one a person typing four
 * letters meant.
 *
 * So: where the match falls, in five bands.
 *
 *   0  the title starts with it          "jail" → Jailer
 *   1  a word of the title starts with it "married" → Why Did I Get Married
 *   2  an actor's name starts with it     "raji" → Rajinikanth's films
 *   3  the title contains it              "raji" → Aparajito
 *   4  an actor's name contains it
 *
 * Bands 3 and 4 still exist, because somebody searching a Tamil title
 * transliterated a different way needs them — they just stop outranking the
 * thing everybody actually meant.
 */
export function localMatches(rows: Release[], query: string, limit = 6): Release[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];

  /* Built once, not per row. `\b` rather than a split on spaces: it also
     catches "The Man" after a colon and "Jr." after a full stop. */
  const wordStart = new RegExp(`\\b${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);

  const bands: Release[][] = [[], [], [], [], []];
  const seen = new Set<string>();

  for (const r of rows) {
    const id = String(r.id).replace(/~[a-z]+$/, '');
    if (seen.has(id)) continue;

    const title = r.title.toLowerCase();
    const cast = (r.cast ?? []).map((n) => n.toLowerCase());

    const band = title.startsWith(q)
      ? 0
      : wordStart.test(title)
        ? 1
        : cast.some((n) => wordStart.test(n))
          ? 2
          : title.includes(q)
            ? 3
            : cast.some((n) => n.includes(q))
              ? 4
              : -1;

    if (band < 0) continue;
    seen.add(id);
    bands[band].push(r);
    /* Enough of the best band to fill the list on its own means nothing below
       it can appear, so stop walking. */
    if (bands[0].length >= limit) break;
  }
  return bands.flat().slice(0, limit);
}

/**
 * Ask the proxy.
 *
 * Every failure resolves rather than throws. The local results are already on
 * screen by the time this returns, and replacing them with an error message
 * would take away the half that worked — the reader cannot do anything about
 * TMDB being down, and the row they wanted may well be in the half they
 * already have.
 */
export async function askRemote(query: string, signal?: AbortSignal): Promise<SearchState> {
  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`, { signal });
    if (!res.ok) return EMPTY;
    const body = await res.json();
    return {
      remote: Boolean(body.remote),
      degraded: Boolean(body.degraded),
      hits: body.results ?? [],
      total: body.total ?? 0,
    };
  } catch {
    return EMPTY;
  }
}
