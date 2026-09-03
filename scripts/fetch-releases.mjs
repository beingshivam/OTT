#!/usr/bin/env node
/**
 * Rebuilds public/data/releases.json from TMDB.
 *
 * Why a build-time pull instead of calling TMDB from the browser:
 *   - the API key never ships to a client,
 *   - the site is a static file that a CDN can cache and serve instantly,
 *   - and if TMDB is down on a Friday morning, last week's file still serves.
 *
 * Usage:  TMDB_TOKEN=... node scripts/fetch-releases.mjs [--weeks-back 2] [--weeks-ahead 2]
 *
 * The token is a TMDB v4 "API Read Access Token" from
 * https://www.themoviedb.org/settings/api
 */

import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'public/data/releases.json');
const API = 'https://api.themoviedb.org/3';
const IMG = 'https://image.tmdb.org/t/p';

const TOKEN = process.env.TMDB_TOKEN || process.env.TMDB_API_KEY;
const REGIONS = (process.env.REGIONS ?? 'IN,US').split(',').map((r) => r.trim()).filter(Boolean);

const args = process.argv.slice(2);
const argNum = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : fallback;
};
const WEEKS_BACK = argNum('weeks-back', 2);
const WEEKS_AHEAD = argNum('weeks-ahead', 2);

if (!TOKEN) {
  console.error(
    'No TMDB credential found (set TMDB_TOKEN or TMDB_API_KEY).\n' +
      'Either works — the v4 API Read Access Token or the v3 API Key, from\n' +
      'https://www.themoviedb.org/settings/api. Then:\n' +
      '  TMDB_TOKEN=... npm run refresh\n' +
      'The existing feed has been left untouched.',
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

// ---------------------------------------------------------------- registry --

/**
 * Mirror of src/data/platforms.ts, parsed at run time so the two can never drift.
 * Keeping one source of truth beats keeping two in sync by hand.
 */
async function loadPlatforms() {
  const src = await readFile(resolve(ROOT, 'src/data/platforms.ts'), 'utf8');
  const rows = [...src.matchAll(/\{\s*id:\s*'([^']+)'[\s\S]*?tmdb:\s*\[([^\]]*)\][\s\S]*?regions:\s*\[([^\]]*)\]/g)];
  return rows.map(([, id, tmdb, regions]) => ({
    id,
    tmdb: tmdb.split(',').map((n) => Number(n.trim())).filter(Number.isFinite),
    regions: [...regions.matchAll(/'([^']+)'/g)].map((m) => m[1]),
  }));
}

// -------------------------------------------------------------------- http --

let calls = 0;
async function tmdb(path, params = {}) {
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  // TMDB allows ~50 req/s. Stay well under it; a nightly job has no reason to rush.
  if (calls++ > 0) await new Promise((r) => setTimeout(r, 60));

  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(applyAuth(url), { headers: authHeaders() });
    if (res.ok) return res.json();
    if (res.status === 429) {
      const wait = Number(res.headers.get('retry-after') ?? 2) * 1000;
      await new Promise((r) => setTimeout(r, wait));
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

// -------------------------------------------------------------------- week --

const DAY = 86_400_000;
const iso = (d) => d.toISOString().slice(0, 10);

function weekStart(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  return new Date(d.getTime() - ((d.getUTCDay() + 2) % 7) * DAY);
}

function weekIds() {
  const base = weekStart(new Date());
  const out = [];
  for (let i = -WEEKS_BACK; i <= WEEKS_AHEAD; i++) out.push(iso(new Date(base.getTime() + i * 7 * DAY)));
  return out;
}

// ------------------------------------------------------------------ mapping --

const GENRE_CACHE = new Map();
async function genreNames(kind, ids) {
  if (!GENRE_CACHE.has(kind)) {
    const { genres } = await tmdb(`/genre/${kind === 'movie' ? 'movie' : 'tv'}/list`);
    GENRE_CACHE.set(kind, new Map(genres.map((g) => [g.id, g.name])));
  }
  const map = GENRE_CACHE.get(kind);
  return (ids ?? []).map((id) => map.get(id)).filter(Boolean);
}

/** TMDB genre ids that tell us what a title actually is, beyond movie-vs-tv. */
function classify(isMovie, genres) {
  if (genres.includes('Documentary')) return 'documentary';
  if (genres.includes('Reality')) return 'reality';
  if (genres.includes('Animation') && !isMovie) return 'anime';
  return isMovie ? 'film' : 'series';
}

/** TMDB popularity is unbounded and long-tailed; squash it into a 0–100 heat. */
function heatFrom(popularity, voteAverage, voteCount) {
  const pop = Math.min(100, Math.log10(1 + (popularity ?? 0)) * 34);
  const quality = voteCount > 40 ? ((voteAverage ?? 0) / 10) * 25 : 0;
  return Math.round(Math.min(100, pop * 0.8 + quality));
}

function providerIndex(platforms) {
  const index = new Map();
  for (const p of platforms) for (const id of p.tmdb) index.set(id, p.id);
  return index;
}

// -------------------------------------------------------------------- fetch --

async function discover({ isMovie, region, from, to, page }) {
  const path = isMovie ? '/discover/movie' : '/discover/tv';
  const dateParams = isMovie
    ? { 'primary_release_date.gte': from, 'primary_release_date.lte': to }
    : { 'first_air_date.gte': from, 'first_air_date.lte': to };
  return tmdb(path, {
    ...dateParams,
    watch_region: region,
    with_watch_monetization_types: 'flatrate|free|ads',
    sort_by: 'popularity.desc',
    include_adult: false,
    page,
  });
}

async function providersFor(isMovie, id, region) {
  try {
    const data = await tmdb(`/${isMovie ? 'movie' : 'tv'}/${id}/watch/providers`);
    const scoped = data.results?.[region];
    if (!scoped) return [];
    return [...(scoped.flatrate ?? []), ...(scoped.free ?? []), ...(scoped.ads ?? [])].map(
      (p) => p.provider_id,
    );
  } catch {
    return [];
  }
}

/** Fold case and punctuation so a curated title and a discovered one compare equal. */
function normTitle(t) {
  return (t ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

async function buildWeek(weekId, platforms, index) {
  const from = weekId;
  const to = iso(new Date(new Date(`${weekId}T00:00:00Z`).getTime() + 6 * DAY));
  /** @type {Map<string, any>} */
  const byId = new Map();

  for (const region of REGIONS) {
    for (const isMovie of [true, false]) {
      for (let page = 1; page <= 3; page++) {
        const data = await discover({ isMovie, region, from, to, page });
        if (!data.results?.length) break;

        for (const item of data.results) {
          const providerIds = await providersFor(isMovie, item.id, region);
          const mapped = [...new Set(providerIds.map((p) => index.get(p)).filter(Boolean))];
          if (!mapped.length) continue;

          const key = `${isMovie ? 'm' : 't'}-${item.id}`;
          const existing = byId.get(key);
          if (existing) {
            existing.platforms = [...new Set([...existing.platforms, ...mapped])];
            existing.regions = [...new Set([...existing.regions, region])];
            continue;
          }

          const genres = await genreNames(isMovie ? 'movie' : 'tv', item.genre_ids);
          byId.set(key, {
            id: key,
            title: item.title ?? item.name,
            kind: classify(isMovie, genres),
            platforms: mapped,
            languages: [item.original_language].filter(Boolean),
            genres,
            releaseDate: item.release_date ?? item.first_air_date ?? from,
            regions: [region],
            rating: item.vote_count > 20 ? Number(item.vote_average?.toFixed(1)) : undefined,
            heat: heatFrom(item.popularity, item.vote_average, item.vote_count),
            synopsis: item.overview || undefined,
            posterUrl: item.poster_path ? `${IMG}/w500${item.poster_path}` : undefined,
            backdropUrl: item.backdrop_path ? `${IMG}/w780${item.backdrop_path}` : undefined,
          });
        }
        if (page >= (data.total_pages ?? 1)) break;
      }
    }
  }

  const releases = [...byId.values()].sort((a, b) => (b.heat ?? 0) - (a.heat ?? 0));
  return { id: weekId, start: from, end: to, releases };
}

// --------------------------------------------------------------------- main --

const platforms = await loadPlatforms();
const index = providerIndex(platforms);
console.log(`Mapped ${index.size} TMDB providers across ${platforms.length} platforms.`);

// Curated rows are hand-checked and cover regional titles TMDB's discover
// endpoints miss entirely, so a rebuild adds to them rather than replacing them.
const previous = await readFile(OUT, 'utf8')
  .then((raw) => JSON.parse(raw))
  .catch(() => ({ weeks: [] }));
const curatedByWeek = new Map(
  previous.weeks.map((w) => [w.id, w.releases.filter((r) => r.sample)]),
);

const weeks = [];
for (const id of weekIds()) {
  process.stdout.write(`Building week ${id} … `);
  const week = await buildWeek(id, platforms, index);

  const curated = curatedByWeek.get(id) ?? [];
  if (curated.length) {
    // Drop a discovered row when a curated row already covers that title, so a
    // week never lists the same film twice under two different ids.
    const claimed = new Set(curated.map((r) => normTitle(r.title)));
    const fresh = week.releases.filter((r) => !claimed.has(normTitle(r.title)));
    week.releases = [...curated, ...fresh].sort((a, b) => (b.heat ?? 0) - (a.heat ?? 0));
    console.log(`${fresh.length} discovered + ${curated.length} curated`);
  } else {
    console.log(`${week.releases.length} releases`);
  }
  weeks.push(week);
}

const total = weeks.reduce((n, w) => n + w.releases.length, 0);
if (total === 0) {
  console.error('TMDB returned nothing at all — refusing to overwrite the feed with an empty file.');
  process.exit(1);
}

await mkdir(dirname(OUT), { recursive: true });
await writeFile(
  OUT,
  JSON.stringify({ generatedAt: new Date().toISOString(), source: 'tmdb', weeks }, null, 2) + '\n',
);
console.log(`Wrote ${total} releases across ${weeks.length} weeks to ${OUT} (${calls} API calls).`);
