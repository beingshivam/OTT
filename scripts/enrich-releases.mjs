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
import { callCount, requireToken, tmdb } from './tmdb.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const FEED = resolve(ROOT, 'public/data/releases.json');
const API = 'https://api.themoviedb.org/3';
const IMG = 'https://image.tmdb.org/t/p';

const FORCE = process.argv.includes('--force');
const VERBOSE = process.argv.includes('--verbose');

requireToken();



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
    // Same bar as the discover pass, kept in step deliberately: a title should
    // not gain or lose its score depending on which pass happened to find it.
    if (hit.vote_count >= 5) {
      release.rating = Number(hit.vote_average.toFixed(1));
      release.votes = hit.vote_count;
    }

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
  `\nEnriched ${matched} title(s); ${skipped} left with generated art. ${callCount()} API calls.`,
);
