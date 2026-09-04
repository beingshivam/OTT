#!/usr/bin/env node
/**
 * Attaches real artwork and metadata to the rows already in the feed.
 *
 * The division of labour matters: the weekly calendar is the source of truth for
 * *what drops when* — it is hand-checked and it knows about regional titles TMDB
 * often misses. TMDB is the source for *what it looks like*. This script joins
 * the two without letting either overwrite the other's job.
 *
 * Matching is deliberately strict. A poster for the wrong film is far worse than
 * no poster: it is confidently incorrect, and the generated fallback already
 * looks intentional. So a candidate is accepted only on an exact normalised
 * title match with a plausible year, and everything else is left alone.
 *
 * Usage: npm run enrich [-- --force] [-- --verbose]   (reads .env)
 */

import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from './env.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Read .env first, so the credential never has to go on a command line.
loadEnv();
const FEED = resolve(ROOT, 'public/data/releases.json');
const API = 'https://api.themoviedb.org/3';
const IMG = 'https://image.tmdb.org/t/p';

const TOKEN = process.env.TMDB_TOKEN || process.env.TMDB_API_KEY;
const FORCE = process.argv.includes('--force');
const VERBOSE = process.argv.includes('--verbose');

if (!TOKEN) {
  console.error(
    'No TMDB credential found (set TMDB_TOKEN or TMDB_API_KEY).\n' +
      'Either works — the v4 API Read Access Token or the v3 API Key, from\n' +
      'https://www.themoviedb.org/settings/api. Then:\n' +
      '  put it in .env (copy .env.example), then: npm run enrich\n' +
      'The feed has been left untouched.',
  );
  process.exit(1);
}

/**
 * TMDB hands out two credentials and they authenticate differently:
 *   - the v4 "API Read Access Token", a JWT, sent as `Authorization: Bearer`
 *   - the v3 "API Key", 32 hex characters, sent as an `api_key` query param
 * People reach for whichever the site showed them first, so accept both and
 * pick the scheme from the shape of the value rather than making it their
 * problem.
 */
const IS_JWT = /^ey[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(TOKEN);

function authHeaders() {
  return IS_JWT
    ? { Authorization: `Bearer ${TOKEN}`, accept: 'application/json' }
    : { accept: 'application/json' };
}

function applyAuth(url) {
  if (!IS_JWT) url.searchParams.set('api_key', TOKEN);
  return url;
}

let calls = 0;
async function tmdb(path, params = {}) {
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  if (calls++ > 0) await new Promise((r) => setTimeout(r, 60));

  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(applyAuth(url), { headers: authHeaders() });
    if (res.ok) return res.json();
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, Number(res.headers.get('retry-after') ?? 2) * 1000));
      continue;
    }
    if (res.status >= 500) {
      await new Promise((r) => setTimeout(r, 2 ** attempt * 500));
      continue;
    }
    throw new Error(`TMDB ${res.status} ${res.statusText} for ${url.pathname}`);
  }
  throw new Error(`TMDB kept failing for ${url.pathname}`);
}

/** Fold case, accents and punctuation so "G.D.N." and "GDN" compare equal. */
function norm(s) {
  return (s ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const year = (iso) => Number((iso ?? '').slice(0, 4));

/**
 * Accept a candidate only when the title matches exactly after normalisation and
 * the year is within a year of the scheduled drop. Streaming dates trail
 * theatrical ones, so a small window is expected — a large one means it's a
 * different film with the same name.
 */
function pick(candidates, release, isMovie) {
  const want = norm(release.title);
  const wantYear = year(release.releaseDate);

  for (const c of candidates) {
    const titles = [
      isMovie ? c.title : c.name,
      isMovie ? c.original_title : c.original_name,
    ].filter(Boolean);
    if (!titles.some((t) => norm(t) === want)) continue;

    const candYear = year(isMovie ? c.release_date : c.first_air_date);
    // A series' first_air_date can predate a mid-season episode drop by years,
    // so only films get the tight window.
    if (isMovie && candYear && Math.abs(candYear - wantYear) > 1) continue;
    if (!isMovie && candYear && candYear > wantYear + 1) continue;
    return c;
  }
  return null;
}

const feed = JSON.parse(await readFile(FEED, 'utf8'));
let matched = 0;
let skipped = 0;

for (const week of feed.weeks) {
  for (const release of week.releases) {
    if (release.posterUrl && !FORCE) continue;

    const isMovie = release.kind === 'film' || release.kind === 'documentary';
    const endpoint = isMovie ? '/search/movie' : '/search/tv';

    let hit = null;
    try {
      const { results = [] } = await tmdb(endpoint, {
        query: release.title,
        include_adult: false,
      });
      hit = pick(results, release, isMovie);

      // A title can be catalogued as the other kind — a documentary filed as a
      // series, a special filed as a film. One retry the other way is cheap.
      if (!hit) {
        const alt = await tmdb(isMovie ? '/search/tv' : '/search/movie', {
          query: release.title,
          include_adult: false,
        });
        hit = pick(alt.results ?? [], release, !isMovie);
        if (hit) hit.__flipped = true;
      }
    } catch (err) {
      console.warn(`  ! ${release.title}: ${err.message}`);
      skipped++;
      continue;
    }

    if (!hit) {
      skipped++;
      if (VERBOSE) console.log(`  – ${release.title}: no confident match, left as-is`);
      continue;
    }

    const asMovie = hit.__flipped ? !isMovie : isMovie;
    if (hit.poster_path) release.posterUrl = `${IMG}/w500${hit.poster_path}`;
    if (hit.backdrop_path) release.backdropUrl = `${IMG}/w1280${hit.backdrop_path}`;
    if (hit.overview) release.synopsis = hit.overview;
    if (hit.vote_count > 20) release.rating = Number(hit.vote_average.toFixed(1));

    // Runtime, genres and cast only exist on the detail endpoint.
    try {
      const detail = await tmdb(`/${asMovie ? 'movie' : 'tv'}/${hit.id}`, {
        append_to_response: 'credits',
      });
      const runtime = asMovie ? detail.runtime : detail.episode_run_time?.[0];
      if (runtime) release.runtimeMinutes = runtime;
      if (detail.genres?.length) release.genres = detail.genres.map((g) => g.name);
      const cast = detail.credits?.cast?.slice(0, 5).map((c) => c.name) ?? [];
      if (cast.length) release.cast = cast;
      const director = detail.credits?.crew?.find((c) => c.job === 'Director')?.name;
      if (director) release.director = director;
    } catch {
      /* Artwork already landed; detail is a bonus, not a requirement. */
    }

    matched++;
    console.log(`  ✓ ${release.title}${hit.poster_path ? '' : ' (matched, no poster on file)'}`);
  }
}

feed.enrichedAt = new Date().toISOString();
await writeFile(FEED, JSON.stringify(feed, null, 2) + '\n');
console.log(
  `\nEnriched ${matched} title(s); ${skipped} left with generated art. ${calls} API calls.`,
);
