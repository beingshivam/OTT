/**
 * The sentence that travels.
 *
 * A forwarded WhatsApp message is this site's only organic distribution, and
 * it is the one piece of copy nobody proofreads before it goes out — it is
 * generated at the moment of the tap and sent. So the states are pinned here:
 * the bug being guarded against is a film three weeks away being forwarded as
 * though it were on tonight, which is what the sheet's old hand-rolled line
 * did.
 *
 * Run: npm run test:share
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'share-'));
execFileSync(
  'npx',
  ['--yes', 'esbuild', 'src/lib/share.ts', '--bundle', '--format=esm', `--outfile=${join(dir, 'share.mjs')}`],
  { stdio: 'pipe' },
);
const { shareLine, shareUrl, whatsappHref } = await import(join(dir, 'share.mjs'));

const TODAY = new Date('2026-09-22T12:00:00Z');
const row = (over = {}) => ({
  id: 'm-1',
  title: 'Kantara 3',
  kind: 'film',
  platforms: ['theatres'],
  languages: ['kn'],
  genres: [],
  regions: ['IN'],
  releaseDate: '2026-09-22',
  ...over,
});

test('a title already streaming says so, and names the service', () => {
  const line = shareLine(row({ platforms: ['netflix'], releaseDate: '2026-09-18' }), { today: TODAY });
  assert.equal(line, 'Kantara 3 is streaming now on Netflix');
});

test('a title not out yet is never described as streaming', () => {
  // The defect this whole module exists for: the sheet's old line read
  // "Kantara 3 — Netflix, Fri 09 Oct" whether or not the film was out, and a
  // forward is read as "it is on now".
  const line = shareLine(row({ platforms: ['netflix'], releaseDate: '2026-10-09' }), { today: TODAY });
  assert.equal(line, 'Kantara 3 lands on Netflix on 9 Oct');
  assert.ok(!/streaming now/.test(line));
});

test('a cinema release says cinemas, not a platform name', () => {
  assert.equal(
    shareLine(row({ releaseDate: '2026-10-09' }), { today: TODAY }),
    'Kantara 3 opens in cinemas on 9 Oct',
  );
  assert.equal(
    shareLine(row({ releaseDate: '2026-09-04' }), { today: TODAY }),
    'Kantara 3 is in cinemas now — no OTT date yet',
  );
});

test('a known OTT date beats "no OTT date yet"', () => {
  // The most useful message the site can send, and the one the sheet could
  // never build: the date lives on the film's `~ott` row, not on this one.
  const line = shareLine(row({ releaseDate: '2026-09-04' }), {
    today: TODAY,
    streamsOn: { date: '2026-10-03', platforms: ['prime'] },
  });
  assert.equal(line, 'Kantara 3 is on Prime Video from 3 Oct');
});

test('two platforms are joined the way a person says them', () => {
  const line = shareLine(row({ platforms: ['netflix', 'prime'], releaseDate: '2026-09-18' }), { today: TODAY });
  assert.equal(line, 'Kantara 3 is streaming now on Netflix and Prime Video');
});

test('a date in another year carries the year', () => {
  // "9 Oct" on a film eighteen months out reads as this October.
  assert.match(shareLine(row({ releaseDate: '2027-10-09' }), { today: TODAY }), /9 Oct 2027/);
});

test('the link is the film, never the page it was shared from', () => {
  // Sharing Mirzapur from the board used to send window.location.href — the
  // homepage. The one link in the message, pointing at the wrong page.
  assert.equal(
    shareUrl(row({ slug: 'kantara-3' }), 'https://newonott.in/', 'https://newonott.in'),
    'https://newonott.in/ott-release-date/kantara-3',
  );
});

test('a title with no page falls back to where you are', () => {
  // build-seo clears `slug` when a row has no published page, so its absence
  // is trustworthy — and a link to a page that does not exist is worse than a
  // link to the homepage.
  assert.equal(
    shareUrl(row(), 'https://newonott.in/theatres', 'https://newonott.in'),
    'https://newonott.in/theatres',
  );
});

test('the URL is on its own line, so WhatsApp draws the preview card', () => {
  const href = whatsappHref('Kantara 3 is streaming now on Netflix', 'https://newonott.in/x');
  const text = decodeURIComponent(href.split('text=')[1]);
  assert.equal(text, 'Kantara 3 is streaming now on Netflix\nhttps://newonott.in/x');
  assert.ok(href.startsWith('https://wa.me/?text='));
});

test('titles with punctuation survive the encoding', () => {
  const href = whatsappHref(shareLine(row({ title: 'Mirzapur: The Movie & Sons', platforms: ['netflix'], releaseDate: '2026-09-18' }), { today: TODAY }), 'https://newonott.in/x');
  assert.ok(!/[&?#]/.test(href.split('text=')[1].replace(/%../g, '')));
  assert.match(decodeURIComponent(href), /Mirzapur: The Movie & Sons/);
});
