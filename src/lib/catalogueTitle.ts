import { PLATFORMS } from '../data/platforms';

/**
 * A title the calendar does not have, fetched when somebody opens it.
 *
 * Search has always been able to reach past this site's own rows into TMDB's
 * million, and the results were deliberately inert: there was no page to send
 * anybody to, and a row that looks clickable and lands nowhere is worse than
 * one that plainly says "that film exists, we have no date for it".
 *
 * A sheet is not a page. Nothing here is crawled, indexed or linked, so
 * "publishing stays earned" is untouched — but a reader who searched for
 * Shawshank can now be told it is a 1994 film, who directed it, and, when
 * India has it, which service it is on tonight. That last part is the reason
 * this exists. The rest is context around it.
 */
export type CatalogueTitle = {
  remote: true;
  id: string;
  kind: 'film' | 'series';
  title: string;
  year: string | null;
  synopsis: string | null;
  posterUrl: string | null;
  backdropUrl: string | null;
  runtimeMinutes: number | null;
  genres: string[];
  languages: string[];
  certification: string | null;
  rating: number | null;
  cast: string[];
  director: string | null;
  providerIds: number[];
  rentBuyIds: number[];
  seasons: number | null;
  similar: { id: string; title: string; year: string | null; image: string | null }[];
};

export type CatalogueState =
  | { status: 'loading' }
  | { status: 'ready'; title: CatalogueTitle }
  | { status: 'missing' }
  | { status: 'degraded' };

/**
 * TMDB provider ids to this site's platforms.
 *
 * The Worker sends the raw ids rather than doing this itself, because the
 * table lives here and a second copy at the edge would drift the first time a
 * service was renamed — which, with JioHotstar, has already happened once.
 *
 * India only: the route filters by region before this sees it, so anything
 * arriving here is something a reader in India can actually open.
 */
export function platformsFor(providerIds: number[]): string[] {
  const seen = new Set<string>();
  for (const id of providerIds) {
    const match = PLATFORMS.find((p) => p.regions.includes('IN') && p.tmdb.includes(id));
    if (match) seen.add(match.id);
  }
  return [...seen];
}

/** Whether this is a title only search can reach, rather than a calendar row. */
export const isCatalogueId = (id: string): boolean => /^[mt]-\d+$/.test(id);

export async function fetchCatalogueTitle(
  id: string,
  signal?: AbortSignal,
): Promise<CatalogueState> {
  try {
    const res = await fetch(`/api/title?id=${encodeURIComponent(id)}`, { signal });
    if (res.status === 404) return { status: 'missing' };
    if (!res.ok) return { status: 'degraded' };
    const body = (await res.json()) as CatalogueTitle & { degraded?: boolean };
    if (body.degraded || !body.title) return { status: 'degraded' };
    return { status: 'ready', title: body };
  } catch {
    /* An aborted fetch lands here too — the caller drops the result when it
       has moved on, so this never reaches a reader as an error. */
    return { status: 'degraded' };
  }
}

/**
 * A person, and everything they have been in.
 *
 * Search has always returned people, and tapping one used to write the name
 * into the search box. That only ever worked because the box also filtered the
 * board — their films appeared underneath because the board matched on cast.
 * Once the box stopped touching the board it became a tap that re-runs the
 * same search and shows you the person again.
 *
 * So a person is a destination now, the same way a title is: a sheet, not a
 * page. The reasoning about pages is unchanged — a hundred thousand actor
 * pages carrying a filmography and nothing else is the shape that gets
 * demoted — but there is plenty worth showing, and a filmography is the one
 * place a reader who half-remembers a face rather than a title can start.
 */
export type PersonCredit = {
  id: string;
  title: string;
  year: string | null;
  image: string | null;
  as: string | null;
};

export type CataloguePerson = {
  remote: true;
  id: string;
  name: string;
  role: string | null;
  image: string | null;
  credits: PersonCredit[];
};

export type PersonState =
  | { status: 'loading' }
  | { status: 'ready'; person: CataloguePerson }
  | { status: 'missing' }
  | { status: 'degraded' };

export async function fetchPerson(id: string, signal?: AbortSignal): Promise<PersonState> {
  try {
    const res = await fetch(`/api/person?id=${encodeURIComponent(id)}`, { signal });
    if (res.status === 404) return { status: 'missing' };
    if (!res.ok) return { status: 'degraded' };
    const body = (await res.json()) as CataloguePerson & { degraded?: boolean };
    if (body.degraded || !body.name) return { status: 'degraded' };
    return { status: 'ready', person: body };
  } catch {
    return { status: 'degraded' };
  }
}
