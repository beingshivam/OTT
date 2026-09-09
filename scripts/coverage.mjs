#!/usr/bin/env node
/**
 * Which titles the site has no page for, and why.
 *
 * The question behind this is "can I trust that a big release will get a page
 * without me noticing it hasn't". The honest answer is that nobody is watching
 * — not a person, not an assistant between conversations — so the only thing
 * that can notice is the pipeline itself. This makes it notice, and the refresh
 * notification carries the answer three times a week.
 *
 * It is deliberately a report and not a fix. Every reason a title is skipped is
 * a real one: a film with no India release date should not get a page saying
 * when it reaches Indian streaming, and a page built from a row with no
 * synopsis and no cast is a template with a date in it. What was missing was
 * not better rules, it was any way to see what the rules were costing.
 *
 * Reads the data rather than dist/, so it is honest about coverage even on a
 * checkout that has not been built — and so it says the same thing whether it
 * runs before or after the site is generated.
 *
 * Usage: npm run coverage        (add --all to list every miss, not just the top)
 */

import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Must match scripts/build-seo.mjs. A copy that drifts would report gaps that
 *  are not there, which is the fastest way to make a report ignored. */
const REGION = 'IN';

/**
 * Below this a miss is not worth a line in a notification.
 *
 * Heat is a 0–100 squash of TMDB popularity and votes. It is only comparable
 * within a language — the rule the whole site is built on — so this is a floor
 * for "somebody has heard of this", not a ranking. A report that lists every
 * long-tail regional title nobody searched for is a report that gets deleted
 * unread, which is the same silence it was built to end.
 */
const NOTABLE = 60;

/** How many to name before saying "and N more". */
const TOP = 6;

const read = async (p) => JSON.parse(await readFile(resolve(ROOT, p), 'utf8'));

const feed = await read('public/data/releases.json');
const archive = await read('data/archive.json').catch(() => ({ titles: [] }));

const live = feed.weeks.flatMap((w) => w.releases);
const liveIds = new Set(live.map((r) => r.id));
const all = [...live, ...archive.titles.filter((t) => !liveIds.has(t.id))];

/**
 * The same three gates build-seo.mjs applies, in the same order, so the reason
 * given is the reason that actually excluded the row.
 *
 * Ordered most-fundamental first: a title with no India release is not an
 * India page however complete its metadata, and a streaming-only title has no
 * page *type* yet rather than a missing field.
 */
function whyNoPage(r) {
  if (!(r.regions ?? []).includes(REGION)) return 'no India release recorded on TMDB';
  if (!r.platforms.includes('theatres')) return 'streaming-only — no page type for these yet';
  if (!r.synopsis) return 'no synopsis in the feed';
  if (!(r.cast ?? []).length) return 'no cast in the feed';
  return null;
}

const misses = all
  .map((r) => ({ row: r, why: whyNoPage(r) }))
  .filter((x) => x.why)
  .sort((a, b) => (b.row.heat ?? 0) - (a.row.heat ?? 0));

const notable = misses.filter((x) => (x.row.heat ?? 0) >= NOTABLE);
const covered = all.length - misses.length;

/** Grouped so the report says what kind of problem this is, not just how big. */
const byReason = new Map();
for (const { why } of misses) byReason.set(why, (byReason.get(why) ?? 0) + 1);

const lines = [];
lines.push(
  `- **${covered}** of ${all.length} titles have a page; **${notable.length}** notable title${
    notable.length === 1 ? '' : 's'
  } (heat ≥ ${NOTABLE}) do not`,
);

const listed = process.argv.includes('--all') ? notable : notable.slice(0, TOP);
for (const { row, why } of listed) {
  lines.push(`  - ${row.title} — heat ${row.heat ?? 0} — ${why}`);
}
if (notable.length > listed.length) {
  lines.push(`  - …and ${notable.length - listed.length} more above heat ${NOTABLE}`);
}
if (!notable.length) {
  lines.push('  - nothing notable is missing a page');
}

lines.push('');
for (const [why, n] of [...byReason].sort((a, b) => b[1] - a[1])) {
  lines.push(`- ${n} skipped: ${why}`);
}

console.log(lines.join('\n'));
