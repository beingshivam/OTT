import { loadEnv } from './env.mjs';

loadEnv();

/**
 * One TMDB client for all three scripts.
 *
 * They each grew their own copy, which drifted: two had retry loops that
 * handled HTTP status codes, and fetch-logos had none at all — so a single
 * dropped connection killed a run that had already done 291 successful calls.
 * Sharing it means a reliability fix lands everywhere at once.
 */

const API = 'https://api.themoviedb.org/3';

export const TOKEN = process.env.TMDB_TOKEN || process.env.TMDB_API_KEY;

/**
 * TMDB hands out two credentials that authenticate differently: the v4 "API
 * Read Access Token" is a JWT sent as a Bearer header, the v3 "API Key" is 32
 * hex characters sent as a query param. People reach for whichever the site
 * showed them first, so accept both and pick the scheme from the value's shape.
 */
const IS_JWT = /^ey[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(TOKEN ?? '');

export function requireToken() {
  if (TOKEN) return;
  console.error(
    'No TMDB credential found (set TMDB_TOKEN or TMDB_API_KEY).\n' +
      'Either works — the v4 API Read Access Token or the v3 API Key, from\n' +
      'https://www.themoviedb.org/settings/api.\n' +
      'Put it in .env (copy .env.example), then re-run.\n' +
      'Nothing has been written.',
  );
  process.exit(1);
}

let calls = 0;
export const callCount = () => calls;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * One rate limit for the whole process, so calls can overlap.
 *
 * This was `if (calls++ > 0) await sleep(60)` — a pause before every call,
 * which is a rate limit only because nothing ever called twice at once. It
 * made the client strictly serial at about sixteen requests a second against
 * an allowance of fifty, and that turned out to be the binding constraint on
 * how much of India's catalogue the site could carry: the fetch spends one
 * call per title to learn which platform has it, and at a quarter of the
 * permitted rate a ten-minute budget buys about thirteen hundred titles.
 * Tamil has nearly two thousand titles on Indian streaming on its own.
 *
 * A shared slot allocator instead. Each call reserves the next free instant
 * and waits until it, so ten callers at once are spaced rather than
 * simultaneous and the rate holds no matter how many are in flight. The
 * reservation is written before any await, which is what makes it safe here:
 * nothing can interleave between reading nextSlot and moving it.
 *
 * 25ms is forty a second, under the allowance with room for the retries that
 * also take a slot.
 */
const RATE_MS = Number(process.env.TMDB_RATE_MS ?? 25);
let nextSlot = 0;

async function slot() {
  const now = Date.now();
  const at = Math.max(now, nextSlot);
  nextSlot = at + RATE_MS;
  if (at > now) await sleep(at - now);
}

/**
 * Map over items with a bounded number in flight, in order.
 *
 * The rate limiter above sets the pace; this sets how many round trips are
 * open at once, which is the other half of the problem. TMDB's latency from a
 * CI runner is around 250ms, so a serial loop idles for almost all of its
 * budget waiting on a socket.
 *
 * `stop` is checked before each item rather than each batch, so a run that
 * exhausts its time budget stops promptly and keeps everything already
 * fetched — a partial catalogue is the documented outcome of running out of
 * time, and it must stay a clean one.
 */
export async function mapPool(items, limit, fn, stop = () => false) {
  const list = [...items];
  const out = new Array(list.length);
  let next = 0;
  let stopped = false;

  const worker = async () => {
    for (;;) {
      if (stop()) {
        stopped = true;
        return;
      }
      const i = next++;
      if (i >= list.length) return;
      out[i] = await fn(list[i], i);
    }
  };

  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, worker));
  /* Holes are items never started, not items that produced nothing — the
     caller has to be able to tell those apart. */
  return { results: out, stopped, done: Math.min(next, list.length) };
}

export async function tmdb(path, params = {}) {
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  if (!IS_JWT) url.searchParams.set('api_key', TOKEN);

  const headers = IS_JWT
    ? { Authorization: `Bearer ${TOKEN}`, accept: 'application/json' }
    : { accept: 'application/json' };

  let lastError;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    try {
      /* Inside the loop, so a retry queues behind everything else in flight
         rather than jumping the rate limit. */
      calls++;
      await slot();
      const res = await fetch(url, { headers });

      if (res.ok) return res.json();

      if (res.status === 429) {
        await sleep(Number(res.headers.get('retry-after') ?? 2) * 1000);
        continue;
      }
      if (res.status >= 500) {
        await sleep(2 ** attempt * 500);
        continue;
      }
      // 4xx other than rate limiting is a real problem: a bad key, a bad path.
      // Retrying cannot help and would only bury the cause.
      throw new Error(`TMDB ${res.status} ${res.statusText} for ${url.pathname}`);
    } catch (err) {
      // A dropped connection — ECONNRESET, ETIMEDOUT, DNS blips — surfaces as a
      // thrown TypeError from fetch rather than a status code, and is exactly
      // the kind of thing worth retrying over a run of several hundred calls.
      if (err instanceof Error && err.message.startsWith('TMDB ')) throw err;
      lastError = err;
      // Backoff up to ~20s in total: some networks reset TLS to TMDB in bursts,
      // and giving up in nine seconds turns a blip into a failed run.
      await sleep(Math.min(2 ** attempt * 800, 8000));
    }
  }

  throw new Error(
    `TMDB request failed after ${ATTEMPTS} attempts for ${url.pathname}: ${describe(lastError)}`,
  );
}

const ATTEMPTS = 6;

/** fetch throws a bare "fetch failed"; the actionable detail is in the cause. */
function describe(err) {
  if (!err) return 'unknown error';
  const cause = err.cause;
  const code = cause?.code ?? cause?.errno;
  const detail = cause?.message ?? err.message;
  return code ? `${detail} (${code})` : detail;
}
