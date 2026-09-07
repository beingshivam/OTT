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
  ['--yes', 'esbuild', 'src/lib/rails.ts', '--bundle', '--format=esm', `--outfile=${join(dir, 'rails.mjs')}`],
  { stdio: 'pipe' },
);
const {
  justLanded,
  landingSoon,
  popularNow,
  inCinemas,
  landedOnOtt,
  CINEMA_DAYS,
  WINDOW_DAYS,
  SOON_DAYS,
  MAX_ITEMS,
} = await import(join(dir, 'rails.mjs'));

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

// --- landing soon ------------------------------------------------------------

test('landing soon takes only what has not come out yet', () => {
  const { releases } = landingSoon(
    [row({ releaseDate: iso(1) }), row({ releaseDate: iso(0) }), row({ releaseDate: iso(-2) })],
    'IN',
    TODAY,
  );
  assert.equal(releases.length, 1, 'today and yesterday have already landed');
  assert.equal(releases[0].releaseDate, iso(-2));
});

test('landing soon is nearest-first — the opposite order to just landed', () => {
  const { releases } = landingSoon(
    [
      row({ releaseDate: iso(-18), heat: 999, title: 'Big, three weeks out' }),
      row({ releaseDate: iso(-2), heat: 1, title: 'This Friday' }),
    ],
    'IN',
    TODAY,
  );
  assert.equal(releases[0].title, 'This Friday', 'the nearest release leads a row about what is coming');
});

test('landing soon stops at its own horizon', () => {
  const { releases } = landingSoon(
    [row({ releaseDate: iso(-SOON_DAYS) }), row({ releaseDate: iso(-SOON_DAYS - 1) })],
    'IN',
    TODAY,
  );
  assert.equal(releases.length, 1);
});

test('the two rows never contain the same title', () => {
  const rows = [];
  for (let d = -SOON_DAYS; d <= WINDOW_DAYS; d++) rows.push(row({ releaseDate: iso(d) }));
  const landedIds = new Set(justLanded(rows, 'IN', TODAY).releases.map((r) => r.id));
  const soonIds = landingSoon(rows, 'IN', TODAY).releases.map((r) => r.id);
  const overlap = soonIds.filter((id) => landedIds.has(id));
  assert.deepEqual(overlap, [], 'a title cannot have both just landed and be landing soon');
});

// --- popular now -------------------------------------------------------------

test('popular now needs a rank, and ignores rows without one', () => {
  const out = popularNow([row({ popRank: 1 }), row({}), row({ popRank: 4 })], 'IN');
  assert.equal(out.length, 2);
});

test('popular now interleaves languages rather than sorting rank globally', () => {
  const out = popularNow(
    [
      row({ popRank: 1, languages: ['en'], title: 'English 1' }),
      row({ popRank: 2, languages: ['en'], title: 'English 2' }),
      row({ popRank: 3, languages: ['en'], title: 'English 3' }),
      row({ popRank: 1, languages: ['ml'], title: 'Malayalam 1' }),
    ],
    'IN',
  );
  assert.equal(
    out[1].title,
    'Malayalam 1',
    'ranks are positions within a language and do not compare across them',
  );
});

test('popular now carries a poster, because it renders as one', () => {
  const out = popularNow([row({ popRank: 1, posterUrl: undefined }), row({ popRank: 2 })], 'IN');
  assert.equal(out.length, 1);
});

/** The catalogue file, checked the same way as the feed. */
test('the shipped catalogue produces a usable row', () => {
  const cat = JSON.parse(readFileSync('public/data/catalogue.json', 'utf8'));
  const out = popularNow(cat.titles, 'IN');
  assert.ok(out.length >= 6, `only ${out.length} ranked titles with posters`);
  const langs = new Set(out.map((r) => r.languages?.[0]));
  assert.ok(langs.size >= 3, `the row is only ${[...langs].join(', ')} — the interleave is not working`);
  console.log(`      ${out.length} in the row, ${langs.size} languages: ${[...langs].join(', ')}`);
});

/**
 * The split under "Just landed".
 *
 * The two sides run on different clocks on purpose — a cinema run outlasts a
 * streaming drop's news value by a month — and that asymmetry is the whole
 * reason the row was split, so it is the thing most worth pinning down.
 */

test('in cinemas reaches back further than the streaming side', () => {
  const old = row({ releaseDate: iso(30), platforms: ['theatres'] });
  assert.equal(inCinemas([old], 'IN', TODAY).releases.length, 1);
  assert.equal(
    landedOnOtt([row({ releaseDate: iso(30) })], 'IN', TODAY).releases.length,
    0,
    'the OTT side keeps the fortnight it always had',
  );
});

test('in cinemas stops at its own horizon', () => {
  const rows = [
    row({ releaseDate: iso(CINEMA_DAYS - 1), platforms: ['theatres'] }),
    row({ releaseDate: iso(CINEMA_DAYS + 5), platforms: ['theatres'] }),
  ];
  assert.equal(inCinemas(rows, 'IN', TODAY).releases.length, 1);
});

test('neither side takes what has not opened yet', () => {
  const future = [
    row({ releaseDate: iso(-2), platforms: ['theatres'] }),
    row({ releaseDate: iso(-2), platforms: ['netflix'] }),
  ];
  assert.equal(inCinemas(future, 'IN', TODAY).releases.length, 0);
  assert.equal(landedOnOtt(future, 'IN', TODAY).releases.length, 0);
});

test('a film both showing and streaming appears on both sides', () => {
  // The row the board draws as two platforms. Dropping it from either side
  // would hide a real answer to that side's question.
  const both = [row({ platforms: ['theatres', 'netflix'] })];
  assert.equal(inCinemas(both, 'IN', TODAY).releases.length, 1);
  assert.equal(landedOnOtt(both, 'IN', TODAY).releases.length, 1);
});

test('a cinema-only film never appears on the OTT side', () => {
  const rows = [row({ platforms: ['theatres'] })];
  assert.equal(landedOnOtt(rows, 'IN', TODAY).releases.length, 0);
});

test('both sides are newest first', () => {
  const older = iso(9);
  const newer = iso(2);
  const cin = inCinemas(
    [row({ releaseDate: older, platforms: ['theatres'] }), row({ releaseDate: newer, platforms: ['theatres'] })],
    'IN',
    TODAY,
  ).releases;
  assert.deepEqual([cin[0].releaseDate, cin[1].releaseDate], [newer, older]);

  const ott = landedOnOtt(
    [row({ releaseDate: older }), row({ releaseDate: newer })],
    'IN',
    TODAY,
  ).releases;
  assert.deepEqual([ott[0].releaseDate, ott[1].releaseDate], [newer, older]);
});

test('both sides respect region and require artwork', () => {
  const rows = [
    row({ platforms: ['theatres'], regions: ['US'] }),
    row({ platforms: ['theatres'], posterUrl: undefined }),
    row({ regions: ['US'] }),
    row({ posterUrl: undefined }),
  ];
  assert.equal(inCinemas(rows, 'IN', TODAY).releases.length, 0);
  assert.equal(landedOnOtt(rows, 'IN', TODAY).releases.length, 0);
});

test('one language cannot take the cinema row on a busy day', () => {
  const day = iso(3);
  const rows = [
    ...Array.from({ length: 5 }, () => row({ releaseDate: day, platforms: ['theatres'], languages: ['hi'], heat: 90 })),
    row({ releaseDate: day, platforms: ['theatres'], languages: ['ta'], heat: 10 }),
  ];
  const out = inCinemas(rows, 'IN', TODAY).releases;
  assert.equal(out[1].languages[0], 'ta', 'the second slot goes to the other language, not the fifth Hindi row');
});

test('both sides cap the row', () => {
  const many = Array.from({ length: MAX_ITEMS + 12 }, (_, i) =>
    row({ releaseDate: iso((i % 10) + 1), platforms: ['theatres'] }),
  );
  assert.equal(inCinemas(many, 'IN', TODAY).releases.length, MAX_ITEMS);
});

test('the shipped feed fills both sides', () => {
  const feed = JSON.parse(readFileSync('public/data/releases.json', 'utf8'));
  const all = feed.weeks.flatMap((w) => w.releases);
  const cin = inCinemas(all, 'IN', new Date()).releases;
  const ott = landedOnOtt(all, 'IN', new Date()).releases;
  assert.ok(cin.length > 0, 'no cinema titles in the real feed');
  assert.ok(ott.length > 0, 'no streaming titles in the real feed');
  assert.ok(cin.every((r) => r.platforms.includes('theatres')));
  assert.ok(ott.every((r) => r.platforms.some((p) => p !== 'theatres')));
});
