/**
 * The archive sweep, against a stubbed TMDB.
 *
 * The two things worth pinning are the two that would do damage quietly: the
 * sweep must never overwrite a value the daily enrichment put there, and it
 * must spend its budget on the rows that would gain a page rather than on
 * whichever row sorts first. Neither failure would throw; both would just
 * make the archive slowly worse.
 *
 * Runs against a temp file via ARCHIVE_PATH — an earlier version of this test
 * backed up the real archive and restored it in a `finally`, which works right
 * up until the process dies between the two.
 *
 * Run: npm run test:backfill
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'backfill-'));
const ARCHIVE = join(dir, 'archive.json');

const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
const fixture = {
  updatedAt: '2026-09-22T00:00:00Z',
  titles: [
    { id: 'm-111', title: 'No Synopsis', kind: 'film', platforms: ['theatres'], languages: ['ml'],
      releaseDate: '2026-08-01', regions: ['IN'], posterUrl: 'p.jpg' },
    { id: 'm-222', title: 'Only Trailer Missing', kind: 'film', platforms: ['netflix'], languages: ['hi'],
      releaseDate: '2026-08-02', regions: ['IN'], posterUrl: 'p.jpg', synopsis: 'word '.repeat(30),
      cast: ['A'], director: 'D', runtimeMinutes: 120, certification: 'U', backdropUrl: 'b.jpg' },
    { id: 'm-333', title: 'Keep My Synopsis', kind: 'film', platforms: ['prime'], languages: ['ta'],
      releaseDate: '2026-08-03', regions: ['IN'], synopsis: 'ORIGINAL', posterUrl: 'p.jpg' },
    { id: 'm-444', title: 'Not Indian', kind: 'film', platforms: ['netflix'], languages: ['en'],
      releaseDate: '2026-08-04', regions: ['US'] },
    { id: 'm-555', title: 'Tried Recently', kind: 'film', platforms: ['theatres'], languages: ['te'],
      releaseDate: '2026-08-05', regions: ['IN'], backfilledAt: yesterday },
  ],
};
writeFileSync(ARCHIVE, JSON.stringify(fixture));

process.env.TMDB_TOKEN = 'test-token';
process.env.ARCHIVE_PATH = ARCHIVE;
process.env.BUDGET = '10';
delete process.env.OMDB_API_KEY;

const asked = [];
globalThis.fetch = async (url) => {
  asked.push(String(url));
  return {
    ok: true,
    status: 200,
    json: async () => ({
      overview: 'A fetched overview, long enough on its own to clear the bar a title page sets for body text.',
      poster_path: '/new.jpg',
      backdrop_path: '/newbd.jpg',
      runtime: 142,
      genres: [{ name: 'Drama' }],
      imdb_id: 'tt999',
      credits: { cast: [{ name: 'Actor One' }], crew: [{ job: 'Director', name: 'Dir Name' }] },
      videos: { results: [{ site: 'YouTube', key: 'abc', type: 'Trailer', official: true }] },
      release_dates: { results: [{ iso_3166_1: 'IN', release_dates: [{ certification: 'U/A 13+' }] }] },
    }),
  };
};

await import('./backfill-archive.mjs');
const out = Object.fromEntries(
  JSON.parse(readFileSync(ARCHIVE, 'utf8')).titles.map((t) => [t.id, t]),
);

test('it never overwrites a value the daily pass already wrote', () => {
  // The archive's whole contract: a failed or partial run cannot strip good
  // data. A sweep is exactly the job that would break it by accident.
  assert.equal(out['m-333'].synopsis, 'ORIGINAL');
});

test('it fills every gap it can reach in one call', () => {
  assert.match(out['m-111'].synopsis, /^A fetched overview/);
  assert.equal(out['m-111'].runtimeMinutes, 142);
  assert.equal(out['m-111'].certification, 'U/A 13+');
  assert.equal(out['m-111'].trailerUrl, 'https://www.youtube.com/watch?v=abc');
  assert.equal(out['m-111'].director, 'Dir Name');
  assert.deepEqual(out['m-111'].cast, ['Actor One']);
});

test('the row that would gain a page is asked for first', () => {
  // The budget is the scarce thing. A row blocked only by a missing trailer
  // buys nothing a reader can see; one blocked by a missing synopsis buys a
  // whole page.
  assert.match(asked[0], /\/movie\/111/);
});

test('it leaves other regions alone', () => {
  assert.equal(out['m-444'].backfilledAt, undefined);
});

test('a row tried recently is not tried again', () => {
  // Some fields are missing because TMDB does not have them. Without this the
  // sweep spends its whole budget re-asking the same permanent failures.
  assert.equal(out['m-555'].backfilledAt, yesterday);
});

test('every row it touched is stamped, including ones it could not fill', () => {
  assert.equal(out['m-111'].backfilledAt, new Date().toISOString().slice(0, 10));
  assert.equal(out['m-222'].backfilledAt, new Date().toISOString().slice(0, 10));
});
