import test from 'node:test';
import assert from 'node:assert/strict';
import { sightings, summarise } from './track-windows.mjs';

/*
 * The two rules that make this a dataset rather than a pile of guesses, and
 * the thresholds that decide when it is allowed to become a sentence on a
 * page. Both are the kind of rule that gets quietly relaxed by somebody in a
 * hurry to ship the feature, so both are pinned here.
 */

const week = (releases) => ({ weeks: [{ id: 'w', releases }] });
const cinema = (over = {}) => ({
  id: 'm-1',
  title: 'A Film',
  platforms: ['theatres'],
  languages: ['ta'],
  regions: ['IN'],
  releaseDate: '2026-08-01',
  ...over,
});
const ott = (over = {}) => ({
  id: 'm-1~ott',
  title: 'A Film',
  platforms: ['netflix'],
  languages: ['ta'],
  regions: ['IN'],
  releaseDate: '2026-08-29',
  ...over,
});

test('a confirmed transition is one observation with its gap', () => {
  const seen = sightings(week([cinema(), ott()]));
  assert.equal(seen.length, 1);
  assert.equal(seen[0].days, 28);
  assert.equal(seen[0].platform, 'netflix');
  assert.equal(seen[0].language, 'ta');
});

test('a guessed platform is never an observation', () => {
  /*
   * The whole reason this file is strict. A `~ott` row's platform comes from
   * a watch provider — TMDB reporting real availability — or from free text a
   * contributor typed. The guesses are not even randomly wrong: three of the
   * first four sat at exactly 28 days, because that is what somebody types
   * when they mean "about a month". Averaging those in would measure a
   * convention and publish it as a fact about Indian distribution.
   */
  for (const namedBy of ['note', 'studio', 'network']) {
    assert.deepEqual(sightings(week([cinema(), ott({ namedBy })])), [], `${namedBy} was counted`);
  }
});

test('and neither is a date with no service behind it', () => {
  // A gap that cannot be attributed to a platform loses most of its value,
  // and "ott" is the old placeholder for a date whose service was unknown.
  assert.deepEqual(sightings(week([cinema(), ott({ platforms: ['ott'] })])), []);
  assert.deepEqual(sightings(week([cinema(), ott({ platforms: [] })])), []);
});

test('only India, because a window is a fact about one market', () => {
  assert.deepEqual(sightings(week([cinema({ regions: ['US'] }), ott()])), []);
});

test('a day-and-date drop is not a window, and neither is a re-release', () => {
  assert.deepEqual(sightings(week([cinema(), ott({ releaseDate: '2026-08-01' })])), [], 'same day');
  assert.deepEqual(sightings(week([cinema(), ott({ releaseDate: '2028-08-01' })])), [], 'two years');
  assert.deepEqual(sightings(week([cinema(), ott({ releaseDate: '2026-07-01' })])), [], 'backwards');
});

test('a film with no cinema row is not a transition', () => {
  // A streaming-only title never had a window. Counting its release date
  // against nothing would put a zero in the data.
  assert.deepEqual(sightings(week([ott()])), []);
  assert.deepEqual(sightings(week([cinema()])), []);
});

/*
 * The thresholds. These decide whether a page is allowed to say anything, and
 * they exist because the honest answer changes shape with the sample: at n=3
 * a median is an anecdote with a decimal point.
 */

const obs = (n, days = 28) =>
  Array.from({ length: n }, (_, i) => ({ id: `m-${i}`, days, language: 'ta', platform: 'netflix' }));

test('under five observations, a page may say nothing', () => {
  for (const n of [0, 1, 2, 3, 4]) {
    const s = summarise(obs(n));
    assert.equal(s.overall?.confidence ?? 'none', 'none', `n=${n} was judged publishable`);
  }
});

test('five earns a range, twelve earns a median', () => {
  assert.equal(summarise(obs(5)).overall.confidence, 'range');
  assert.equal(summarise(obs(11)).overall.confidence, 'range');
  assert.equal(summarise(obs(12)).overall.confidence, 'median');
});

test('every figure carries the count that produced it', () => {
  /*
   * So a page physically cannot quote "28 days" without "from 14 films" —
   * the number and its evidence come out of the same object or not at all.
   */
  const s = summarise([...obs(6, 20), ...obs(6, 40).map((o) => ({ ...o, id: `x-${o.id}` }))]);
  assert.equal(s.overall.n, 12);
  assert.ok(Number.isFinite(s.overall.median));
  assert.ok(Number.isFinite(s.overall.p25) && Number.isFinite(s.overall.p75));
  for (const bucket of [s.byLanguage, s.byPlatform]) {
    for (const [key, v] of Object.entries(bucket)) {
      assert.ok(v.n > 0, `${key} reported a figure with no sample`);
      assert.ok(['none', 'range', 'median'].includes(v.confidence));
    }
  }
});

test('a language with one film is not a language median', () => {
  // The failure this would have shipped: Malayalam n=1, printed as though it
  // described Malayalam cinema.
  const mixed = [
    ...obs(12).map((o) => ({ ...o, language: 'ta' })),
    { id: 'm-ml', days: 42, language: 'ml', platform: 'prime' },
  ];
  const s = summarise(mixed);
  assert.equal(s.byLanguage.ta.confidence, 'median');
  assert.equal(s.byLanguage.ml.confidence, 'none', 'one Malayalam film became a Malayalam median');
});
