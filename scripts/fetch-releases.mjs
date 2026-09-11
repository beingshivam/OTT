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

/* Overridable so the pipeline can be exercised against a stubbed TMDB without
 * writing over the real calendar — see scripts/fetch-releases.test.mjs. The
 * default is the only path anything in production uses. */
const OUT = process.env.FEED_OUT
  ? resolve(process.env.FEED_OUT)
  : resolve(ROOT, 'public/data/releases.json');
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
 * Cinema reaches further back than streaming, because the two decay at
 * completely different rates and the old symmetric window modelled them as if
 * they did not.
 *
 * A streaming release is a point event with a safety net: the title drops, and
 * from then on it is permanently available and permanently in the catalogue. Its
 * week ageing out of the feed costs nothing, because /streaming still carries
 * it. A cinema release is the opposite — it has a *run*, typically four to eight
 * weeks, during which it is the thing people are actually going out to watch,
 * and it is in no catalogue at all, because a film in cinemas has no streaming
 * provider by definition. So when its week aged out of a three-week window it
 * stopped existing on this site entirely, while still playing down the road.
 *
 * Measured on the 7 Sep feed: 29 films were showing in Indian cinemas, present
 * in the data, reachable only by stepping back through the week arrows, and
 * none of them was in the catalogue. Three weeks later they would have been
 * gone. That is the gap this closes.
 *
 * Only the cinema pass runs for these extra weeks — see buildWeek's cinemaOnly.
 * Re-running the streaming discovery over old weeks would cost calls to
 * rediscover titles the catalogue already holds.
 */
const THEATRE_WEEKS_BACK = argNum('theatre-weeks-back', 6);

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

/**
 * Every week the feed carries, oldest first, each flagged with whether it gets
 * the full build or only the cinema pass. Chronological order matters: the
 * repeat-listing collapse downstream treats the first sighting of a film as its
 * opening, so the extra cinema weeks have to lead, not trail.
 */
function weekIds() {
  const base = weekStart(new Date());
  const out = [];
  const back = Math.max(WEEKS_BACK, THEATRE_WEEKS_BACK);
  for (let i = -back; i <= WEEKS_AHEAD; i++) {
    out.push({ id: iso(new Date(base.getTime() + i * 7 * DAY)), cinemaOnly: i < -WEEKS_BACK });
  }
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

/**
 * Titles with a digital release date announced but no service yet.
 *
 * The same gap the theatrical pass exists to close, on the other side. Discover
 * is asked for titles that already carry a watch provider, and TMDB assigns
 * those on release day — so a film landing on OTT in three weeks is invisible
 * to it, and "Coming soon" came back as cinema listings and almost nothing
 * else. On a site called New on OTT that is the wrong week to be empty.
 *
 * TMDB does carry the date ahead of time: release type 4 is Digital, keyed by
 * region exactly like the theatrical types 2 and 3. What it will not tell us is
 * *where* — that arrives with the provider on release day — so these rows ship
 * with the date, which is the part people are actually searching for, and the
 * service marked unknown. The next refresh after the title lands replaces it
 * with the real platform, because the provider pass above runs first and wins.
 *
 * Movies only. There is no release-type filter for TV, and asking discover for
 * every series with a first_air_date in a window would return the world.
 */
async function discoverDigital({ region, from, to, page }) {
  return tmdb('/discover/movie', {
    'release_date.gte': from,
    'release_date.lte': to,
    region,
    with_release_type: '4',
    sort_by: 'popularity.desc',
    include_adult: false,
    page,
  });
}

/** The synthetic platform a date-without-a-service lands on. Must match the
 *  registry entry in src/data/platforms.ts. */
const DIGITAL_ID = 'ott';

/**
 * Every digital row that came back without a service, and what TMDB did have.
 *
 * Reported from the site: films released on OTT today showing "Platform TBA"
 * when their service was publicly announced. Adding the provider lookup did not
 * clear a single one of 137 rows — including 120 US rows, where TMDB's coverage
 * is not in doubt — and a result that clean is evidence about the question, not
 * about the network. This records which bucket TMDB actually had them in so the
 * next run answers it instead of me reasoning about it from here.
 */
const unplaced = [];

/** Cinema listings that turned out to be streaming too, for the run report. */
const landed = [];

/** Two pages is sixty of the most popular digital releases in a week, which is
 *  far more than any week actually has. The cap is a guard against a query that
 *  comes back broader than expected, not a limit anything real will hit. */
const DIGITAL_PAGES = 2;

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

/**
 * Every way TMDB says a title can be watched here, kept apart by kind.
 *
 * providersFor answers the question the board asks — "is this on a service
 * somebody subscribes to" — and throws away everything else, which is right for
 * it and useless for working out *why* a title came back unplaced. TMDB's
 * release type 4 is "Digital", and digital is not a synonym for streaming: for
 * a great many titles it means a rental or purchase window opening on iTunes or
 * Amazon, which lands in the rent and buy buckets this site deliberately
 * ignores.
 *
 * So the digital pass reads all of them and records what it saw. A row showing
 * "Platform TBA" is then either a title TMDB genuinely has nothing for, or a
 * title it has only as a rental — and those are different problems with
 * different answers, which is not something to guess at from the outside.
 */
async function offersFor(id, region) {
  const empty = { subscription: [], rent: [], buy: [] };
  try {
    const data = await tmdb(`/movie/${id}/watch/providers`);
    const scoped = data.results?.[region];
    if (!scoped) return empty;
    const ids = (list) => (list ?? []).map((p) => p.provider_id);
    return {
      subscription: [...ids(scoped.flatrate), ...ids(scoped.free), ...ids(scoped.ads)],
      rent: ids(scoped.rent),
      buy: ids(scoped.buy),
    };
  } catch {
    return empty;
  }
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

async function buildWeek(weekId, platforms, index, cinemaOnly = false) {
  const cinema = platforms.find((p) => p.theatrical);
  const theatricalId = cinema?.id;
  const theatricalRegions = cinema?.regions ?? [];

  const from = weekId;
  const to = iso(new Date(new Date(`${weekId}T00:00:00Z`).getTime() + 6 * DAY));
  /** @type {Map<string, any>} */
  const byId = new Map();

  for (const region of cinemaOnly ? [] : REGIONS) {
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

  /**
   * Announced digital dates, for weeks the provider pass cannot reach.
   *
   * Only forward of today, and only onto rows that came back with no streaming
   * service at all. A past week has real providers and they are strictly better
   * than "somewhere, eventually"; a row that already names Netflix must not
   * also claim an unknown service. So this adds a platform where there was
   * none, and never replaces one.
   *
   * Runs after the cinema fold on purpose. A film that opens in cinemas this
   * week and streams later is a cinema listing this week — and
   * unreleasedCannotBeStreaming below strips a streaming claim off any future
   * theatrical row anyway, which now covers this one too.
   */
  if (!cinemaOnly && to >= TODAY) {
    for (const region of REGIONS) {
      for (let page = 1; page <= DIGITAL_PAGES; page++) {
        let data;
        try {
          data = await discoverDigital({ region, from, to, page });
        } catch {
          // As with cinema listings: one region failing costs that region, not
          // the week already assembled above.
          break;
        }
        if (!data.results?.length) break;

        for (const item of data.results) {
          // A digital date on a film from years ago is a re-release into a
          // catalogue, not a drop. Same bar the cinema pass uses.
          if (isRevival(item.release_date, from)) continue;

          /*
           * The date has to be in this week, not merely near it.
           *
           * Every other pass clamps a stray date to the start of the week it is
           * being built for, which is right when the row belongs here and the
           * date field is the wrong one. It is wrong here: discover returns a
           * film for a window its digital date is only adjacent to — a title
           * dated the 24th comes back for the week beginning the 25th as well —
           * and the clamp then invents a second release on the 25th. Spidey and
           * the Avengers, Thomas & Friends and Matchbox the Movie each shipped
           * twice with two different dates, and the week whose window actually
           * contains the date already has the row, correctly.
           */
          if (!withinWeek(item.release_date, from, to)) continue;

          /*
           * Ask who has it before saying nobody knows.
           *
           * This pass shipped without ever calling providersFor, and the
           * omission is not harmless: reported from the site, a film released
           * on OTT *today* wearing "Platform TBA" when its service had been
           * publicly announced for weeks. Of course it had been — a title
           * landing today is a title somebody is advertising.
           *
           * The provider pass above could not cover it. That one asks discover
           * for titles whose *primary* release date falls in the week, and a
           * film that opened in cinemas in August and streams in September has
           * its primary date in August, so it is never returned for the week it
           * actually lands in. This row is the only place that lookup can
           * happen, and it was the one place not doing it.
           *
           * The placeholder is what is left when TMDB genuinely has nobody yet,
           * which is the real state for something weeks out — not a label for a
           * question nobody asked.
           */
          const offer = await offersFor(item.id, region);
          const known = [...new Set(offer.subscription.map((p) => index.get(p)).filter(Boolean))];
          if (!known.length) unplaced.push({ title: item.title ?? item.name, region, offer });

          /*
           * The date ships whether or not anything can name a service.
           *
           * This dropped a row once its date had arrived, on the reasoning that
           * "out now, somewhere" is an admission rather than news. The
           * reasoning was about the *label*, and I applied it to the *row* —
           * which emptied the current week. Seven titles dated 11 September
           * vanished, one of them a Netflix release confirmed by hand, and the
           * site was left saying nothing at all releases this week.
           *
           * The label is fixed where labels live. A row with no service named
           * groups under "Releasing on OTT", which claims only what is true,
           * and no longer under anything asserting that nobody has announced
           * one. Hiding the title was never what that fixed.
           *
           * These rows are also the only cover for the window that matters
           * most: TMDB attaches providers on or after release day, so the
           * current week is always sparse on its own Friday and fills in
           * behind itself. Last Friday's seventeen drops reached the feed
           * days late. Without the dated rows, Friday shows an empty site.
           */

          const key = `m-${item.id}`;
          const existing = byId.get(key);
          if (existing) {
            // Anything real beats an unknown, including a cinema listing —
            // a film in cinemas this week is not "coming to streaming".
            if (existing.platforms.length) {
              existing.regions = [...new Set([...existing.regions, region])];
              continue;
            }
            existing.platforms = known.length ? known : [DIGITAL_ID];
            existing.regions = [...new Set([...existing.regions, region])];
            continue;
          }

          const genres = await genreNames('movie', item.genre_ids);
          byId.set(key, {
            /*
             * Its own id, because it is its own calendar entry.
             *
             * byId is scoped to one week, so a film that opened in cinemas in
             * August and reaches OTT in September is deduplicated within each
             * week and duplicated across them — two rows carrying one id. That
             * breaks the feed's no-duplicate-ids invariant, and it broke the
             * title page too, which looks a film up by id and got whichever row
             * it happened to find.
             *
             * The two rows are both correct and both wanted: a cinema listing
             * in the week it opened, and a streaming date in the week it lands.
             * What was wrong was calling them the same thing. The suffix keeps
             * the TMDB id readable so enrichment still resolves it — see
             * tmdbRef in scripts/enrich-releases.mjs, which parses past it.
             */
            id: `${key}~ott`,
            title: item.title ?? item.name,
            kind: classify(true, genres),
            platforms: known.length ? known : [DIGITAL_ID],
            languages: [item.original_language].filter(Boolean),
            genres,
            // Guarded above: a row only reaches here when its date is in the week.
            releaseDate: item.release_date,
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

  /*
   * Ask again about the films we already have.
   *
   * Every pass above asks "who has this" only about titles discover just
   * returned for this week. Nothing ever re-asks about a row already in the
   * feed — and a cinema listing from five weeks ago is the single most likely
   * title in the whole calendar to have just landed on OTT.
   *
   * Reported from the site: "I see a lot of movies and shows in the cinema rail
   * but those were supposed to be in their respective OTT platform." They were,
   * and the calendar had no way of finding out. The provider discovery is keyed
   * on primary release date, so a film that opened in August and reached
   * streaming in September is never returned for the week it streams in, and
   * its August row keeps saying "theatres" for as long as it is on the board.
   *
   * A film can be both, and the row says both — see the cinema and streaming
   * rails, which are built to overlap. This adds a platform and never removes
   * the cinema listing.
   *
   * Bounded to rows with nothing but a cinema listing, so it costs one call per
   * film actually in question rather than one per row.
   */
  const stale = [...byId.values()].filter(
    (r) => r.platforms.length === 1 && r.platforms[0] === theatricalId && r.releaseDate <= TODAY,
  );
  for (const row of stale) {
    const m = /^m-(\d+)$/.exec(row.id);
    if (!m) continue;
    for (const region of row.regions ?? []) {
      const found = [
        ...new Set((await providersFor(true, Number(m[1]), region)).map((p) => index.get(p)).filter(Boolean)),
      ];
      if (found.length) {
        row.platforms = [...new Set([...row.platforms, ...found])];
        landed.push(`${row.title} → ${found.join(', ')}`);
        break;
      }
    }
  }

  const releases = [...byId.values()]
    .map(unreleasedCannotBeStreaming)
    .sort((a, b) => (b.heat ?? 0) - (a.heat ?? 0));
  return { id: weekId, start: from, end: to, releases };
}

/**
 * A film that opens in cinemas next month is not already on Prime.
 *
 * Reported from the site: "Drishyam: The Conclusion" showed for 2 October with
 * both a cinema listing and Prime Video. The title, the date and the language
 * were all right — the Prime badge was not, and it was the kind of wrong that
 * costs a reader a subscription they did not need.
 *
 * The cause is the same property of TMDB this whole calendar is built around:
 * providers are assigned *after* a title is available, which is why theatrical
 * dates have to be fetched separately for upcoming weeks to exist at all. Run
 * that backwards and a provider sitting on a future theatrical row cannot be a
 * fact about that film — there is nothing yet for anyone to stream. In this
 * case it is almost certainly the franchise's earlier entries, which really are
 * on Prime: the Malayalam Drishyam 3 has been streaming there since May, and
 * the site has that right, in the catalogue, where it belongs.
 *
 * Deliberately narrow. A future release with no cinema listing keeps its
 * platform, because a streaming-only title announced for a date is a real
 * thing the calendar should carry. Only the contradiction is removed: in
 * cinemas, not yet out, and somehow also streaming.
 */
const TODAY = new Date().toISOString().slice(0, 10);

function unreleasedCannotBeStreaming(row) {
  if (row.releaseDate <= TODAY) return row;
  if (!row.platforms.includes('theatres')) return row;
  const streaming = row.platforms.filter((p) => p !== 'theatres');
  if (!streaming.length) return row;
  console.log(
    `  ${row.title} (${row.releaseDate}) opens in cinemas — dropping ${streaming.join(', ')}, ` +
      'which TMDB cannot yet know.',
  );
  return { ...row, platforms: ['theatres'] };
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
/*
 * Carried forward, and deduplicated on the way.
 *
 * Curated rows come from the previous build, so any duplicate in it is
 * duplicated again on every run after — a defect that repairs itself only if
 * the carry-forward refuses to carry two of anything. One slipped in before the
 * hand-placed file matched on id, and matching on id alone would have updated
 * the first copy and left the second in place for ever.
 */
const curatedByWeek = new Map(
  previous.weeks.map((w) => {
    const seen = new Set();
    return [
      w.id,
      w.releases.filter((r) => r.sample && !seen.has(r.id) && (seen.add(r.id), true)),
    ];
  }),
);

/**
 * Streaming dates entered by hand, because nothing automated knows them.
 *
 * Measured: TMDB has a platform for four digital rows out of 142, and reading
 * the production company recovered two more. For Lust Stories 3 — a Netflix
 * anthology whose service was public the day it was announced — there is no
 * automated source at all, and the site was printing "Platform not announced"
 * about a platform that had very much been announced.
 *
 * Merged in as curated rows, so they use the machinery that already exists for
 * titles discover misses, and are superseded automatically: once the title
 * lands TMDB assigns a provider, the provider pass finds it, and the discovered
 * row replaces this one. A stale entry is overtaken rather than left to rot.
 *
 * Missing or malformed is not an error. This file is an optional improvement to
 * a calendar that has to keep building without it at two in the morning.
 */
const HAND_PLACED = resolve(ROOT, 'data/upcoming-ott.json');
const handPlaced = await readFile(HAND_PLACED, 'utf8')
  .then((raw) => JSON.parse(raw).titles ?? [])
  .catch(() => []);

let handAdded = 0;
for (const row of handPlaced) {
  if (!row?.title || !row.releaseDate || !row.platform) continue;
  if (!index.size || !platforms.some((p) => p.id === row.platform)) {
    console.log(`  skipping ${row.title}: "${row.platform}" is not a platform in the registry.`);
    continue;
  }
  const week = iso(weekStart(new Date(`${row.releaseDate}T00:00:00Z`)));
  const list = curatedByWeek.get(week) ?? [];
  /*
   * The previous feed already holds it.
   *
   * Curated rows are carried forward from the last build — that is what makes
   * them curated — so appending this file's rows on top added a second copy on
   * every refresh. Lust Stories 3 appeared twice within one run of finding out.
   * The id is derived from the title, so it is the same on both, and matching
   * on it means this file updates its own row rather than stacking on it.
   */
  const id = `hand-${normTitle(row.title).replace(/\s+/g, '-')}`;
  const at = list.findIndex((r) => r.id === id);
  const merged = {
    // Distinct from any discovered id, and stable so the archive keeps it.
    id,
    title: row.title,
    kind: row.kind ?? 'film',
    platforms: [row.platform],
    languages: row.languages ?? [],
    genres: row.genres ?? [],
    releaseDate: row.releaseDate,
    regions: row.regions ?? ['IN'],
    sample: true,
  };
  // Anything enrichment already attached to the existing row — poster,
  // synopsis, cast — is kept; this file owns only the facts it states.
  if (at >= 0) list[at] = { ...list[at], ...merged };
  else list.push(merged);
  curatedByWeek.set(week, list);
  handAdded++;
}
if (handAdded) console.log(`Merged ${handAdded} hand-placed streaming date(s).`);

const weeks = [];
for (const { id, cinemaOnly } of weekIds()) {
  process.stdout.write(`Building week ${id}${cinemaOnly ? ' (cinema only)' : ''} … `);
  const week = await buildWeek(id, platforms, index, cinemaOnly);

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

/*
 * Why anything is still wearing "Platform TBA".
 *
 * Printed rather than inferred. The question — is TMDB silent about these
 * titles, or does it only have them as rentals — decides whether the fix is to
 * read another bucket or to stop claiming a date we cannot place, and guessing
 * between those two from the outside is how the last three hours went.
 */
if (landed.length) {
  console.log(
    `\n${landed.length} cinema listing(s) turned out to be streaming as well, and now say so:`,
  );
  for (const line of landed.slice(0, 12)) console.log(`  ${line}`);
}

if (unplaced.length) {
  const rentable = unplaced.filter((u) => u.offer.rent.length || u.offer.buy.length);
  console.log(
    `\n${unplaced.length} digital row(s) came back without a subscription service. ` +
      `${rentable.length} of them TMDB has as rent or buy only; ` +
      `${unplaced.length - rentable.length} it has nothing at all for.`,
  );
  for (const u of unplaced.slice(0, 12)) {
    const where = u.offer.rent.length || u.offer.buy.length
      ? `rent ${JSON.stringify(u.offer.rent)} buy ${JSON.stringify(u.offer.buy)}`
      : 'nothing in any bucket';
    console.log(`  ${u.region}  ${u.title.slice(0, 42).padEnd(42)} ${where}`);
  }
}
