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

const REGION = (process.env.REGIONS ?? 'IN').split(',')[0].trim() || 'IN';

/**
 * A discovered row already carries its TMDB id — `m-1240889` is movie 1240889.
 * Reading it back saves the search call entirely and removes any chance of the
 * matcher picking the wrong film. Only curated rows, which were written by hand
 * and have ids of their own, still need looking up.
 */
function tmdbRef(release) {
  const m = /^([mt])-(\d+)$/.exec(release.id ?? '');
  return m ? { isMovie: m[1] === 'm', id: Number(m[2]) } : null;
}

/** The best YouTube trailer TMDB has: official first, then any trailer, then a teaser. */
function trailerFrom(videos) {
  const yt = (videos?.results ?? []).filter((v) => v.site === 'YouTube' && v.key);
  const pick =
    yt.find((v) => v.type === 'Trailer' && v.official) ??
    yt.find((v) => v.type === 'Trailer') ??
    yt.find((v) => v.type === 'Teaser');
  return pick ? `https://www.youtube.com/watch?v=${pick.key}` : undefined;
}

/** The age rating for our own region, which lives in a different place per kind. */
function certificationFrom(detail, isMovie) {
  if (isMovie) {
    const row = detail.release_dates?.results?.find((r) => r.iso_3166_1 === REGION);
    return row?.release_dates?.map((d) => d.certification).find(Boolean) || undefined;
  }
  const row = detail.content_ratings?.results?.find((r) => r.iso_3166_1 === REGION);
  return row?.rating || undefined;
}

const feed = JSON.parse(await readFile(FEED, 'utf8'));
let matched = 0;
let skipped = 0;

for (const week of feed.weeks) {
  for (const release of week.releases) {
    const isMovie = release.kind === 'film' || release.kind === 'documentary';
    const endpoint = isMovie ? '/search/movie' : '/search/tv';

    let ref = tmdbRef(release);
    let hit = null;
    if (ref) {
      // Nothing to search for — the detail fetch below has everything it needs.
    } else
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

    if (!ref) {
      if (!hit) {
        skipped++;
        if (VERBOSE) console.log(`  – ${release.title}: no confident match, left as-is`);
        continue;
      }
      const asMovie = hit.__flipped ? !isMovie : isMovie;
      ref = { isMovie: asMovie, id: hit.id };
      if (hit.poster_path) release.posterUrl = `${IMG}/w500${hit.poster_path}`;
      if (hit.backdrop_path) release.backdropUrl = `${IMG}/w1280${hit.backdrop_path}`;
      if (hit.overview) release.synopsis = hit.overview;
    }

    /**
     * Everything a viewer decides on lives behind this one call: the trailer,
     * the cast, the runtime, the certificate. It used to be reached only by
     * rows that arrived without a poster — and discover supplies posters for
     * 96% of them, so it ran on almost nothing. Cast sat at 9%, runtime at 7%,
     * trailers and certificates at zero, which left the detail sheet, the one
     * screen where someone decides to watch, with a synopsis and little else.
     *
     * Now every row with a TMDB id gets it, every run. append_to_response
     * bundles credits, videos and certificates into the same request, so the
     * whole detail costs one call rather than four, and the score refreshes
     * along with it instead of ageing from whenever the row was discovered.
     */
    try {
      const detail = await tmdb(`/${ref.isMovie ? 'movie' : 'tv'}/${ref.id}`, {
        append_to_response: ref.isMovie
          ? 'credits,videos,release_dates'
          : 'credits,videos,content_ratings,external_ids',
      });

      /**
       * The IMDb id, so ratings can be looked up exactly.
       *
       * scripts/enrich-ratings.mjs asks OMDb for an IMDb score, and the only
       * honest way to ask is by id. Matching on title and year would be a guess
       * — and the failure mode is silent and awful: a Tamil film quietly
       * wearing the rating of an unrelated American one with a similar name.
       * A page that invents a date is worth less than no page, and the same is
       * true of a score.
       *
       * Movies carry it on the detail response. TV does not, so external_ids is
       * appended above — same request, no extra call.
       */
      const imdbId = ref.isMovie ? detail.imdb_id : detail.external_ids?.imdb_id;
      if (imdbId) release.imdbId = imdbId;
      const runtime = ref.isMovie ? detail.runtime : detail.episode_run_time?.[0];
      if (runtime) release.runtimeMinutes = runtime;
      if (detail.genres?.length) release.genres = detail.genres.map((g) => g.name);
      const cast = detail.credits?.cast?.slice(0, 5).map((c) => c.name) ?? [];
      if (cast.length) release.cast = cast;
      const director = detail.credits?.crew?.find((c) => c.job === 'Director')?.name;
      if (director) release.director = director;

      const trailer = trailerFrom(detail.videos);
      if (trailer) release.trailerUrl = trailer;
      const cert = certificationFrom(detail, ref.isMovie);
      if (cert) release.certification = cert;

      // Same bar as the discover pass, kept in step deliberately: a title should
      // not gain or lose its score depending on which pass happened to find it.
      if (detail.vote_count >= 5) {
        release.rating = Number(detail.vote_average.toFixed(1));
        release.votes = detail.vote_count;
      }
    } catch {
      /* Artwork already landed; detail is a bonus, not a requirement. */
    }

    matched++;
    if (VERBOSE) console.log(`  ✓ ${release.title}`);
  }
}

feed.enrichedAt = new Date().toISOString();
await writeFile(FEED, JSON.stringify(feed, null, 2) + '\n');
console.log(
  `\nEnriched ${matched} title(s); ${skipped} left with generated art. ${callCount()} API calls.`,
);
