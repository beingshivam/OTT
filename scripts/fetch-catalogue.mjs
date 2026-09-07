#!/usr/bin/env node
/**
 * The back catalogue — what is good and streaming in India right now,
 * regardless of when it came out.
 *
 * Every other data path in this repo answers "what is new". A reader wrote in
 * saying that is only sometimes the question: plenty of evenings the question
 * is "what is genuinely worth watching", or "show me something good I have not
 * heard of". A release calendar structurally cannot answer either, because it
 * only ever holds eight weeks of the newest titles — which are precisely the
 * titles nobody has judged yet.
 *
 * So this is a second dataset with its own shape and its own clock. It is not
 * merged into the calendar: the calendar's promise is that everything on it is
 * new, and quietly mixing a 2016 film into it would break the one thing the
 * homepage is trusted for.
 *
 * ---------------------------------------------------------------------------
 * The design problem, and why the lists are per-language
 *
 * TMDB's vote counts are wildly uneven across languages. A mid-tier American
 * film carries tens of thousands of votes; a well-loved Malayalam one carries a
 * few hundred. So the obvious implementation — one global "top rated, at least
 * N votes" list — produces a page of Hollywood with a token Indian title at the
 * bottom, and calls it the best of Indian streaming.
 *
 * That is not hypothetical. The IMDb pass on this same feed scored 9 of 124
 * released India rows against TMDB's 45, for exactly this reason: the
 * international titles have the votes and the regional ones do not.
 *
 * So every query is per-language with its own vote floor, and the lists this
 * produces are only ever presented within a language. Tamil films are ranked
 * against Tamil films. Nothing here ever puts a 60-vote Kannada film and a
 * 40,000-vote English one in the same ordering and calls the result a ranking.
 *
 * ---------------------------------------------------------------------------
 * Fetch broad, slice at build
 *
 * This writes one catalogue. "Best of" and "hidden gems" are not separate
 * fetches — they are different slices of the same rows, decided at build time
 * from the rating, the vote count and the popularity stored on each. That means
 * the thresholds can be tuned by re-running the build, without spending another
 * thousand API calls to change a number.
 *
 * Usage: node scripts/fetch-catalogue.mjs [--pages 4] [--verbose]
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { callCount, requireToken, tmdb } from './tmdb.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'data/catalogue.json');
const REGION = 'IN';

const args = process.argv.slice(2);
const argNum = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : fallback;
};
const PAGES = argNum('pages', 4);
const VERBOSE = args.includes('--verbose');

/** A wall-clock stop, learned from the ratings pass: a slow upstream should cost
 *  a partial catalogue, not a runner held open for hours. */
const BUDGET_MS = Number(process.env.CATALOGUE_BUDGET_MS ?? 10 * 60_000);
const startedAt = Date.now();

requireToken();

/**
 * Per-language vote floors.
 *
 * Provisional. These are the numbers that decide whether a list is "the best
 * Malayalam films streaming here" or "seven films and some noise", and there is
 * no way to pick them honestly without seeing the real distribution — which
 * needs this script to have run once. The first run's summary prints how many
 * titles each language returned so they can be set from evidence rather than
 * from this guess.
 *
 * They are floors on *trust*, not on quality: below them a 9.1 is a handful of
 * people, and the site already learned what an untrustworthy score looks like
 * when a film turned up at a flat 10.0 from 1,029 brigaded votes.
 */
const LANGUAGES = [
  { code: 'hi', name: 'Hindi', minVotes: 200 },
  { code: 'ta', name: 'Tamil', minVotes: 60 },
  { code: 'te', name: 'Telugu', minVotes: 60 },
  { code: 'ml', name: 'Malayalam', minVotes: 60 },
  { code: 'kn', name: 'Kannada', minVotes: 40 },
  { code: 'bn', name: 'Bengali', minVotes: 40 },
  { code: 'mr', name: 'Marathi', minVotes: 40 },
  { code: 'en', name: 'English', minVotes: 2000 },
];

/** The registry's own provider ids, so a rebrand is fixed in one place. */
const registry = await readFile(resolve(ROOT, 'src/data/platforms.ts'), 'utf8');
const PLATFORMS = [
  ...registry.matchAll(
    /\{\s*id:\s*'([^']+)',[\s\S]*?tmdb:\s*\[([^\]]*)\][\s\S]*?regions:\s*\[([^\]]*)\]/g,
  ),
]
  .map(([, id, tmdbIds, regions]) => ({
    id,
    tmdb: tmdbIds.split(',').map((n) => Number(n.trim())).filter(Boolean),
    regions: regions.split(',').map((r) => r.trim().replace(/'/g, '')).filter(Boolean),
  }))
  .filter((p) => p.regions.includes(REGION) && p.tmdb.length);

if (!PLATFORMS.length) throw new Error('No India platforms with TMDB provider ids in the registry.');

/** provider id → our platform id, for turning a watch/providers response into
 *  the ids the rest of the app speaks. */
const platformByProvider = new Map();
for (const p of PLATFORMS) for (const n of p.tmdb) platformByProvider.set(n, p.id);
const ALL_PROVIDERS = [...platformByProvider.keys()].join('|');

const IMG = 'https://image.tmdb.org/t/p';

/**
 * `flatrate` only — included with a subscription.
 *
 * The question behind this feature is "what can I watch tonight". A title that
 * is rent-only is a different answer and a worse one, and offering it under a
 * heading that says otherwise is the kind of small dishonesty that costs a
 * reader's trust in everything else on the page.
 */
async function discover(isMovie, language, minVotes, page) {
  return tmdb(`/discover/${isMovie ? 'movie' : 'tv'}`, {
    watch_region: REGION,
    with_watch_providers: ALL_PROVIDERS,
    with_watch_monetization_types: 'flatrate',
    with_original_language: language,
    sort_by: 'vote_average.desc',
    'vote_count.gte': minVotes,
    include_adult: false,
    page,
  });
}

async function providersFor(isMovie, id) {
  try {
    const data = await tmdb(`/${isMovie ? 'movie' : 'tv'}/${id}/watch/providers`);
    const scoped = data.results?.[REGION];
    if (!scoped) return [];
    const ids = [...(scoped.flatrate ?? []), ...(scoped.free ?? []), ...(scoped.ads ?? [])].map(
      (p) => p.provider_id,
    );
    return [...new Set(ids.map((n) => platformByProvider.get(n)).filter(Boolean))];
  } catch {
    return [];
  }
}

// --- gather -----------------------------------------------------------------

/** Keyed by our own id so a title returned under two languages is one row. */
const byId = new Map();
const perLanguage = [];
let stopped = null;

outer: for (const lang of LANGUAGES) {
  let found = 0;
  for (const isMovie of [true, false]) {
    for (let page = 1; page <= PAGES; page++) {
      if (Date.now() - startedAt > BUDGET_MS) {
        stopped = `ran out of its ${Math.round(BUDGET_MS / 60_000)}-minute budget`;
        break outer;
      }

      let data;
      try {
        data = await discover(isMovie, lang.code, lang.minVotes, page);
      } catch (e) {
        if (VERBOSE) console.log(`  ! ${lang.name} ${isMovie ? 'film' : 'tv'} p${page}: ${e.message}`);
        break;
      }
      if (!data.results?.length) break;

      for (const item of data.results) {
        const id = `${isMovie ? 'm' : 't'}-${item.id}`;
        if (byId.has(id)) continue;

        const date = isMovie ? item.release_date : item.first_air_date;
        const title = isMovie ? item.title : item.name;
        if (!title || !date) continue;

        byId.set(id, {
          id,
          title,
          kind: isMovie ? 'film' : 'series',
          year: Number(date.slice(0, 4)),
          releaseDate: date,
          languages: [item.original_language].filter(Boolean),
          rating: Number(item.vote_average?.toFixed(1)),
          votes: item.vote_count,
          popularity: Number(item.popularity?.toFixed(1)),
          genreIds: item.genre_ids ?? [],
          synopsis: item.overview || undefined,
          posterUrl: item.poster_path ? `${IMG}/w500${item.poster_path}` : undefined,
          regions: [REGION],
        });
        found++;
      }

      if (page >= (data.total_pages ?? 1)) break;
    }
  }
  perLanguage.push({ ...lang, found });
  if (VERBOSE) console.log(`  ${lang.name.padEnd(10)} ${found} title(s)`);
}

// --- which platform actually has each one -----------------------------------

/**
 * discover can filter *by* provider but never says which one matched, so each
 * title still costs one call to find out. Rows whose provider lookup comes back
 * empty are dropped rather than shipped: a catalogue entry that cannot say
 * where to watch it fails at the one job this site has.
 */
const rows = [];
let noProvider = 0;
for (const row of byId.values()) {
  if (Date.now() - startedAt > BUDGET_MS) {
    stopped = stopped ?? `ran out of its ${Math.round(BUDGET_MS / 60_000)}-minute budget`;
    break;
  }
  const platforms = await providersFor(row.kind === 'film', Number(row.id.slice(2)));
  if (!platforms.length) {
    noProvider++;
    continue;
  }
  rows.push({ ...row, platforms });
}

// --- genre names ------------------------------------------------------------

/** Ids are meaningless to every consumer downstream, and the two genre lists
 *  are two calls rather than one per title. */
const genreName = new Map();
for (const isMovie of [true, false]) {
  try {
    const { genres } = await tmdb(`/genre/${isMovie ? 'movie' : 'tv'}/list`);
    for (const g of genres ?? []) genreName.set(g.id, g.name);
  } catch {
    /* Names are a nicety; ids still round-trip. */
  }
}
for (const row of rows) {
  row.genres = row.genreIds.map((id) => genreName.get(id)).filter(Boolean);
  delete row.genreIds;
}

rows.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0) || (b.votes ?? 0) - (a.votes ?? 0));

await mkdir(dirname(OUT), { recursive: true });
await writeFile(
  OUT,
  `${JSON.stringify({ generatedAt: new Date().toISOString(), region: REGION, source: 'tmdb', titles: rows }, null, 0)}\n`,
);

// --- what came back ---------------------------------------------------------

console.log(`\ncatalogue: ${rows.length} titles streaming in ${REGION}`);
for (const l of perLanguage) {
  const kept = rows.filter((r) => r.languages.includes(l.code));
  const votes = kept.map((r) => r.votes).sort((a, b) => a - b);
  const median = votes.length ? votes[Math.floor(votes.length / 2)] : 0;
  console.log(
    `  ${l.name.padEnd(10)} ${String(kept.length).padStart(4)} kept  ` +
      `(floor ${l.minVotes}, median ${median} votes, ` +
      `top ${kept[0]?.rating ?? '-'})`,
  );
}
if (noProvider) console.log(`  ${noProvider} dropped — no India provider on the detail call`);
if (stopped) console.log(`\n  Stopped early: ${stopped}. Kept what was gathered.`);
console.log(`  ${callCount()} API calls.\n`);
