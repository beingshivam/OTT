#!/usr/bin/env node
/**
 * Which knob is actually holding a language down?
 *
 * The site publishes a page per language and the South Indian ones are thin:
 * Tamil 113 titles, Telugu 63, Malayalam 58, Kannada 37, against Japanese 175
 * and Korean 128. For an Indian OTT site that is backwards, and it is the kind
 * of gap that decides whether a search for a Telugu film finds this site or
 * somebody else's.
 *
 * The last attempt at explaining it was wrong, which is why this script
 * exists. The theory was that the registry's provider list was the ceiling —
 * a title streaming only on a service the registry never heard of is
 * invisible to discover. That theory was testable and got tested: eleven
 * platforms were added, the registry went from 12 Indian services to 23, and
 * the refresh moved Tamil by one title and Telugu by none. It was a real bug
 * and it fixed a real mislabelling, but it was not this one.
 *
 * So rather than pick the next likely cause, measure all of them. The fetch's
 * discover query has exactly four knobs that could be excluding titles, and
 * each one can be loosened on its own and the total_results read back:
 *
 *   as it runs   flatrate only, the language's vote floor, registry providers
 *   + tiers      free and ad-supported admitted too
 *   + votes      the vote floor removed
 *   + providers  any Indian provider, not just the registry's
 *
 * Each row also reports what the fetch could take even if the count were
 * unlimited, because a ceiling in the query and a ceiling in the page loop
 * look identical from the outside and have opposite fixes.
 *
 * Read-only. It prints, and changes nothing.
 *
 * Usage: TMDB_TOKEN=... node scripts/language-probe.mjs
 */

import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { callCount, requireToken, tmdb } from './tmdb.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REGION = 'IN';

requireToken();

/* The same registry read the fetch does, so this measures the list that is
   actually in force rather than a copy of it that can drift. */
const registry = await readFile(resolve(ROOT, 'src/data/platforms.ts'), 'utf8');
const REGISTRY_IDS = [
  ...new Set(
    [
      ...registry.matchAll(
        /\{\s*id:\s*'([^']+)',[\s\S]*?tmdb:\s*\[([^\]]*)\][\s\S]*?regions:\s*\[([^\]]*)\]/g,
      ),
    ]
      .filter(([, , , regions]) => regions.includes(`'${REGION}'`))
      .flatMap(([, , ids]) => ids.split(',').map((n) => Number(n.trim())).filter(Boolean)),
  ),
];

/* Every provider the region has, for the fourth row. Asked once. */
const regionProviders = async (kind) => {
  const body = await tmdb(`/watch/providers/${kind}`, { watch_region: REGION });
  return (body.results ?? [])
    .filter((p) => p.display_priorities?.[REGION] != null || p.display_priority != null)
    .map((p) => p.provider_id);
};

/** Same floors the fetch uses. Kept as a literal copy on purpose: if these
 *  drift apart the probe is measuring a query nobody runs. */
const LANGUAGES = [
  { code: 'ta', name: 'Tamil', minVotes: 60 },
  { code: 'te', name: 'Telugu', minVotes: 60 },
  { code: 'ml', name: 'Malayalam', minVotes: 60 },
  { code: 'kn', name: 'Kannada', minVotes: 40 },
  { code: 'hi', name: 'Hindi', minVotes: 200 },
  { code: 'bn', name: 'Bengali', minVotes: 40 },
  { code: 'mr', name: 'Marathi', minVotes: 40 },
  { code: 'pa', name: 'Punjabi', minVotes: 25 },
  /* Controls. If loosening a knob moves these as much as it moves Tamil, the
     knob is not the reason the Indian languages are behind. */
  { code: 'ja', name: 'Japanese', minVotes: 400 },
  { code: 'ko', name: 'Korean', minVotes: 400 },
];

/** What the fetch would keep even from an unlimited count: four pages of each
 *  kind on the rating pass. Hardcoded from fetch-catalogue's PAGES default. */
const PAGES = 4;

const count = async (kind, { language, minVotes, tiers, providers }) => {
  const body = await tmdb(`/discover/${kind}`, {
    watch_region: REGION,
    with_watch_providers: providers.join('|'),
    with_watch_monetization_types: tiers,
    with_original_language: language,
    sort_by: 'vote_average.desc',
    'vote_count.gte': minVotes,
    include_adult: false,
    page: 1,
  });
  return body.total_results ?? 0;
};

const pad = (s, n) => String(s).padEnd(n);
const num = (n, w = 7) => String(n).padStart(w);

const allMovie = await regionProviders('movie');
const allTv = await regionProviders('tv');

/*
 * Calibration mode: what floor would give this language a full page budget?
 *
 * The floors were absolute vote counts, and the probe showed what that costs:
 * 60 votes keeps 4.4% of Tamil's titles while 400 keeps 10% of Japanese's,
 * because TMDB's voting population is Western and a floor denominated in its
 * votes is a stricter filter on regional Indian cinema than on anime. Setting
 * them by hand again would just be a new guess, so this searches for them.
 *
 * The target is deliberately a little above what the fetch can take. The
 * rating pass sorts by score and keeps the first 160, so a language whose
 * query returns 250 candidates gets a full budget of its best-rated titles
 * and the page loop is what binds — which is the healthy state. A language
 * whose query returns 83 is choosing from too small a pool to be selective at
 * all, and lowering its floor further than that buys nothing but risk: the
 * pass ranks by vote_average, so the floor is the only thing standing between
 * the top of a language's page and a film with nine votes averaging 9.5.
 */
const TARGET = Number(process.env.TARGET ?? 250);

const calibrate = async (lang) => {
  const at = async (floor) => {
    const [movie, tv] = await Promise.all([
      count('movie', { language: lang.code, minVotes: floor, tiers: 'flatrate', providers: REGISTRY_IDS }),
      count('tv', { language: lang.code, minVotes: floor, tiers: 'flatrate', providers: REGISTRY_IDS }),
    ]);
    return movie + tv;
  };

  /* Monotonic: a higher floor can only return fewer titles. So bisect on the
     floor rather than sampling, and report the count that floor really gives
     rather than the target that was asked for. */
  let lo = 1;
  let hi = 4000;
  let best = { floor: lo, count: await at(lo) };
  if (best.count < TARGET) return { ...best, short: true };
  for (let i = 0; i < 11 && lo < hi; i += 1) {
    const mid = Math.floor((lo + hi) / 2);
    const got = await at(mid);
    if (got >= TARGET) {
      best = { floor: mid, count: got };
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return { ...best, short: false };
};

if (process.env.CALIBRATE) {
  console.log(`\nThe floor that leaves each language ${TARGET}+ candidates for a 160-title budget\n`);
  console.log(`  ${pad('language', 11)}${num('now')}${num('floor')}${num('gives')}`);
  for (const lang of LANGUAGES) {
    const r = await calibrate(lang);
    console.log(
      `  ${pad(lang.name, 11)}${num(lang.minVotes)}${num(r.short ? '—' : r.floor)}${num(r.count)}` +
        (r.short ? `   never reaches ${TARGET}, even at one vote` : ''),
    );
  }
  console.log(`\n  ${callCount()} TMDB calls.`);
  process.exit(0);
}

const rows = [];
for (const lang of LANGUAGES) {
  const variants = {
    asItRuns: { minVotes: lang.minVotes, tiers: 'flatrate', providers: REGISTRY_IDS },
    tiers: { minVotes: lang.minVotes, tiers: 'flatrate|free|ads', providers: REGISTRY_IDS },
    votes: { minVotes: 0, tiers: 'flatrate|free|ads', providers: REGISTRY_IDS },
    providers: { minVotes: 0, tiers: 'flatrate|free|ads', providers: null },
  };
  const out = { ...lang };
  for (const [name, spec] of Object.entries(variants)) {
    const movie = await count('movie', {
      language: lang.code,
      ...spec,
      providers: spec.providers ?? allMovie,
    });
    const tv = await count('tv', {
      language: lang.code,
      ...spec,
      providers: spec.providers ?? allTv,
    });
    out[name] = movie + tv;
  }
  rows.push(out);
  console.error(`  measured ${lang.name}`);
}


console.log(`\nWhat is holding each language down — ${REGION}, ${REGISTRY_IDS.length} registry providers`);
console.log(`(region has ${allMovie.length} film and ${allTv.length} television providers)\n`);
console.log(
  `  ${pad('language', 11)}${num('as runs')}${num('+tiers')}${num('+votes')}${num('+any')}   the fetch can take`,
);
for (const r of rows) {
  /* Four pages of twenty, per kind. What the query offers above that line is
     not reachable without changing the loop, so the two numbers have to be
     read together. */
  const ceiling = PAGES * 20 * 2;
  const bound =
    r.asItRuns >= ceiling ? 'page loop' : r.tiers > r.asItRuns * 1.5 ? 'the flatrate filter' : 'the query';
  console.log(
    `  ${pad(r.name, 11)}${num(r.asItRuns)}${num(r.tiers)}${num(r.votes)}${num(r.providers)}   ${num(ceiling, 4)}  ← ${bound}`,
  );
}

console.log(`\n  ${callCount()} TMDB calls.`);
console.log(
  '\n  Reading it: "as runs" is what the fetch asks for today. Each column to\n' +
    '  the right loosens one more knob and keeps the previous ones loosened, so\n' +
    '  the jump between two columns is that knob\'s cost. A language whose "as\n' +
    '  runs" figure already exceeds what the fetch can take is capped by the\n' +
    '  page loop and no amount of loosening the query will help it.',
);
