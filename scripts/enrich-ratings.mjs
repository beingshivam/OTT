#!/usr/bin/env node
/**
 * IMDb scores, from OMDb, onto the rows that have an IMDb id.
 *
 * TMDB's own score is what the board has always shown, and on a release
 * calendar it is mostly absent: a calendar contains nothing but brand-new
 * titles, and a brand-new title has not been voted on. Of 183 India rows, 39
 * carried any score at all and 13 had enough votes to be worth quoting. That
 * is not a display problem, it is the reason a whole class of page cannot
 * exist here — "best on Netflix India" and everything shaped like it needs a
 * score you can rank by.
 *
 * IMDb has the votes, OMDb serves them, and the free tier is 1,000 calls a day
 * against a feed of a few hundred rows refreshed twice a week.
 *
 * Looked up by IMDb id, never by title. Matching a name and a year would be a
 * guess, and the failure mode is silent: a Malayalam thriller wearing the
 * rating of an unrelated American film with a similar name, displayed with
 * total confidence. The id comes from TMDB during the enrichment pass before
 * this one; a row without one is skipped rather than guessed at.
 *
 * Never fatal to the calendar. A missing key, a spent quota or an OMDb outage
 * leaves every existing score exactly where it was and exits cleanly, because
 * the calendar is the product and the scores are an improvement to it.
 *
 * Usage: node scripts/enrich-ratings.mjs [--verbose]   (reads .env)
 */

import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from './env.mjs';
import { Fatal, fetchTitle, scoreFrom } from './omdb.mjs';

loadEnv();

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FEED = resolve(ROOT, 'public/data/releases.json');
const VERBOSE = process.argv.includes('--verbose');

const KEY = process.env.OMDB_API_KEY;
if (!KEY) {
  console.error(
    'No OMDB_API_KEY found, so IMDb scores were not fetched.\n' +
      'Get a free key at https://www.omdbapi.com/apikey.aspx and put it in .env\n' +
      '(or add it as the OMDB_API_KEY repository secret for CI).\n' +
      'The calendar is untouched.',
  );
  process.exit(0);
}

let calls = 0;

const feed = JSON.parse(await readFile(FEED, 'utf8'));
const rows = feed.weeks.flatMap((w) => w.releases);
const targets = rows.filter((r) => r.imdbId);

console.log(
  `${targets.length} of ${rows.length} rows carry an IMDb id.` +
    (rows.length - targets.length
      ? ` ${rows.length - targets.length} have none and are skipped.`
      : ''),
);

let scored = 0;
let missing = 0;
let stopped = null;

for (const release of targets) {
  try {
    calls++;
    const score = scoreFrom(await fetchTitle(release.imdbId, KEY));
    if (score) {
      release.imdbRating = score.rating;
      release.imdbVotes = score.votes;
      scored++;
      if (VERBOSE) {
        console.log(`  ✓ ${release.title} — ${score.rating} (${score.votes.toLocaleString()} votes)`);
      }
    } else {
      missing++;
      if (VERBOSE) console.log(`  – ${release.title} — no usable score on IMDb yet`);
    }
  } catch (e) {
    if (e instanceof Fatal) {
      stopped = e.message;
      break;
    }
    missing++;
  }
}

/**
 * Written even after a fatal stop, because the scores fetched before it are
 * real and throwing them away would mean the next run starts from nothing
 * again — which, against a daily quota, is how a feed never gets scored at all.
 */
feed.ratedAt = new Date().toISOString();
await writeFile(FEED, `${JSON.stringify(feed, null, 2)}\n`);

if (stopped) {
  console.log(`\nStopped early: ${stopped}`);
  console.log(`Kept the ${scored} score(s) fetched before that. ${calls} API calls.`);
} else {
  console.log(`\nScored ${scored} title(s); ${missing} have no usable IMDb score. ${calls} API calls.`);
}
