#!/usr/bin/env node
/**
 * Rebuilds public/data/releases.json from TMDB.
 *
 * Why a build-time pull instead of calling TMDB from the browser:
 *   - the API key never ships to a client,
 *   - the site is a static file that a CDN can cache and serve instantly,
 *   - and if TMDB is down on a Friday morning, last week's file still serves.
 *
 * Usage:  npm run refresh   (reads .env; TMDB_TOKEN in the environment also works)
 *          node scripts/fetch-releases.mjs [--weeks-back 3] [--weeks-ahead 4]
 *
 * The token is a TMDB v4 "API Read Access Token" from
 * https://www.themoviedb.org/settings/api
 */

import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { callCount, requireToken, tmdb } from './tmdb.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const OUT = resolve(ROOT, 'public/data/releases.json');
const IMG = 'https://image.tmdb.org/t/p';

const REGIONS = (process.env.REGIONS ?? 'IN,US').split(',').map((r) => r.trim()).filter(Boolean);

const args = process.argv.slice(2);
const argNum = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : fallback;
};
// A release calendar is read forwards more than backwards — "what's coming" is
// the question people bring to it — so the window leans ahead.
const WEEKS_BACK = argNum('weeks-back', 3);
const WEEKS_AHEAD = argNum('weeks-ahead', 4);

/**
 * Cinema listings are sorted by popularity, and one page is where the titles
 * anyone is waiting for live. A second page mostly adds long-tail regional
 * bookings — up to eighty rows a week across both regions, against a board that
 * carries about twenty in total — which would bury the streaming columns rather
 * than inform anyone.
 */
const THEATRICAL_PAGES = 1;

/**
 * How far back a cinema listing's own release date may sit before it counts as
 * a revival rather than a release.
 *
 * Asking TMDB what is in cinemas this week returns repertory screenings too — a
 * 1999 Princess Mononoke, a 2019 Avengers: Endgame. They really are showing,
 * but this is a calendar of what is *new*, and old films carry a decade of
 * accumulated votes, so they walked straight to the top of the highlighted
 * scores and pushed the week's actual releases out of view.
 *
 * A year is deliberately generous: a film can premiere at a festival or in one
 * state months before it opens elsewhere, and that is a genuine release for the
 * audience seeing it. Only the clear revivals are dropped.
 */
const REPERTORY_DAYS = 365;

requireToken();


// ---------------------------------------------------------------- registry --

/**
 * Mirror of src/data/platforms.ts, parsed at run time so the two can never drift.
 * Keeping one source of truth beats keeping two in sync by hand.
 */
async function loadPlatforms() {
  const src = await readFile(resolve(ROOT, 'src/data/platforms.ts'), 'utf8');
  const rows = [...src.matchAll(/\{\s*id:\s*'([^']+)'[\s\S]*?tmdb:\s*\[([^\]]*)\][\s\S]*?regions:\s*\[([^\]]*)\](.*)/g)];
  return rows.map(([, id, tmdb, regions, rest]) => ({
    id,
    tmdb: tmdb.split(',').map((n) => Number(n.trim())).filter(Number.isFinite),
    regions: [...regions.matchAll(/'([^']+)'/g)].map((m) => m[1]),
    // Cinema is not a watch provider, so it carries no TMDB ids and is filled
    // from the theatrical release dates instead.
    theatrical: /theatrical:\s*true/.test(rest),
  }));
}

// -------------------------------------------------------------------- http --


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

/**
 * How few votes a score can rest on before it is noise rather than signal.
 *
 * This sat at 20, which is a sound bar for a global release and far too high
 * for the regional cinema this calendar is mostly made of — it left four out of
 * five titles with no score at all. Lowered so smaller films get one, with the
 * vote count carried alongside so the board can show a thinly-voted score
 * quietly instead of pretending it carries the same weight.
 */
const MIN_VOTES = 5;

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

/**
 * Films opening in cinemas that week, per region.
 *
 * Two problems fall out of the same gap. Discover was only ever asked for
 * titles that already have a streaming provider, and TMDB assigns providers
 * *after* a title is available — so every future week came back completely
 * empty, and a release calendar that cannot answer "what's out next Friday" has
 * failed at its one job. Meanwhile "In Theatres" was carried entirely by
 * hand-written rows that lived only inside the generated feed, so they were one
 * rebuild away from vanishing once their week aged out of the window.
 *
 * Theatrical dates are announced weeks ahead and TMDB carries them, keyed by
 * region. Asking for them fixes both: upcoming weeks fill up, and the cinema
 * column becomes real data instead of a hand-maintained list.
 *
 * `release_date` (not `primary_release_date`) with `region` is what respects a
 * country's own dates — a film out in India this week may have opened in the US
 * months ago. Types 2 and 3 are limited and wide theatrical.
 */
async function discoverTheatrical({ region, from, to, page }) {
  return tmdb('/discover/movie', {
    'release_date.gte': from,
    'release_date.lte': to,
    region,
    with_release_type: '2|3',
    sort_by: 'popularity.desc',
    include_adult: false,
    page,
  });
}

/** True when a cinema listing is a revival rather than this week's release. */
function isRevival(releaseDate, weekStartIso) {
  if (!releaseDate) return false;
  const age = Date.parse(weekStartIso) - Date.parse(releaseDate);
  return Number.isFinite(age) && age > REPERTORY_DAYS * DAY;
}

function withinWeek(releaseDate, from, to) {
  if (!releaseDate) return false;
  const t = Date.parse(releaseDate);
  return Number.isFinite(t) && t >= Date.parse(from) && t <= Date.parse(to);
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
  const cinema = platforms.find((p) => p.theatrical);
  const theatricalId = cinema?.id;
  const theatricalRegions = cinema?.regions ?? [];

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
            rating: item.vote_count >= MIN_VOTES ? Number(item.vote_average?.toFixed(1)) : undefined,
        votes: item.vote_count || undefined,
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

  // Cinema openings, folded in on the same keys so a film that is both showing
  // and streaming stays one row carrying both platforms rather than appearing
  // twice under two ids.
  if (theatricalId) {
    for (const region of REGIONS) {
      if (!theatricalRegions.includes(region)) continue;
      for (let page = 1; page <= THEATRICAL_PAGES; page++) {
        let data;
        try {
          data = await discoverTheatrical({ region, from, to, page });
        } catch {
          // One region's cinema listing failing should cost that listing, not
          // the whole week that has already been assembled above.
          break;
        }
        if (!data.results?.length) break;

        for (const item of data.results) {
          if (isRevival(item.release_date, from)) continue;

          const key = `m-${item.id}`;
          const existing = byId.get(key);
          if (existing) {
            existing.platforms = [...new Set([...existing.platforms, theatricalId])];
            existing.regions = [...new Set([...existing.regions, region])];
            continue;
          }

          const genres = await genreNames('movie', item.genre_ids);
          byId.set(key, {
            id: key,
            title: item.title ?? item.name,
            kind: classify(true, genres),
            platforms: [theatricalId],
            languages: [item.original_language].filter(Boolean),
            genres,
            // TMDB returns the film's *primary* release date, which for a
            // staggered rollout is an earlier country's. Left as-is it put the
            // row outside its own week, and the poster view — which buckets by
            // day within the week — dropped it on the floor entirely: 9% of
            // rows were invisible there. Anything outside the window is pinned
            // to the week's Friday instead.
            releaseDate: withinWeek(item.release_date, from, to) ? item.release_date : from,
            regions: [region],
            rating: item.vote_count >= MIN_VOTES ? Number(item.vote_average?.toFixed(1)) : undefined,
        votes: item.vote_count || undefined,
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

/**
 * What's hot right now, independent of the release calendar. A title that came
 * out weeks ago and is peaking today is exactly what a weekly view misses, so
 * this comes from TMDB's own trending signal rather than from our rows.
 *
 * Only titles we can actually point at a platform are kept — "trending, but
 * nowhere you can watch it" is a dead end on a page whose job is where to watch.
 */
async function buildTrending(index) {
  const byId = new Map();

  // TMDB's trending list is global — there is no watch_region on it — so it is
  // fetched once and then tested against each region's providers. Fetching it
  // per region spent a call to get the same list back, and worse, the second
  // pass added the region to every title it had already seen without ever
  // checking whether it was watchable there: an India-only JioHotstar title
  // would claim to be streaming in the US.
  const { results = [] } = await tmdb('/trending/all/week');

  for (const region of REGIONS) {
    for (const item of results.slice(0, 20)) {
      if (item.media_type !== 'movie' && item.media_type !== 'tv') continue;
      const isMovie = item.media_type === 'movie';

      const providerIds = await providersFor(isMovie, item.id, region);
      const mapped = [...new Set(providerIds.map((p) => index.get(p)).filter(Boolean))];
      // Not watchable in this region: it earns neither a row nor this region.
      if (!mapped.length) continue;

      const key = `trend-${isMovie ? 'm' : 't'}-${item.id}`;
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
        releaseDate: item.release_date ?? item.first_air_date ?? '',
        regions: [region],
        rating: item.vote_count >= MIN_VOTES ? Number(item.vote_average?.toFixed(1)) : undefined,
        votes: item.vote_count || undefined,
        heat: heatFrom(item.popularity, item.vote_average, item.vote_count),
        synopsis: item.overview || undefined,
        posterUrl: item.poster_path ? `${IMG}/w500${item.poster_path}` : undefined,
        backdropUrl: item.backdrop_path ? `${IMG}/w780${item.backdrop_path}` : undefined,
      });
    }
  }

  return [...byId.values()].sort((a, b) => (b.heat ?? 0) - (a.heat ?? 0)).slice(0, 12);
}

// --------------------------------------------------------------------- main --

const platforms = await loadPlatforms();
const index = providerIndex(platforms);
const theatricalId = platforms.find((p) => p.theatrical)?.id;
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

/**
 * A film opens once. TMDB records several theatrical dates for one — a limited
 * run then a wide one, or a staggered rollout across states — and each of those
 * dates matches a different week window, so fifteen titles were being announced
 * as new releases two and three weeks running. Toxic: A Fairy Tale appeared on
 * both 21 Aug and 4 Sep. A calendar that says the same film is new twice is not
 * one anyone can trust.
 *
 * Weeks are already in chronological order, so the first sighting is the
 * opening and the rest are the run continuing. Only cinema-only rows collapse:
 * the same title showing in cinemas one week and landing on a streaming service
 * a fortnight later is two real events, and both belong on the calendar.
 */
const openedIn = new Set();
let repeats = 0;
for (const week of weeks) {
  week.releases = week.releases.filter((r) => {
    const cinemaOnly = r.platforms.length === 1 && r.platforms[0] === theatricalId;
    if (!cinemaOnly) return true;
    const key = normTitle(r.title);
    if (openedIn.has(key)) {
      repeats++;
      return false;
    }
    openedIn.add(key);
    return true;
  });
}
if (repeats) console.log(`Collapsed ${repeats} repeat cinema listing(s) to their opening week.`);

process.stdout.write('Building trending … ');
const trending = await buildTrending(index);
console.log(`${trending.length} titles`);

const total = weeks.reduce((n, w) => n + w.releases.length, 0);
if (total === 0) {
  console.error('TMDB returned nothing at all — refusing to overwrite the feed with an empty file.');
  process.exit(1);
}

await mkdir(dirname(OUT), { recursive: true });
await writeFile(
  OUT,
  JSON.stringify(
    { generatedAt: new Date().toISOString(), source: 'tmdb', weeks, trending },
    null,
    2,
  ) + '\n',
);
console.log(`Wrote ${total} releases across ${weeks.length} weeks to ${OUT} (${callCount()} API calls).`);
