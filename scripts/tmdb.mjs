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

export async function tmdb(path, params = {}) {
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  if (!IS_JWT) url.searchParams.set('api_key', TOKEN);

  const headers = IS_JWT
    ? { Authorization: `Bearer ${TOKEN}`, accept: 'application/json' }
    : { accept: 'application/json' };

  // TMDB allows ~50 req/s. A scheduled job has no reason to rush.
  if (calls++ > 0) await sleep(60);

  let lastError;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    try {
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
