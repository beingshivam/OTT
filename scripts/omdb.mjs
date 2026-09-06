/**
 * The OMDb client, kept apart from the script that uses it so it can be tested.
 *
 * OMDb is not reachable from every environment this repo gets worked on in, so
 * the first live call often happens in CI. That makes the parts that do not
 * need a network — how a response is read, and which failures are worth
 * retrying versus stopping on — the parts worth covering with tests.
 *
 * Its error reporting is the whole reason this is more than a fetch call:
 * OMDb answers HTTP 200 for "no such film" and HTTP 401 for both a rejected
 * key and a spent daily quota, putting the actual reason only in the JSON body.
 * So the status code cannot distinguish a normal miss from a permanent stop,
 * and the body has to.
 */

/**
 * Thrown for the conditions where every remaining call will fail the same way:
 * a rejected key and an exhausted quota. Carrying on would spend several
 * hundred requests learning the same thing several hundred times.
 */
export class Fatal extends Error {}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * "731,205" → 731205. "N/A", "", undefined → undefined, never 0.
 *
 * Zero is a real vote count and a wrong one: a title with an unknown score
 * would sort as though nobody liked it, rather than being left out of a
 * ranking it has no business being in.
 */
export const toNumber = (raw) => {
  const s = String(raw ?? '').replace(/,/g, '').trim();
  if (!s) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
};

/**
 * One title by IMDb id. Returns the body, or null when OMDb has nothing.
 *
 * `fetchImpl` and `wait` are injected so the tests can drive it without a
 * network or a three-second backoff.
 */
export async function fetchTitle(imdbId, key, { fetchImpl = fetch, wait = sleep, attempts = 3 } = {}) {
  const url = new URL('https://www.omdbapi.com/');
  url.searchParams.set('i', imdbId);
  url.searchParams.set('apikey', key);

  for (let attempt = 0; attempt < attempts; attempt++) {
    let res;
    try {
      res = await fetchImpl(url, { signal: AbortSignal.timeout(15_000) });
    } catch {
      // A dropped connection is worth retrying; OMDb is not always quick.
      await wait(500 * 2 ** attempt);
      continue;
    }

    const body = await res.json().catch(() => null);
    if (!body) {
      await wait(500 * 2 ** attempt);
      continue;
    }

    if (body.Response === 'False') {
      const why = String(body.Error ?? '');
      if (/limit reached/i.test(why)) throw new Fatal('OMDb daily request limit reached.');
      if (/invalid api key|no api key/i.test(why)) throw new Fatal(`OMDb rejected the key: ${why}`);
      return null; // Genuinely not found — true of many regional titles at first.
    }
    return body;
  }
  return null;
}

/**
 * The two fields worth keeping, or null.
 *
 * Both or neither, deliberately. A rating with no vote count cannot be
 * filtered on, and the entire point of fetching these is to rank by something
 * that survives scrutiny — "8.9, from six people" is not a recommendation.
 */
export function scoreFrom(body) {
  const rating = toNumber(body?.imdbRating);
  const votes = toNumber(body?.imdbVotes);
  if (rating === undefined || votes === undefined) return null;
  return { rating, votes };
}
