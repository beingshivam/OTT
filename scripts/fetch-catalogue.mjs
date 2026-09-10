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
import { baselineFor, weekStart } from './rank-movement.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/**
 * In public/, unlike the archive, because the browser actually reads this one:
 * the "Now streaming" lens is a different set of titles, not a filter over the
 * calendar, so the app has to fetch it. It is loaded on demand rather than up
 * front — a reader who only ever wants this week should never pay for it.
 */
const OUT = resolve(ROOT, 'public/data/catalogue.json');
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

/**
 * The same query, ordered by attention rather than by score.
 *
 * "What is everyone watching" is a different question from "what is good", and
 * the first attempt at answering it was wrong in an instructive way: it sorted
 * the *rating-selected* sample by popularity and concluded the signal was
 * useless because the result was American television. Of course it was — that
 * sample was chosen for having the highest scores, and TMDB scores are highest
 * where its voting population is densest.
 *
 * Asking TMDB for popular titles per language is a different query, and it is
 * the same correction that made the rating lists work: a language is only ever
 * ranked against itself, so the fact that TMDB's audience is not Indian stops
 * mattering. The most popular Malayalam titles on Indian streaming are a real
 * answer even if far fewer people voted on them than on Stranger Things.
 *
 * The vote floor drops to a fifth of the rating pass's. Trust in a *score*
 * needs votes; presence on a popularity list does not, and holding it high
 * would filter out exactly the recent titles a trending list exists to surface.
 */
async function discoverPopular(isMovie, language, minVotes, page) {
  return tmdb(`/discover/${isMovie ? 'movie' : 'tv'}`, {
    watch_region: REGION,
    with_watch_providers: ALL_PROVIDERS,
    with_watch_monetization_types: 'flatrate',
    with_original_language: language,
    sort_by: 'popularity.desc',
    'vote_count.gte': Math.max(10, Math.round(minVotes / 5)),
    include_adult: false,
    page,
  });
}

/**
 * Where it plays, and on what terms.
 *
 * This used to merge flatrate, free and ad-supported into one list, which made
 * a platform that only carries a title behind ads indistinguishable from one
 * carrying it on subscription. The discover query above asks for flatrate
 * specifically, so the two halves of this pipeline were making different
 * claims about the same row — and the merged version is the more flattering
 * one, which is how a small dishonesty usually gets in.
 *
 * It matters here more than it would elsewhere: JioHotstar runs a large free
 * tier in India and came out as the most-carried platform in the catalogue,
 * ahead of both Prime and Netflix. That is a plausible reading of a merged list
 * and a suspicious one for a catalogue of well-rated titles.
 *
 * All three tiers are still kept, because all three mean "you can watch this
 * tonight without paying extra" and dropping the free ones would lose real
 * answers. What changes is that each platform now records which it is, so the
 * page can say so rather than implying subscription for all of them.
 */
async function detailFor(isMovie, id) {
  try {
    /**
     * One call, three answers.
     *
     * This asked /watch/providers directly and got back only providers, which
     * left every catalogue row without a runtime or a cast list — so search by
     * actor, which works perfectly on the calendar, found nothing across the
     * 648 titles people are most likely to search *for*. Tom Cruise returned a
     * single film.
     *
     * append_to_response bundles both onto the request this loop was already
     * making, so the fix costs nothing: same one call per title, same budget.
     * It is the same trick enrich-releases.mjs uses on the calendar side, and
     * the two pipelines now carry the same fields for the same reason.
     */
    const data = await tmdb(`/${isMovie ? 'movie' : 'tv'}/${id}`, {
      append_to_response: 'watch/providers,credits',
    });

    const runtime = isMovie ? data.runtime : data.episode_run_time?.[0];
    const detail = {
      runtimeMinutes: runtime || undefined,
      // Five, matching the calendar — enough for the names a search would use,
      // short enough that 648 rows do not double the file everyone downloads.
      cast: data.credits?.cast?.slice(0, 5).map((c) => c.name) ?? [],
    };

    /**
     * The appended block is keyed by its path, slash and all: data['watch/
     * providers']. If that key were ever to move, every row would come back
     * with no platforms and be dropped as unavailable — 648 titles quietly
     * becoming zero, reported as "no provider" rather than as the shape error
     * it is. So the two cases are told apart: a missing block is a bug and
     * throws, while a block that simply has no entry for India is an ordinary
     * answer and returns empty.
     */
    const block = data['watch/providers'];
    if (!block) throw new Error(`no watch/providers block on ${isMovie ? 'movie' : 'tv'}/${id}`);
    const scoped = block.results?.[REGION];
    if (!scoped) return { platforms: [], tiers: {}, ...detail };

    const tiers = {};
    // Best terms win where a platform appears under more than one heading:
    // included beats free-with-ads beats ads.
    for (const [tier, list] of [
      ['ads', scoped.ads],
      ['free', scoped.free],
      ['flatrate', scoped.flatrate],
    ]) {
      for (const p of list ?? []) {
        const id = platformByProvider.get(p.provider_id);
        if (id) tiers[id] = tier;
      }
    }
    return { platforms: Object.keys(tiers), tiers, ...detail };
  } catch {
    return { platforms: [], tiers: {} };
  }
}

/**
 * Where each title stood before, so the next run can say what moved.
 *
 * Read before anything is written, because this file is about to be replaced.
 * A rank on its own says what is popular; a rank beside an earlier one says
 * what is *rising*, which is the more interesting claim and the one nobody else
 * in this space makes.
 *
 * Two different earlier ranks, because they answer two different questions and
 * conflating them is how the interesting claim becomes a false one:
 *
 *   prevPopRank  where it stood on the *previous run*. Runs are Friday,
 *                Saturday and Monday, so this spans 26 hours, two days or four
 *                depending on which one you catch. Useful for checking the
 *                pipeline; useless as a sentence, because "up 14 places" would
 *                silently mean a different window on Saturday than on Friday.
 *
 *   baseRank     where it stood when the current release week opened, carried
 *                across every run inside that week. This is the one a reader
 *                can be shown, because "this week" then means the same seven
 *                days the rest of the site means by it.
 *
 * The distinction is not hypothetical. The first two catalogue runs to carry a
 * baseline landed 27 minutes apart, and all 380 ranked titles came back with
 * prevPopRank exactly equal to popRank — zero movement across the board. A
 * "trending" label on that data would have been 380 flat arrows.
 *
 * Carried here rather than computed later because the data has to exist before
 * the feature can: this file is regenerated wholesale on every refresh, so a
 * run that does not preserve these destroys the only baseline the next
 * comparison could have used. A missing file, or a title new to the list,
 * leaves both unset — absent is not the same as "climbed from the bottom", and
 * the display must never render it as one.
 */
const previousRank = new Map();
/** id → { rank, week } from the last run, where `week` is the Friday that
 *  opened the release week that baseline belongs to. */
const priorBaseline = new Map();
/** How many titles the last run shipped, as the sanity check further down needs
 *  the whole count and previousRank holds only the ranked ones. */
let keptBefore = 0;
try {
  const prior = JSON.parse(await readFile(OUT, 'utf8'));
  keptBefore = (prior.titles ?? []).length;
  for (const t of prior.titles ?? []) {
    if (t.popRank != null) previousRank.set(t.id, t.popRank);
    if (t.baseRank != null && t.baseWeek) {
      priorBaseline.set(t.id, { rank: t.baseRank, week: t.baseWeek });
    }
  }
} catch {
  /* No catalogue yet. */
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

// --- a second pass, ordered by attention ------------------------------------

/**
 * Rows already found keep their place and simply gain a rank; rows seen only
 * here are added. `popRank` is the position within its own language, which is
 * what makes a trending view fair to interleave: rank 1 in Malayalam and rank 1
 * in Hindi are the same claim about different audiences, where raw popularity
 * numbers are not comparable at all.
 */
const POP_PAGES = 2;
if (!stopped) {
  for (const lang of LANGUAGES) {
    let rank = 0;
    for (let page = 1; page <= POP_PAGES && !stopped; page++) {
      if (Date.now() - startedAt > BUDGET_MS) {
        stopped = `ran out of its ${Math.round(BUDGET_MS / 60_000)}-minute budget`;
        break;
      }
      for (const isMovie of [true, false]) {
        let data;
        try {
          data = await discoverPopular(isMovie, lang.code, lang.minVotes, page);
        } catch {
          continue;
        }
        for (const item of data.results ?? []) {
          const id = `${isMovie ? 'm' : 't'}-${item.id}`;
          const date = isMovie ? item.release_date : item.first_air_date;
          const title = isMovie ? item.title : item.name;
          if (!title || !date) continue;
          rank += 1;
          const existing = byId.get(id);
          if (existing) {
            existing.popRank = Math.min(existing.popRank ?? Infinity, rank);
            continue;
          }
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
            popRank: rank,
            genreIds: item.genre_ids ?? [],
            synopsis: item.overview || undefined,
            posterUrl: item.poster_path ? `${IMG}/w500${item.poster_path}` : undefined,
            regions: [REGION],
          });
        }
      }
    }
    if (VERBOSE) console.log(`  ${lang.name.padEnd(10)} popularity pass done`);
  }
}

// --- which platform actually has each one -----------------------------------

/**
 * discover can filter *by* provider but never says which one matched, so each
 * title still costs one call to find out. That call now carries the runtime and
 * the cast back with it — see detailFor. Rows whose provider lookup comes back
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
  const { platforms, tiers, runtimeMinutes, cast } = await detailFor(
    row.kind === 'film',
    Number(row.id.slice(2)),
  );
  if (!platforms.length) {
    noProvider++;
    continue;
  }
  // Only when there is something to say: an undefined runtime and an empty cast
  // are absent fields, not empty ones, and shipping `"cast":[]` on 648 rows
  // would add weight to say nothing.
  rows.push({
    ...row,
    platforms,
    tiers,
    ...(runtimeMinutes ? { runtimeMinutes } : {}),
    ...(cast?.length ? { cast } : {}),
  });
}

/**
 * A run that kept almost nothing is a broken run, not an empty catalogue.
 *
 * detailFor swallows a failed lookup per title, which is right for a flaky
 * connection and wrong for a change in the response shape: both come out as
 * "no provider", and the second arrives as a collapse to near-zero that the
 * summary below would report as a tidy count of drops.
 *
 * Measured against the last run rather than against how many titles discover
 * offered, because the share that survives the provider check is a property of
 * TMDB's India coverage and drifts; what does not drift is that a catalogue
 * holding hundreds yesterday does not hold twenty today. A run cut short by the
 * budget is exempt — a partial result is what that is *supposed* to produce.
 *
 * Throwing leaves the previous catalogue.json untouched, which is the outcome
 * to want: yesterday's data beats a page saying nothing is streaming.
 */
if (!stopped && keptBefore >= 100 && rows.length < keptBefore / 4) {
  throw new Error(
    `catalogue: kept ${rows.length} titles where the last run kept ${keptBefore} ` +
      `(${noProvider} had no India provider). That is a pipeline failure, not a result — ` +
      `leaving the previous catalogue in place.`,
  );
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

/** Only where both ends exist: a title new to the list has not "risen", and
 *  saying it climbed from nowhere would invent movement that never happened. */
/* The week boundary and the baseline rule live in rank-movement.mjs, where
   they can be tested — this script needs a token and a network on import, so
   nothing inside it can be. See that file for why the baseline is weekly. */
const thisWeek = weekStart(new Date());

let moved = 0;
let movedThisWeek = 0;
for (const row of rows) {
  const before = previousRank.get(row.id);
  if (before != null && row.popRank != null) {
    row.prevPopRank = before;
    if (before !== row.popRank) moved++;
  }

  if (row.popRank == null) continue;
  const base = baselineFor(priorBaseline.get(row.id), before, thisWeek);
  if (base) Object.assign(row, base);

  if (row.baseRank != null && row.baseRank !== row.popRank) movedThisWeek++;
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
if (previousRank.size) {
  const risers = rows
    .filter((r) => r.prevPopRank != null && r.prevPopRank > r.popRank)
    .sort((a, b) => b.prevPopRank - b.popRank - (a.prevPopRank - a.popRank))
    .slice(0, 5);
  const weekRisers = rows
    .filter((r) => r.baseRank != null && r.baseRank > r.popRank)
    .sort((a, b) => b.baseRank - b.popRank - (a.baseRank - a.popRank))
    .slice(0, 5);
  console.log(
    `\n  ${moved} title(s) changed rank since the last run` +
      (risers.length
        ? `; biggest climbs: ` +
          risers.map((r) => `${r.title} +${r.prevPopRank - r.popRank}`).join(', ')
        : ''),
  );
  /* The number to judge a "trending this week" label on — the other one spans
     whatever gap happened to fall between two runs. */
  console.log(
    `  ${movedThisWeek} title(s) changed rank since ${thisWeek}, the start of this week` +
      (weekRisers.length
        ? `; biggest climbs: ` +
          weekRisers.map((r) => `${r.title} +${r.baseRank - r.popRank}`).join(', ')
        : ''),
  );
} else {
  console.log('\n  no previous ranks on disk — this run becomes the baseline for the next.');
}

console.log('\n  most popular, per language (the trending candidate):');
for (const l of perLanguage) {
  const top = rows
    .filter((r) => r.languages.includes(l.code) && r.popRank)
    .sort((a, b) => a.popRank - b.popRank)
    .slice(0, 5);
  if (!top.length) continue;
  console.log(`    ${l.name}: ` + top.map((r) => `${r.title} (${r.year})`).join(' · '));
}
/** How much of the catalogue is actually subscription-included, which is what
 *  the discover query asked for and what the page implies. */
const tierCount = {};
for (const r of rows) for (const t of Object.values(r.tiers ?? {})) tierCount[t] = (tierCount[t] ?? 0) + 1;
console.log('\n  platform listings by tier: ' +
  Object.entries(tierCount).map(([t, n]) => `${t} ${n}`).join(' · '));
if (noProvider) console.log(`  ${noProvider} dropped — no India provider on the detail call`);
if (stopped) console.log(`\n  Stopped early: ${stopped}. Kept what was gathered.`);
console.log(`  ${callCount()} API calls.\n`);
