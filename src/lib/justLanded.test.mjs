/**
 * The selection behind the poster rail, tested where it is cheap to test.
 *
 * The rendering is checked in a real browser (scripts/e2e.mjs). What lives here
 * is the part a screenshot cannot tell you: that the window is the window, that
 * the ordering claim the label makes is the ordering the row has, and that one
 * language cannot take the row on a day it happens to be busy.
 *
 * Run: npm run test:rail
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

/**
 * The source is TypeScript and this is plain node, so it is compiled once into
 * a temp directory rather than being duplicated here. A copy of the logic in a
 * test only ever proves the copy works.
 */
const dir = mkdtempSync(join(tmpdir(), 'rail-'));
execFileSync(
  'npx',
  ['--yes', 'esbuild', 'src/lib/justLanded.ts', '--bundle', '--format=esm', `--outfile=${join(dir, 'justLanded.mjs')}`],
  { stdio: 'pipe' },
);
const { justLanded, WINDOW_DAYS, MAX_ITEMS } = await import(join(dir, 'justLanded.mjs'));

const TODAY = new Date('2026-09-07T12:00:00');
const iso = (daysAgo) =>
  new Date(TODAY.getTime() - daysAgo * 86_400_000).toISOString().slice(0, 10);

let n = 0;
const row = (over = {}) => ({
  id: `t${++n}`,
  title: `Title ${n}`,
  kind: 'film',
  platforms: ['netflix'],
  languages: ['hi'],
  genres: [],
  regions: ['IN'],
  releaseDate: iso(1),
  posterUrl: 'https://image.tmdb.org/x.jpg',
  heat: 1,
  ...over,
});

test('takes only what has already come out', () => {
  const { releases } = justLanded(
    [row({ releaseDate: iso(-3) }), row({ releaseDate: iso(0) }), row({ releaseDate: iso(2) })],
    'IN',
    TODAY,
  );
  const dates = releases.map((r) => r.releaseDate);
  assert.ok(!dates.includes(iso(-3)), 'a title three days out is not "just landed"');
  assert.equal(dates.length, 2);
});

test('the window is exactly the window it advertises', () => {
  const { releases } = justLanded(
    [row({ releaseDate: iso(WINDOW_DAYS - 1) }), row({ releaseDate: iso(WINDOW_DAYS) })],
    'IN',
    TODAY,
  );
  assert.equal(releases.length, 1, 'the last day inside the window is in, the next one is out');
});

test('drops rows with no poster, and rows from another region', () => {
  const { releases } = justLanded(
    [row({ posterUrl: undefined }), row({ regions: ['US'] }), row()],
    'IN',
    TODAY,
  );
  assert.equal(releases.length, 1);
});

test('newest day first — the label is a claim about time', () => {
  const { releases } = justLanded(
    [
      row({ releaseDate: iso(9), heat: 999, title: 'Old blockbuster' }),
      row({ releaseDate: iso(1), heat: 1, title: 'Yesterday, quietly' }),
    ],
    'IN',
    TODAY,
  );
  assert.equal(releases[0].title, 'Yesterday, quietly', 'heat must not outrank recency');
});

test('within one day, languages interleave instead of one taking the row', () => {
  const sameDay = { releaseDate: iso(1) };
  const { releases } = justLanded(
    [
      row({ ...sameDay, languages: ['hi'], heat: 100, title: 'Hindi 1' }),
      row({ ...sameDay, languages: ['hi'], heat: 90, title: 'Hindi 2' }),
      row({ ...sameDay, languages: ['hi'], heat: 80, title: 'Hindi 3' }),
      row({ ...sameDay, languages: ['ml'], heat: 5, title: 'Malayalam 1' }),
    ],
    'IN',
    TODAY,
  );
  assert.equal(
    releases[1].title,
    'Malayalam 1',
    'a Malayalam film should not sit behind every Hindi one on the same day — TMDB heat is not comparable across languages',
  );
});

test('a busy day cannot bury a quieter, more recent one', () => {
  const rows = [];
  for (let i = 0; i < 8; i++) rows.push(row({ releaseDate: iso(3), heat: 500 }));
  rows.push(row({ releaseDate: iso(0), heat: 1, title: 'Today' }));
  const { releases } = justLanded(rows, 'IN', TODAY);
  assert.equal(releases[0].title, 'Today');
});

test('caps the row', () => {
  const rows = [];
  for (let i = 0; i < MAX_ITEMS + 15; i++) rows.push(row());
  assert.equal(justLanded(rows, 'IN', TODAY).releases.length, MAX_ITEMS);
});

test('an empty feed is an empty row, not a crash', () => {
  assert.deepEqual(justLanded([], 'IN', TODAY).releases, []);
});

test('cinemas travel with streaming — that pairing is the point', () => {
  const { releases } = justLanded(
    [row({ platforms: ['theatres'], releaseDate: iso(1) }), row({ releaseDate: iso(1) })],
    'IN',
    TODAY,
  );
  assert.ok(
    releases.some((r) => r.platforms.includes('theatres')),
    'a theatrical release inside the window belongs in the row',
  );
});

test('reads across weeks, which is the whole reason it exists', () => {
  // Two feed weeks' worth of dates, all inside the fortnight.
  const rows = [iso(1), iso(5), iso(8), iso(12)].map((d) => row({ releaseDate: d }));
  const { releases } = justLanded(rows, 'IN', TODAY);
  assert.equal(releases.length, 4);
});

/** Verified against the real feed, so a change in its shape shows up here. */
test('the shipped feed produces a usable row', () => {
  const feed = JSON.parse(readFileSync('dist/data/releases.json', 'utf8'));
  const all = feed.weeks.flatMap((w) => w.releases);
  const { releases, from, to } = justLanded(all, 'IN', new Date());
  assert.ok(releases.length > 0, `no recent India titles in the feed between ${from} and ${to}`);
  for (const r of releases) {
    assert.ok(r.posterUrl, `${r.title} has no poster`);
    assert.ok(r.releaseDate >= from && r.releaseDate <= to, `${r.title} is outside the window`);
  }
  writeFileSync(
    join(dir, 'sample.json'),
    JSON.stringify(releases.map((r) => `${r.releaseDate} ${r.languages?.[0]} ${r.title}`), null, 2),
  );
  console.log(`      ${releases.length} in the row, ${from} to ${to}`);
});
