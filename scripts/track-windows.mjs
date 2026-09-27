#!/usr/bin/env node
/**
 * How long a film actually takes to get from a cinema to a streaming service
 * in India — recorded, one observation at a time.
 *
 * "When will this come to OTT?" is the highest-intent question in this whole
 * category and the one every competitor fudges. Binged prints the word
 * "expected" beside a rumour. Nobody publishes a measured answer, because
 * measuring it requires having watched the same films every day for months,
 * which is exactly what this site's refresh already does and then throws away.
 *
 * The transition is visible in the feed: a film has a cinema row, and later a
 * second row with the same TMDB id and an `~ott` suffix carrying a streaming
 * date. Both sit in the feed at once, in different weeks — so the gap is
 * computable. What was missing is that nobody wrote it down. The feed holds
 * about eleven weeks, so every observation silently ages out, and the record
 * only survived by accident in the git history of releases.json.
 *
 * ---------------------------------------------------------------------------
 * Only what a provider confirmed
 *
 * This is the whole difference between a dataset and a pile of guesses.
 *
 * A `~ott` row's platform comes either from a TMDB watch provider — which is
 * TMDB reporting actual availability — or from something weaker: free text a
 * contributor typed onto a release date, or an inference from the production
 * company. Those carry `namedBy`, and yesterday they were found putting a
 * ZEE5 badge on a film that is not on ZEE5.
 *
 * For a *window* they are worse than useless, because they are not even
 * randomly wrong. Of the first nine transitions visible in the history, three
 * of the four guessed ones sat at exactly 28 days — which is not four films
 * behaving identically, it is contributors typing "four weeks". Averaging
 * that in would produce a median that measures a convention and reports it as
 * a fact about Indian distribution.
 *
 * So: provider-confirmed only. It makes the sample smaller and it makes it
 * real, and a small honest sample can be published with its own sample size
 * beside it. A large contaminated one cannot be published at all.
 *
 * ---------------------------------------------------------------------------
 * What this does NOT do
 *
 * It does not predict, and it writes nothing a reader sees. At the time of
 * writing there are five confirmed observations over twenty-four days, and a
 * per-language median off that — Malayalam n=1 — would be fabrication with a
 * decimal point. The forecast ships when the sample supports it; see
 * `summarise()` for the thresholds and scripts/eval.mjs for the gate that
 * stops a thin one reaching a page.
 *
 * This is the part that compounds. Every day it runs, the record deepens and
 * a competitor starting later is that much further behind.
 *
 * Usage: node scripts/track-windows.mjs            (append today's sightings)
 *        node scripts/track-windows.mjs --backfill (mine the git history too)
 *        node scripts/track-windows.mjs --report   (what we have, no writes)
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FEED = resolve(ROOT, 'public/data/releases.json');
/** In data/ rather than public/: this is a record we keep, not a file the
 *  browser downloads. What a reader sees is derived from it at build time. */
const STORE = resolve(ROOT, 'data/windows.json');

const args = process.argv.slice(2);
const BACKFILL = args.includes('--backfill');
const REPORT_ONLY = args.includes('--report');
const TODAY = new Date().toISOString().slice(0, 10);

const DAY = 86_400_000;
/** Beyond a year the two dates are not the same release event — a re-issue,
 *  a sequel sharing an id, or a data error. Below one day they are the same
 *  day-and-date drop, which is a different phenomenon and not a window. */
const MIN_DAYS = 1;
const MAX_DAYS = 365;

/**
 * Every confirmed cinema→OTT pair in one snapshot of the feed.
 *
 * Returns the base TMDB id against the observation, so the caller can
 * deduplicate across snapshots: the same film is visible for weeks and must
 * be counted once.
 */
export function sightings(feed) {
  const rows = (feed?.weeks ?? []).flatMap((w) => w.releases ?? []);
  const byBase = new Map();
  for (const r of rows) {
    const base = String(r.id).replace(/~ott$/, '');
    if (!byBase.has(base)) byBase.set(base, {});
    const slot = byBase.get(base);
    if (String(r.id).endsWith('~ott')) slot.ott = r;
    else slot.cinema = r;
  }

  const out = [];
  for (const [base, { cinema, ott }] of byBase) {
    if (!cinema || !ott) continue;
    if (!(cinema.platforms ?? []).includes('theatres')) continue;
    /* India only. A window is a fact about a distribution market, and mixing
       a US digital date into an Indian median measures neither. */
    if (!(cinema.regions ?? []).includes('IN')) continue;
    /* The rule this file exists for — see the header. */
    if (ott.namedBy) continue;
    /* A platform the registry could not name is a date without a service.
       The gap may be real but there is nothing to attribute it to, and a
       per-platform median is most of the value. */
    const platform = (ott.platforms ?? []).find((p) => p && p !== 'theatres' && p !== 'ott');
    if (!platform) continue;

    const days = Math.round((Date.parse(ott.releaseDate) - Date.parse(cinema.releaseDate)) / DAY);
    if (!(days >= MIN_DAYS && days <= MAX_DAYS)) continue;

    out.push({
      id: base,
      title: cinema.title,
      language: (cinema.languages ?? [])[0] ?? null,
      cinemaDate: cinema.releaseDate,
      ottDate: ott.releaseDate,
      platform,
      days,
    });
  }
  return out;
}

/**
 * What the record supports saying, and where it stops.
 *
 * Thresholds rather than a single number, because the honest answer changes
 * shape with the sample. Under five observations a median is an anecdote; the
 * caller is expected to print nothing. Between five and eleven it is worth a
 * range rather than a point. Past twelve a median with its own n beside it is
 * a defensible claim.
 *
 * Nothing here rounds a sample up into confidence it has not earned, and the
 * counts travel with every figure so a page can never quote one without the
 * other.
 */
export function summarise(observations) {
  const cut = (list) => {
    const d = list.map((o) => o.days).sort((a, b) => a - b);
    if (!d.length) return null;
    const at = (q) => d[Math.min(d.length - 1, Math.floor(d.length * q))];
    return {
      n: d.length,
      median: at(0.5),
      p25: at(0.25),
      p75: at(0.75),
      min: d[0],
      max: d[d.length - 1],
      /* What a page is allowed to do with it. */
      confidence: d.length >= 12 ? 'median' : d.length >= 5 ? 'range' : 'none',
    };
  };

  const group = (key) => {
    const buckets = new Map();
    for (const o of observations) {
      const k = o[key];
      if (!k) continue;
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k).push(o);
    }
    return Object.fromEntries([...buckets].map(([k, v]) => [k, cut(v)]));
  };

  return {
    overall: cut(observations),
    byLanguage: group('language'),
    byPlatform: group('platform'),
  };
}

/** Snapshots of the feed from git, oldest last. The refresh commits daily, so
 *  this is the only surviving record of weeks that have rolled out of the
 *  window — worth mining once, and never again after that. */
function history() {
  const shas = execSync('git log --format=%H -- public/data/releases.json', {
    encoding: 'utf8',
    cwd: ROOT,
  })
    .trim()
    .split('\n')
    .filter(Boolean);
  const out = [];
  for (const sha of shas) {
    try {
      out.push(
        JSON.parse(
          execSync(`git show ${sha}:public/data/releases.json`, {
            encoding: 'utf8',
            cwd: ROOT,
            maxBuffer: 1 << 28,
          }),
        ),
      );
    } catch {
      /* A commit where the file did not parse or did not exist yet. */
    }
  }
  return out;
}

const store = await readFile(STORE, 'utf8')
  .then(JSON.parse)
  .catch(() => ({ observations: [] }));

const known = new Map(store.observations.map((o) => [o.id, o]));
let added = 0;

const feeds = BACKFILL ? history() : [];
try {
  feeds.push(JSON.parse(await readFile(FEED, 'utf8')));
} catch {
  console.error(`No feed at ${FEED} — run the refresh first.`);
  process.exit(2);
}

for (const feed of feeds) {
  for (const s of sightings(feed)) {
    if (known.has(s.id)) continue;
    /* firstRecorded, not "when it happened": the transition happened on
       ottDate, and this is the day we noticed. Kept apart so a gap in the
       refresh is visible rather than being smoothed into the data. */
    known.set(s.id, { ...s, firstRecorded: TODAY });
    added += 1;
  }
}

const observations = [...known.values()].sort((a, b) => a.ottDate.localeCompare(b.ottDate));
const stats = summarise(observations);

console.log(`\nCinema → OTT, India, provider-confirmed only`);
console.log(`  ${observations.length} observations${added ? ` (+${added} new)` : ''}`);
if (stats.overall) {
  const o = stats.overall;
  console.log(`  overall: median ${o.median}d, ${o.p25}–${o.p75} typical, range ${o.min}–${o.max}`);
  console.log(`  publishable: ${o.confidence}`);
}
for (const [lang, s] of Object.entries(stats.byLanguage).sort((a, b) => b[1].n - a[1].n)) {
  console.log(`    ${lang}  n=${String(s.n).padStart(2)}  median ${String(s.median).padStart(3)}d  (${s.confidence})`);
}

if (REPORT_ONLY) process.exit(0);

await mkdir(dirname(STORE), { recursive: true });
await writeFile(
  STORE,
  `${JSON.stringify({ updatedAt: new Date().toISOString(), observations }, null, 2)}\n`,
);
console.log(`\nWrote ${observations.length} to data/windows.json\n`);
