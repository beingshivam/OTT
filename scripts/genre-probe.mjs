#!/usr/bin/env node
/**
 * How many titles is "Action", honestly?
 *
 * The header promises a million titles. A genre page shows 269. Both numbers
 * are true about different things — the million is TMDB's whole catalogue,
 * every film and show ever made anywhere, and the 269 is this site's own rows
 * — but a reader does not see two things, they see one site contradicting
 * itself. Before deciding what a genre page should contain, it is worth
 * knowing the number that actually matters, which is neither of those: how
 * many Action titles a person in India can press play on tonight.
 *
 * Nobody knows that number offhand. TMDB will answer it, so ask rather than
 * argue about it. /discover takes a genre, a region and a set of watch
 * providers, and reports total_results — which is the count of titles TMDB
 * believes are on those services in India. Per genre, films and series
 * separately, plus two reference figures:
 *
 *   - the same genre with no provider filter (the "on TMDB at all" number,
 *     which is the one the million refers to)
 *   - every title on those services with no genre filter (the ceiling — the
 *     largest a genre page could ever honestly be)
 *
 * What it is not. total_results is TMDB's bookkeeping, not a guarantee: its
 * India provider data is incomplete for regional services and stale in places,
 * and /discover counts a title once per row regardless of whether the entry is
 * a real thing anybody wants. Treat these as an order of magnitude — "hundreds
 * or tens of thousands" is the question being settled, not the third digit.
 *
 * Reports, never gates. It is a measurement, and no measurement should be able
 * to stop a deploy.
 *
 * Usage: node scripts/genre-probe.mjs
 *        node scripts/genre-probe.mjs --json
 */

import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { callCount, requireToken, tmdb } from './tmdb.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REGION = 'IN';
const JSON_OUT = process.argv.includes('--json');

requireToken();

/**
 * The provider ids, read from the registry rather than retyped.
 *
 * Same reasoning as build-digest and build-brand-marks: a second copy of this
 * table drifts the first time a service is renamed, and with JioHotstar that
 * has already happened once. A regex over the source is crude but it is the
 * established way these scripts read a .ts file without a build step.
 */
async function indianProviderIds() {
  const src = await readFile(resolve(ROOT, 'src/data/platforms.ts'), 'utf8');
  const ids = new Set();
  for (const line of src.split('\n')) {
    if (!/^\s*\{\s*id:/.test(line)) continue;
    if (!/regions:\s*\[[^\]]*'IN'/.test(line)) continue;
    const tmdbIds = line.match(/tmdb:\s*\[([^\]]*)\]/);
    if (!tmdbIds) continue;
    for (const n of tmdbIds[1].split(',')) {
      const id = Number(n.trim());
      if (Number.isFinite(id) && id > 0) ids.add(id);
    }
  }
  return [...ids];
}

/** The genres the site has a page for, read from the collections table. */
async function collectionGenres() {
  const src = await readFile(resolve(ROOT, 'src/data/collections.ts'), 'utf8');
  return [...src.matchAll(/genres:\s*\['([^']+)'\]/g)].map((m) => m[1]);
}

/**
 * Our own count for a genre, from the two datasets the site ships.
 *
 * Deduped across both, because the board and the back catalogue overlap: a
 * film released six weeks ago that is also well-rated appears in each, and
 * counting it twice would flatter the comparison this whole script exists to
 * make honest.
 */
async function oursByGenre(genres) {
  const counts = Object.fromEntries(genres.map((g) => [g, 0]));
  const seen = new Set();
  const rows = [];
  try {
    const feed = JSON.parse(await readFile(resolve(ROOT, 'public/data/releases.json'), 'utf8'));
    for (const week of feed.weeks ?? []) rows.push(...(week.releases ?? []));
  } catch {
    /* Not built yet — the TMDB half is still worth having. */
  }
  try {
    const cat = JSON.parse(await readFile(resolve(ROOT, 'public/data/catalogue.json'), 'utf8'));
    rows.push(...(cat.titles ?? []));
  } catch {
    /* Same. */
  }
  for (const row of rows) {
    if (!row?.id || seen.has(row.id)) continue;
    seen.add(row.id);
    for (const g of row.genres ?? []) if (g in counts) counts[g]++;
  }
  return { counts, total: seen.size };
}

/** TMDB's numeric genre ids, which differ between films and series. */
async function genreIds() {
  const [film, series] = await Promise.all([
    tmdb('/genre/movie/list', { language: 'en-US' }),
    tmdb('/genre/tv/list', { language: 'en-US' }),
  ]);
  const table = (list) => new Map((list.genres ?? []).map((g) => [g.name.toLowerCase(), g.id]));
  return { film: table(film), series: table(series) };
}

/**
 * One /discover count. Providers are pipe-joined, which TMDB reads as OR —
 * "on any of these", the same question the site's platform filter asks.
 */
async function count(kind, { genre, providers }) {
  const path = kind === 'film' ? '/discover/movie' : '/discover/tv';
  const body = await tmdb(path, {
    with_genres: genre,
    watch_region: providers ? REGION : undefined,
    with_watch_providers: providers ? providers.join('|') : undefined,
    include_adult: false,
    language: 'en-US',
  });
  return body.total_results ?? 0;
}

const providers = await indianProviderIds();
const genres = await collectionGenres();
const ids = await genreIds();
const ours = await oursByGenre(genres);

const rows = [];
for (const name of genres) {
  const key = name.toLowerCase();
  /* TV files Action under "Action & Adventure" and has no Crime/Horror split
     the way film does; fall back to whatever TMDB's own list carries, and say
     so rather than silently reporting zero. */
  const filmId = ids.film.get(key) ?? null;
  const seriesId =
    ids.series.get(key) ??
    [...ids.series.entries()].find(([n]) => n.split(' & ').includes(key))?.[1] ??
    null;

  const [filmIN, seriesIN, filmAll, seriesAll] = await Promise.all([
    filmId ? count('film', { genre: filmId, providers }) : 0,
    seriesId ? count('series', { genre: seriesId, providers }) : 0,
    filmId ? count('film', { genre: filmId }) : 0,
    seriesId ? count('series', { genre: seriesId }) : 0,
  ]);

  rows.push({
    genre: name,
    ours: ours.counts[name] ?? 0,
    streamingInIndia: filmIN + seriesIN,
    films: filmIN,
    series: seriesIN,
    onTmdb: filmAll + seriesAll,
    onTmdbFilms: filmAll,
    onTmdbSeries: seriesAll,
    seriesGenreMissing: seriesId === null,
  });
}

/* The ceiling: everything on those services in India, any genre. */
const [ceilingFilm, ceilingSeries] = await Promise.all([
  count('film', { providers }),
  count('series', { providers }),
]);
const ceiling = ceilingFilm + ceilingSeries;

/**
 * Where total_results stops counting.
 *
 * The first run came back with three different genres reporting exactly
 * 20001 films worldwide, which is not a coincidence — it is a ceiling in
 * TMDB's own bookkeeping, and a number that has hit it is a floor wearing a
 * total's clothes. So ask an unfiltered /discover, which must be the whole
 * catalogue and is certainly not twenty thousand: whatever it answers is the
 * cap, and every figure at or above it gets marked rather than quoted.
 */
const [capFilm, capSeries] = await Promise.all([count('film', {}), count('series', {})]);
const capped = (n, kind) => n >= (kind === 'film' ? capFilm : capSeries);
const mark = (n, kind) => `${n}${capped(n, kind) ? '+' : ''}`;

if (JSON_OUT) {
  console.log(
    JSON.stringify(
      {
        region: REGION,
        providers,
        ours: ours.total,
        ceiling,
        ceilingFilm,
        ceilingSeries,
        reportingCap: { film: capFilm, series: capSeries },
        rows,
      },
      null,
      2,
    ),
  );
} else {
  const pad = (s, n) => String(s).padEnd(n);
  const num = (s, n) => String(s).padStart(n);
  const sum = (f, s) =>
    `${f + s}${capped(f, 'film') || capped(s, 'series') ? '+' : ''}`;
  console.log(`\nStreaming in India, across ${providers.length} provider ids\n`);
  console.log(
    `  ${pad('Genre', 12)}${num('ours', 7)}${num('in India', 11)}${num('films', 8)}${num('series', 8)}${num('on TMDB', 11)}`,
  );
  console.log(`  ${'-'.repeat(57)}`);
  for (const r of rows) {
    console.log(
      `  ${pad(r.genre, 12)}${num(r.ours, 7)}${num(sum(r.films, r.series), 11)}` +
        `${num(mark(r.films, 'film'), 8)}${num(mark(r.series, 'series'), 8)}` +
        `${num(sum(r.onTmdbFilms, r.onTmdbSeries), 11)}` +
        (r.seriesGenreMissing ? '   (no TV genre)' : ''),
    );
  }
  console.log(`  ${'-'.repeat(57)}`);
  console.log(
    `  ${pad('any genre', 12)}${num(ours.total, 7)}${num(sum(ceilingFilm, ceilingSeries), 11)}` +
      `${num(mark(ceilingFilm, 'film'), 8)}${num(mark(ceilingSeries, 'series'), 8)}`,
  );
  console.log(`\n  ours     — rows this site ships today (feed + catalogue, deduped)`);
  console.log(`  in India — TMDB titles on our platforms, watch_region=IN`);
  console.log(`  on TMDB  — the same genre worldwide, no provider filter`);
  console.log(
    `  +        — at TMDB's reporting ceiling (${capFilm} films, ${capSeries} series); a floor, not a total`,
  );
  console.log(`\n${callCount()} API calls.\n`);
}
