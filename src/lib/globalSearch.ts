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
  /**
   * The spelling that actually found these, when it was not the one typed.
   *
   * The Worker has always sent this and nothing ever read it, so a reader who
   * typed "jawan movie" got Jawan with no explanation. That was survivable
   * while the only relaxations dropped noise words. It is not survivable now
   * that the route also tries other romanisations — "panchnama" answering
   * with Pyaar Ka Punchnama is right, and silently swapping a reader's word
   * for a different one is how a search loses trust the first time it guesses
   * wrong. Shown, so the guess is visible and correctable.
   */
  relaxedTo?: string;
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
      relaxedTo: typeof body.relaxedTo === 'string' ? body.relaxedTo : undefined,
    };
  } catch {
    return EMPTY;
  }
}

/**
 * The places on this site, for the queries that are not titles at all.
 *
 * "Action movies" is a search people type, and until now the box answered it
 * badly rather than not at all: the local half matches titles and cast, so it
 * found nothing, and the remote half handed "action" to TMDB, which returns
 * films literally *called* Action. A confident list of the wrong thing is
 * worse than an empty one, because the reader believes it and leaves.
 *
 * The right answer already existed and was unreachable from the box. This site
 * has ten collection pages, a page per platform, one per language and three
 * lenses — twenty-odd real destinations, each listing exactly what somebody
 * typing a genre is asking for, and the only way to reach them was to scroll
 * to the chips at the bottom of the board.
 *
 * So the box offers them. A destination is a much stronger answer than a title
 * when the query names one, which is why these sort above the titles: somebody
 * typing "horror" wants the horror page, and somebody typing "jailer" will not
 * match a destination at all.
 *
 * Counted, not just named. "Action" is a guess; "Action — 270 titles" is an
 * answer, and it also proves the page is not empty before the reader spends a
 * tap on it.
 */
export interface Destination {
  href: string;
  label: string;
  kind: 'Collection' | 'Platform' | 'Language' | 'Browse';
  count: number;
}

/** Word-start rather than substring: "action" should find Action, and "ion"
 *  should not. The same rule bands 0 and 1 of localMatches use, for the same
 *  reason — a match nobody can see the logic of reads as a bug. */
const startsWord = (haystack: string, q: string) =>
  haystack.toLowerCase() === q || new RegExp(`\\b${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(haystack.toLowerCase());

/**
 * The words people put after a genre, which are not part of any page's name.
 *
 * "Action movies" is the shape this whole feature was asked about, and the
 * first version missed it: it matched "action" and not "action movies",
 * because the haystack is the page's name and the query had a word the page
 * does not. The same failure the TMDB route has, from the same cause — a
 * reader describing what they want rather than naming it.
 *
 * Stripped only on a second pass, never the first, because "series" is a
 * noise word to a genre and half the name of Web series. The raw query wins
 * where it matches, so that collection keeps answering to itself.
 */
const DESCRIBERS = /\b(movies?|films?|shows?|series|to watch|on ott|online)\b/g;

export function destinationMatches(
  rows: Release[],
  query: string,
  opts: {
    collections: { slug: string; chip: string; label: string; match: (r: Release) => boolean }[];
    platforms: { id: string; name: string }[];
    languages: { code: string; name: string }[];
    lenses: { href: string; label: string; match: (r: Release) => boolean }[];
  },
  limit = 3,
): Destination[] {
  const raw = query.trim().toLowerCase();
  if (raw.length < 3) return [];

  const found = (q: string) => {
  const out: Destination[] = [];

  for (const c of opts.collections) {
    if (!startsWord(c.chip, q) && !startsWord(c.label, q)) continue;
    out.push({ href: `/${c.slug}`, label: c.chip, kind: 'Collection', count: rows.filter(c.match).length });
  }
  for (const p of opts.platforms) {
    if (!startsWord(p.name, q)) continue;
    out.push({
      href: `/${p.id}`,
      label: p.name,
      kind: 'Platform',
      count: rows.filter((r) => r.platforms?.includes(p.id)).length,
    });
  }
  for (const l of opts.languages) {
    if (!startsWord(l.name, q)) continue;
    out.push({
      href: `/${l.name.toLowerCase()}`,
      label: l.name,
      kind: 'Language',
      count: rows.filter((r) => r.languages?.includes(l.code)).length,
    });
  }
  for (const l of opts.lenses) {
    if (!startsWord(l.label, q)) continue;
    out.push({ href: l.href, label: l.label, kind: 'Browse', count: rows.filter(l.match).length });
  }

  /* An empty destination is not an answer. A collection page that exists but
     holds nothing this week is a worse tap than no suggestion at all. */
  return out
    .filter((d) => d.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
  };

  const exact = found(raw);
  if (exact.length) return exact;

  const described = raw.replace(DESCRIBERS, ' ').replace(/\s+/g, ' ').trim();
  return described && described !== raw ? found(described) : [];
}
