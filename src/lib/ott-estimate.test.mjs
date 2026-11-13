import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateCopy, estimateFor, estimatePhase, gapPairs, windowStats } from './ott-estimate.mjs';

const cinema = (id, lang, date, over = {}) => ({ id, platforms: ['theatres'], languages: [lang], releaseDate: date, origin: ['IN'], ...over });
const arrival = (id, platform, date) => ({ id: `${id}~ott`, platforms: [platform], releaseDate: date });
const fmt = { languageLabel: (c) => ({ ta: 'Tamil', hi: 'Hindi' })[c] ?? c, formatDate: (d) => d };

/* Five Tamil films, each 28 days apart, and one import that must not count. */
const rows = [
  ...[1, 2, 3, 4, 5].flatMap((i) => [cinema(`m-${i}`, 'ta', '2026-09-04'), arrival(`m-${i}`, 'prime', '2026-10-02')]),
  cinema('m-9', 'en', '2026-09-04', { origin: ['US'] }), arrival('m-9', 'netflix', '2026-09-20'),
];
const stats = windowStats(gapPairs(rows));

test('the window is measured from Indian films seen on both sides', () => {
  assert.equal(stats.byLanguage.ta.n, 5);
  assert.equal(stats.byLanguage.ta.median, 28);
  assert.equal(stats.byLanguage.en, undefined, 'an import shaped the Indian window');
});

test('a Tamil film in cinemas gets the Tamil window', () => {
  const e = estimateFor(cinema('x', 'ta', '2026-11-06'), stats);
  assert.equal(e.likely, '2026-12-04');
  assert.deepEqual(e.basis, { language: 'ta', films: 5 });
});

test('nothing is estimated where something better is known, or nothing is', () => {
  assert.equal(estimateFor({ ...cinema('x', 'ta', '2026-11-06'), platforms: ['theatres', 'prime'] }, stats) === null, false,
    'the caller decides about services; a cinema row still gets a window');
  assert.equal(estimateFor({ ...cinema('x', 'ta', '2026-11-06'), platforms: ['netflix'] }, stats), null, 'a streaming-only row got an estimate');
  assert.equal(estimateFor(cinema('x', 'en', '2026-11-06', { origin: ['US'] }), stats), null, 'an import got an Indian window');
  assert.equal(estimateFor(cinema('x', 'ta', '2026-11-06'), windowStats([])), null, 'an estimate from no evidence');
});

test('every phase says it is not announced, and a passed window stops promising a date', () => {
  const e = estimateFor(cinema('x', 'ta', '2026-11-06'), stats);
  assert.equal(estimatePhase(e, '2026-11-13'), 'ahead');
  assert.equal(estimatePhase(e, '2026-12-04'), 'due');
  assert.equal(estimatePhase(e, '2027-02-01'), 'late');
  for (const today of ['2026-11-13', '2026-12-04', '2027-02-01']) {
    const c = estimateCopy(e, today, fmt);
    assert.match(c.detail, /not announced|running later/i, `${c.phase} hid that nothing is announced`);
  }
  const late = estimateCopy(e, '2027-02-01', fmt);
  assert.equal(late.tag, null, 'a title tag kept promising a date that has passed');
  assert.equal(late.fact, null);
});
