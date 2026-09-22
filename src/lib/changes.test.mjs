/**
 * The change log's sentences.
 *
 * Imported directly rather than bundled: the file is plain .mjs precisely so
 * the Node build and the browser share one copy, and a test that compiled its
 * own would not be testing the thing that ships.
 *
 * Run: npm run test:changes
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { phrase, byDay, dayLabel, shortDate } from './changes.mjs';

const TODAY = new Date('2026-09-22T12:00:00Z');
const NAME = { netflix: 'Netflix', prime: 'Prime Video', theatres: 'In cinemas' };
const pn = (id) => NAME[id] ?? id;

test('a streaming date names the service, the date and the wait', () => {
  assert.equal(
    phrase({ kind: 'dated', platforms: ['prime'], date: '2026-10-03', afterDays: 29 }, pn),
    'Got a Prime Video date — 3 Oct, 29 days after its cinema release',
  );
});

test('a streaming date with no cinema date behind it omits the wait', () => {
  // Rather than printing "0 days" or inventing one.
  assert.equal(
    phrase({ kind: 'dated', platforms: ['netflix'], date: '2026-10-03' }, pn),
    'Got a Netflix date — 3 Oct',
  );
});

test('a moved date says which way it went', () => {
  // "Moved" alone makes the reader compare two dates themselves, and the
  // direction is the entire news.
  assert.match(phrase({ kind: 'moved', from: '2026-10-03', to: '2026-10-17' }, pn), /^Pushed back to 17 Oct/);
  assert.match(phrase({ kind: 'moved', from: '2026-10-17', to: '2026-10-03' }, pn), /^Brought forward to 3 Oct/);
});

test('a title added with no service says cinemas, not a blank', () => {
  assert.equal(
    phrase({ kind: 'added', platforms: ['theatres'], date: '2026-09-25' }, pn),
    'Added to the calendar — In cinemas, 25 Sep',
  );
  assert.equal(
    phrase({ kind: 'added', platforms: [], date: '2026-09-25' }, pn),
    'Added to the calendar — cinemas, 25 Sep',
  );
});

test('two services are joined the way a person says them', () => {
  assert.match(
    phrase({ kind: 'dated', platforms: ['netflix', 'prime'], date: '2026-10-03' }, pn),
    /Netflix and Prime Video/,
  );
});

test('an unknown kind still renders something true', () => {
  // A kind added to archive.mjs and not here must not produce "undefined" on a
  // published page; it falls through to the additive phrasing.
  assert.match(phrase({ kind: 'whatever-next', platforms: ['netflix'], date: '2026-09-25' }, pn), /Netflix/);
});

test('days come back newest first', () => {
  const out = byDay([
    { at: '2026-09-20', title: 'a' },
    { at: '2026-09-22', title: 'b' },
    { at: '2026-09-21', title: 'c' },
    { at: '2026-09-22', title: 'd' },
  ]);
  assert.deepEqual(out.map((d) => d.at), ['2026-09-22', '2026-09-21', '2026-09-20']);
  assert.equal(out[0].events.length, 2);
});

test('the day window is a window', () => {
  const many = Array.from({ length: 40 }, (_, i) => ({ at: `2026-08-${String(i % 28 + 1).padStart(2, '0')}` }));
  assert.ok(byDay(many, 5).length <= 5);
});

test('recent days get a relative label and older ones a date', () => {
  assert.equal(dayLabel('2026-09-22', TODAY), 'Today');
  assert.equal(dayLabel('2026-09-21', TODAY), 'Yesterday');
  assert.equal(dayLabel('2026-09-18', TODAY), '18 Sep');
});

test('a date in another year carries the year', () => {
  assert.equal(shortDate('2027-01-14', TODAY), '14 Jan 2027');
});
