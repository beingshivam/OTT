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

/**
 * What changed, not just that something did.
 *
 * `changedAt` answers "when" for the sitemap. This answers "what" for a reader,
 * and the two are different jobs: nobody wants to know that a row was touched,
 * they want to know that a film they are waiting for got a date.
 *
 * Only what can honestly be detected from two consecutive archives. The
 * temptation is to report things the shape of news — "Coolie left cinemas
 * after six weeks" reads beautifully — and the feed cannot support it: a row
 * leaving the eight-week window is the window moving, not the film ending its
 * run, and there is no way here to tell those apart. So it is not reported.
 * Four kinds, each of which is a fact:
 *
 *   dated     a film with a cinema listing gained a streaming date, which is
 *             the single event this whole site exists to catch
 *   added     a title entered the calendar
 *   moved     an announced date changed, which in Indian cinema is common and
 *             is exactly what someone planning around it wants to know
 *   platform  a row gained a service it did not have
 */
const events = [];
const services = (r) => (r.platforms ?? []).filter((p) => p !== 'theatres');
const note = (kind, row, detail) =>
  events.push({
    at: TODAY,
    kind,
    id: row.id,
    title: row.title,
    ...(row.languages?.[0] ? { lang: row.languages[0] } : {}),
    ...detail,
  });

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

      if (existing.releaseDate !== merged.releaseDate) {
        note('moved', merged, { from: existing.releaseDate, to: merged.releaseDate });
      }
      const was = services(existing);
      const now = services(merged);
      const gained = now.filter((p) => !was.includes(p));
      if (gained.length) note('platform', merged, { platforms: gained, date: merged.releaseDate });
    } else {
      added++;
      /*
       * A `~ott` row appearing is the film getting its streaming date.
       *
       * It arrives as a new row rather than an edit to the cinema listing —
       * see the digital pass in fetch-releases.mjs — so the interesting event
       * looks like an addition unless you go and find the film it belongs to.
       * `afterDays` is the wait, which is the number the reader actually wants
       * and the same one the Wait Clock will be built on.
       */
      const base = String(row.id).endsWith('~ott') ? byId.get(String(row.id).replace(/~ott$/, '')) : null;
      if (base) {
        note('dated', { ...merged, title: base.title }, {
          platforms: services(merged),
          date: merged.releaseDate,
          ...(base.releaseDate
            ? { afterDays: Math.round((Date.parse(merged.releaseDate) - Date.parse(base.releaseDate)) / 86400000) }
            : {}),
        });
      } else if (!String(row.id).endsWith('~ott')) {
        note('added', merged, { platforms: merged.platforms ?? [], date: merged.releaseDate });
      }
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

/*
 * The change log, kept beside the archive and shipped to the browser.
 *
 * In public/ because the app renders /changes itself — a prerendered page the
 * app cannot also draw gets replaced by the homepage the moment React
 * hydrates, which is the one failure mode worth designing around here.
 *
 * Append-only within a window. Ninety days is the horizon: long enough that a
 * quiet fortnight does not empty the page, short enough that the file stays
 * small enough to ship on every visit. Older events are not archived
 * elsewhere, deliberately — this is a news feed, not a second archive, and the
 * archive already keeps the facts.
 *
 * Deduplicated on the whole event, because a day can run more than once: the
 * schedule fires daily and a manual dispatch on the same day would otherwise
 * report every morning's news twice.
 */
const CHANGES = resolve(ROOT, 'public/data/changes.json');
const KEEP_DAYS = 90;
const horizon = new Date(Date.now() - KEEP_DAYS * 86400000).toISOString().slice(0, 10);

const before_ = await readFile(CHANGES, 'utf8')
  .then((s) => JSON.parse(s).events ?? [])
  .catch(() => []);

const key = (e) => JSON.stringify([e.at, e.kind, e.id, e.from, e.to, (e.platforms ?? []).join()]);
const seenEvents = new Set(before_.map(key));
const fresh = events.filter((e) => !seenEvents.has(key(e)));

/*
 * A date that moves twice in a day moved once.
 *
 * The very first run of this produced "Matchbox the Movie moved to 8 Oct" and
 * "Matchbox the Movie moved to 9 Oct" on the same day, because the job ran
 * twice against feeds either side of a refresh. Both entries were true and
 * together they were noise — and a film whose date wobbles by a day is exactly
 * the kind that would do it repeatedly.
 *
 * So a title's moves within one day collapse to the net journey: the date it
 * started the day on, and the one it ended on. If those match it did not move
 * and nothing is reported at all.
 */
const collapsed = [];
const moves = new Map();
for (const e of [...before_, ...fresh].filter((e) => e.at >= horizon)) {
  if (e.kind !== 'moved') {
    collapsed.push(e);
    continue;
  }
  const k = `${e.at}|${e.id}`;
  const seen = moves.get(k);
  if (seen) seen.to = e.to;
  else moves.set(k, { ...e });
}
for (const e of moves.values()) if (e.from !== e.to) collapsed.push(e);

const kept = collapsed.sort((a, b) => b.at.localeCompare(a.at) || a.title.localeCompare(b.title));

await writeFile(
  CHANGES,
  `${JSON.stringify({ generatedAt: new Date().toISOString(), days: KEEP_DAYS, events: kept }, null, 0)}\n`,
);

const withPages = titles.filter(
  (t) => t.platforms?.includes('theatres') && t.synopsis && t.cast?.length,
).length;

console.log(
  `archive: ${titles.length} titles (${before} before, +${added} new, ${updated} updated)\n` +
    `         ${restamped} changed something a reader would see, and moved their lastmod\n` +
    `         ${fresh.length} new change events (${kept.length} in the ${KEEP_DAYS}-day log)\n` +
    (backfilled ? `         ${backfilled} older rows dated from when the feed last carried them\n` : '') +
    `         ${withPages} carry enough metadata for a title page`,
);
