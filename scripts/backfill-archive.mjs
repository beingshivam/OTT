#!/usr/bin/env node
/**
 * The rows the daily enrichment can no longer reach.
 *
 * scripts/enrich-releases.mjs walks `feed.weeks` — the rolling eight-week
 * window — and the archive is never revisited. That was invisible while the
 * archive was young and it is not any more: a film that entered the calendar
 * during a run where TMDB was slow, or before a field was being collected at
 * all, keeps that gap forever. It ages out of the window and nothing tries
 * again.
 *
 * Measured on 22 September, over the 390 Indian rows in the archive:
 *
 *     runtime        53%        90 rows the feed no longer carries, of which
 *     certificate    37%        45 have no runtime, 62 no certificate,
 *     trailer        58%        43 no trailer and 9 no synopsis
 *     director       77%
 *     backdrop       77%
 *
 * And the sharp end of it: 390 films have enough metadata to deserve a page
 * and only 318 have one. 38 are blocked by a missing synopsis, 25 by one too
 * thin to publish, 9 by a missing poster. Seventy-two pages that should exist,
 * held back by fields one API call would fill.
 *
 * ---------------------------------------------------------------------------
 * Why this is a separate script rather than a flag on the enricher
 *
 * They write different files. The enricher owns public/data/releases.json and
 * runs on the critical path of every refresh; this owns data/archive.json and
 * is a sweep that can fail without costing anybody a calendar. Folding it in
 * would put a long, rate-limited, best-effort pass in front of the step that
 * publishes the week — and the daily path is the one thing on this site that
 * must not become more fragile.
 *
 * ---------------------------------------------------------------------------
 * Budgeted, and round-robin
 *
 * Some fields are missing because TMDB does not have them, and no number of
 * retries will conjure a certificate for a small Odia film. Asking again every
 * day would spend the whole budget on the same permanent failures and never
 * reach the rows that would actually answer. So every attempt is stamped, and
 * a row is not retried for RETRY_DAYS — the sweep moves through the archive
 * instead of grinding against its hardest edge.
 *
 * Usage: node scripts/backfill-archive.mjs      (BUDGET=60 by default)
 */

import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmdb, requireToken, callCount } from './tmdb.mjs';
import { fetchTitle, Fatal } from './omdb.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/* Overridable so the test can point at a throwaway file. A test that backs up
   and restores the real archive works right up until it crashes between the
   two. */
const ARCHIVE = process.env.ARCHIVE_PATH
  ? resolve(process.env.ARCHIVE_PATH)
  : resolve(ROOT, 'data/archive.json');
const IMG = 'https://image.tmdb.org/t/p';
const REGION = 'IN';

const BUDGET = Number(process.env.BUDGET ?? 60);
/** Long enough that a permanently-absent field stops costing a call every day,
 *  short enough that a field TMDB adds later is picked up within the month. */
const RETRY_DAYS = 21;
const TODAY = new Date().toISOString().slice(0, 10);

requireToken();

const archive = JSON.parse(await readFile(ARCHIVE, 'utf8'));
const rows = archive.titles;

/** The fields worth a call. Not `heat` or `rating` — those are live numbers the
 *  daily pass refreshes for rows in the window, and stale ones on an archived
 *  title are not wrong, just old. These are facts that do not change. */
const WANTED = [
  'synopsis',
  'posterUrl',
  'backdropUrl',
  'runtimeMinutes',
  'certification',
  'trailerUrl',
  'director',
  'cast',
];
const missing = (r) => WANTED.filter((k) => (Array.isArray(r[k]) ? !r[k].length : r[k] == null));

const words = (s) => (s ?? '').trim().split(/\s+/).filter(Boolean).length;
/** Mirrors the content bar in build-seo.mjs. A row this close to publishable is
 *  worth a call ahead of one that would only gain a runtime. */
const wouldGainAPage = (r) =>
  !r.posterUrl || !r.synopsis || (r.cast?.length ? words(r.synopsis) < 12 : words(r.synopsis) < 25);

const stale = (r) => !r.backfilledAt || r.backfilledAt < new Date(Date.now() - RETRY_DAYS * 864e5).toISOString().slice(0, 10);

const candidates = rows
  .filter((r) => (r.regions ?? []).includes(REGION) && missing(r).length && stale(r))
  /* Pages first, then whoever is missing most — a row with six gaps buys more
     per call than one missing only a trailer. */
  .sort(
    (a, b) =>
      Number(wouldGainAPage(b)) - Number(wouldGainAPage(a)) ||
      missing(b).length - missing(a).length ||
      b.releaseDate.localeCompare(a.releaseDate),
  )
  .slice(0, BUDGET);

console.log(
  `backfill: ${rows.filter((r) => (r.regions ?? []).includes(REGION) && missing(r).length).length} Indian rows have gaps; ` +
    `taking ${candidates.length} this run (budget ${BUDGET}).`,
);

const ref = (r) => {
  const m = /^([mt])-(\d+)(?:~[a-z]+)?$/.exec(r.id ?? '');
  return m ? { isMovie: m[1] === 'm', id: Number(m[2]) } : null;
};

/** The best YouTube trailer TMDB has — official first, then any trailer, then a
 *  teaser. Mirrors enrich-releases.mjs. */
function trailerFrom(videos) {
  const yt = (videos?.results ?? []).filter((v) => v.site === 'YouTube' && v.key);
  const pick =
    yt.find((v) => v.type === 'Trailer' && v.official) ??
    yt.find((v) => v.type === 'Trailer') ??
    yt.find((v) => v.type === 'Teaser');
  return pick ? `https://www.youtube.com/watch?v=${pick.key}` : undefined;
}

/** The Indian certificate, which is the only one worth printing to this
 *  audience. Mirrors enrich-releases.mjs. */
function certificationFrom(detail, isMovie) {
  if (isMovie) {
    const india = (detail.release_dates?.results ?? []).find((r) => r.iso_3166_1 === REGION);
    return india?.release_dates?.map((d) => d.certification).find(Boolean) || undefined;
  }
  return (detail.content_ratings?.results ?? []).find((r) => r.iso_3166_1 === REGION)?.rating || undefined;
}

let filled = 0;
let touched = 0;
let fromOmdb = 0;
const gained = [];

for (const row of candidates) {
  const r = ref(row);
  if (!r) continue;
  touched++;
  const before = missing(row).length;
  const couldPublish = wouldGainAPage(row);

  try {
    const detail = await tmdb(`/${r.isMovie ? 'movie' : 'tv'}/${r.id}`, {
      append_to_response: r.isMovie
        ? 'credits,videos,release_dates'
        : 'credits,videos,content_ratings,external_ids',
    });

    /* Non-clobbering throughout: this fills holes and never overwrites a value
       the daily pass put there. The archive's whole contract is that a failed
       run cannot strip good data, and a sweep is exactly the kind of job that
       would violate it by accident. */
    const set = (k, v) => {
      if (v == null || v === '' || (Array.isArray(v) && !v.length)) return;
      if (Array.isArray(row[k]) ? row[k].length : row[k] != null) return;
      row[k] = v;
    };

    set('synopsis', detail.overview);
    set('posterUrl', detail.poster_path ? `${IMG}/w500${detail.poster_path}` : null);
    set('backdropUrl', detail.backdrop_path ? `${IMG}/w1280${detail.backdrop_path}` : null);
    set('runtimeMinutes', r.isMovie ? detail.runtime : detail.episode_run_time?.[0]);
    set('certification', certificationFrom(detail, r.isMovie));
    set('trailerUrl', trailerFrom(detail.videos));
    set('cast', detail.credits?.cast?.slice(0, 5).map((c) => c.name) ?? []);
    set('director', detail.credits?.crew?.find((c) => c.job === 'Director')?.name);
    set('genres', detail.genres?.map((g) => g.name) ?? []);
    set('imdbId', r.isMovie ? detail.imdb_id : detail.external_ids?.imdb_id);

    /*
     * OMDb for what TMDB does not have.
     *
     * The gap is not random: TMDB is thin on plot, runtime and certificate for
     * small regional Indian films, which is most of what is missing here. OMDb
     * carries all three and is already a dependency of this project for
     * ratings — so the second source costs a key that exists rather than a new
     * integration.
     *
     * By IMDb id only. Matching on title and year is the failure this codebase
     * has already refused once, for the same reason: a Tamil film quietly
     * wearing an unrelated American one's runtime is worse than a blank field,
     * because nothing about it looks wrong.
     */
    const stillMissing = missing(row);
    if (process.env.OMDB_API_KEY && row.imdbId && stillMissing.some((k) => k === 'synopsis' || k === 'runtimeMinutes' || k === 'certification')) {
      try {
        const body = await fetchTitle(row.imdbId, process.env.OMDB_API_KEY);
        if (body) {
          const plot = body.Plot && body.Plot !== 'N/A' ? body.Plot : null;
          const mins = /^(\d+)\s*min/.exec(body.Runtime ?? '')?.[1];
          const rated = body.Rated && !['N/A', 'NOT RATED', 'UNRATED'].includes(body.Rated) ? body.Rated : null;
          const had = missing(row).length;
          set('synopsis', plot);
          set('runtimeMinutes', mins ? Number(mins) : null);
          set('certification', rated);
          if (missing(row).length < had) fromOmdb++;
        }
      } catch (err) {
        if (err instanceof Fatal) throw err;
        /* A second source that is down is a second source that is down. The
           TMDB half of this row already landed. */
      }
    }

    row.backfilledAt = TODAY;
    const after = missing(row).length;
    if (after < before) {
      filled += before - after;
      if (couldPublish && !wouldGainAPage(row)) gained.push(row.title);
    }
  } catch (err) {
    /* Stamped even on failure, so a row TMDB 404s on does not consume the
       budget again tomorrow. */
    row.backfilledAt = TODAY;
    console.warn(`  ${row.title}: ${err.message}`);
  }
}

await writeFile(ARCHIVE, `${JSON.stringify({ ...archive, titles: rows }, null, 0)}\n`);

console.log(
  `backfill: ${touched} rows checked, ${filled} field(s) filled` +
    (fromOmdb ? `, ${fromOmdb} from OMDb where TMDB had nothing` : '') +
    `. ${callCount()} TMDB calls.`,
);
if (gained.length) {
  console.log(`          ${gained.length} now clear the bar for a page: ${gained.slice(0, 8).join(', ')}`);
}
