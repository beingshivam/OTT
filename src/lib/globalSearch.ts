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
  /** Whether the proxy has a credential. The placeholder claim depends on it —
   *  see the probe below. */
  remote: boolean;
  /** True when TMDB was reachable but did not answer. The local half still
   *  rendered, so this is a smaller search rather than a broken one. */
  degraded: boolean;
  hits: RemoteHit[];
  total: number;
}

export const EMPTY: SearchState = { remote: false, degraded: false, hits: [], total: 0 };

/**
 * What the box is allowed to promise.
 *
 * "Search 1M+ titles" is true only once the proxy can actually reach TMDB.
 * With no token bound it would be a claim over nine hundred rows, which is the
 * one kind of copy this site has consistently refused to write — and the
 * fastest to be caught at, since a reader types one obscure film and sees an
 * empty list.
 */
export const placeholderFor = (remote: boolean) =>
  remote ? 'Search 1M+ titles' : 'Search films, series and people';

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
 * What the last visit learned, so the placeholder does not flip on arrival.
 *
 * Whether the box may claim a million titles is a fact about the Worker, and
 * the only way to learn it is to ask — which lands a frame or two after first
 * paint. Printing the cautious copy and swapping it under the reader's eyes on
 * every single load is a worse lie than either sentence on its own.
 *
 * So the answer is remembered and used as the opening assumption. A first-ever
 * visit gets the cautious placeholder for one frame, which is exactly right: on
 * that visit the site genuinely does not know yet.
 */
const REMOTE_KEY = 'newonott.search.remote';

export function recallRemote(): boolean {
  try {
    return localStorage.getItem(REMOTE_KEY) === '1';
  } catch {
    return false;
  }
}

export function rememberRemote(remote: boolean): void {
  try {
    localStorage.setItem(REMOTE_KEY, remote ? '1' : '0');
  } catch {
    /* Private mode. The probe still runs; only the head start is lost. */
  }
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
