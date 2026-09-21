#!/usr/bin/env node
/**
 * The part of the calendar that does not roll off.
 *
 * The feed is a window — three weeks back, four ahead — rebuilt from scratch on
 * every refresh. That is right for the board, which answers "what is new", and
 * it quietly destroyed everything the site published. A film opened, got a
 * page, and about three weeks later its week fell off the back of the window,
 * the build stopped generating the page, and the URL died. The app even had
 * copy for it: "We don't have that title any more."
 *
 * Pages that delete themselves cannot rank. Search rewards a URL that has been
 * answering the same question for a year, and every page here was on a
 * three-week fuse — which is the whole gap between this site and the
 * established ones, far more than anything about their structure.
 *
 * So this keeps a permanent record beside the window. Every title the feed has
 * ever carried stays here with its metadata, and the build generates title
 * pages from the archive rather than from the window. Nothing is ever removed.
 *
 * Two properties it has to have, and both are about not losing data:
 *
 *   additive     a title is never deleted, whatever the feed says today. The
 *                feed forgetting something is the normal case, not a signal.
 *   non-clobbering
 *                a field that is missing from this run does not overwrite a
 *                good value from the last one. Enrichment is allowed to fail —
 *                the workflow marks it continue-on-error — and a failed run
 *                must not strip every synopsis and cast list in the archive.
 *
 * It updates in place otherwise, which is the point: when a theatrical film
 * gains a streaming platform, that row changes here, and its page flips from
 * "not announced" to "streaming now on X" on the next build.
 *
 * Not in public/. The browser never fetches this — the build reads it and
 * embeds what each page needs into that page — so shipping it would be a
 * growing download nobody asks for.
 *
 * Usage: node scripts/archive.mjs   (runs as part of `npm run refresh`)
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FEED = resolve(ROOT, 'public/data/releases.json');
const ARCHIVE = resolve(ROOT, 'data/archive.json');

const TODAY = new Date().toISOString().slice(0, 10);

const feed = JSON.parse(await readFile(FEED, 'utf8'));

/** Missing file is the first run, not an error. */
const previous = await readFile(ARCHIVE, 'utf8')
  .then((s) => JSON.parse(s))
  .catch(() => ({ titles: [] }));

const byId = new Map(previous.titles.map((t) => [t.id, t]));
const before = byId.size;

/**
 * Only the keys this run actually has a value for.
 *
 * A plain spread would copy `synopsis: undefined` over a good synopsis, because
 * spreading copies keys that exist regardless of what they hold. That is the
 * exact shape of the bug that would empty the archive the first time TMDB
 * dropped connections mid-enrichment.
 */
const defined = (row) =>
  Object.fromEntries(Object.entries(row).filter(([, v]) => v !== undefined && v !== null));

/**
 * The fields a change to which is worth telling a crawler about.
 *
 * This list is what drives <lastmod> in the sitemap, so what it leaves out
 * matters more than what it includes. `heat`, `popularity`, `votes` and
 * `rating` are all live TMDB numbers that drift every single run — include
 * them and every one of the 354 URLs claims to have changed today, every day,
 * which is precisely the sitemap Google learns to ignore. A film's score
 * moving 6.8 to 6.9 is not a reason to recrawl its page.
 *
 * `lastSeen` and `weekId` are bookkeeping. Everything else here is something a
 * reader would see: the platform it landed on, the date it moved to, the
 * synopsis that arrived with enrichment, the poster that replaced a gradient.
 */
const SIGNIFICANT = [
  'title',
  'slug',
  'kind',
  'releaseDate',
  'platforms',
  'languages',
  'genres',
  'certification',
  'runtimeMinutes',
  'synopsis',
  'cast',
  'director',
  'posterUrl',
  'backdropUrl',
  'trailerUrl',
];
const signature = (row) => JSON.stringify(SIGNIFICANT.map((k) => row[k] ?? null));

let added = 0;
let updated = 0;
let restamped = 0;

for (const week of feed.weeks) {
  for (const row of week.releases) {
    const existing = byId.get(row.id);
    const merged = {
      ...(existing ?? {}),
      ...defined(row),
      weekId: week.id,
      firstSeen: existing?.firstSeen ?? TODAY,
      lastSeen: TODAY,
    };
    /*
     * When this row last said something new, which is what <lastmod> means.
     *
     * Not when it was last written: every row is rewritten on every run, and a
     * sitemap where all 354 URLs changed today is a sitemap a crawler stops
     * believing. Google's own guidance is that lastmod should reflect a
     * significant change, so this compares only the fields above and otherwise
     * carries the old date forward untouched.
     *
     * A row with no changedAt yet is one written before this existed, not one
     * that changed today — it inherits firstSeen, which is the last honest
     * thing known about it.
     */
    const moved = !existing || signature(existing) !== signature(merged);
    merged.changedAt = moved ? TODAY : (existing.changedAt ?? existing.firstSeen ?? TODAY);
    if (moved && existing) restamped++;
    if (existing) {
      // Compared before writing so the counts describe real changes rather than
      // "every row, every run" — a diff of 300 touched rows twice a week is a
      // diff nobody reads.
      if (JSON.stringify({ ...existing, lastSeen: TODAY }) !== JSON.stringify(merged)) updated++;
    } else {
      added++;
    }
    byId.set(row.id, merged);
  }
}

/*
 * And the rows this run never saw.
 *
 * The feed is a rolling window, so most of the archive is not in it — 190 of
 * 695 on the day this was written. The loop above only reaches rows the feed
 * still carries, which left every older title without a changedAt, and a page
 * with no date falls back to the build's own. That is the defect this whole
 * change exists to remove, reappearing on exactly the pages it matters most
 * for: the ones that have been answering the same question for months and
 * genuinely have not moved.
 *
 * A row the feed has dropped is frozen — nothing can change it until it comes
 * back — so the last day it was seen is the last day it could have changed.
 * Written once and then carried, so this is a backfill that runs dry.
 */
let backfilled = 0;
for (const row of byId.values()) {
  if (row.changedAt) continue;
  row.changedAt = row.lastSeen ?? row.firstSeen ?? TODAY;
  backfilled++;
}

/**
 * Newest first, which is both the useful order to read and a stable one to
 * diff: a refresh appends at the top instead of reshuffling the file.
 */
const titles = [...byId.values()].sort(
  (a, b) => b.releaseDate.localeCompare(a.releaseDate) || a.id.localeCompare(b.id),
);

await mkdir(dirname(ARCHIVE), { recursive: true });
await writeFile(
  ARCHIVE,
  `${JSON.stringify({ updatedAt: new Date().toISOString(), titles }, null, 0)}\n`,
);

const withPages = titles.filter(
  (t) => t.platforms?.includes('theatres') && t.synopsis && t.cast?.length,
).length;

console.log(
  `archive: ${titles.length} titles (${before} before, +${added} new, ${updated} updated)\n` +
    `         ${restamped} changed something a reader would see, and moved their lastmod\n` +
    (backfilled ? `         ${backfilled} older rows dated from when the feed last carried them\n` : '') +
    `         ${withPages} carry enough metadata for a title page`,
);
