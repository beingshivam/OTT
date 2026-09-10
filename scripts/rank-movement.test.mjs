import test from 'node:test';
import assert from 'node:assert/strict';
import { baselineFor, movement, weekStart } from './rank-movement.mjs';

/**
 * The four cases that decide whether a "trending this week" label is honest.
 * Every one of them has a plausible-looking wrong answer, which is why they are
 * tested rather than read: a baseline that measures the wrong window still
 * renders arrows, it just points some of them at nothing.
 */

test('the week opens on Friday, matching the calendar', () => {
  // 2026-09-04 is a Friday; 09-10 is the Thursday that closes the same week.
  assert.equal(weekStart(new Date('2026-09-04T00:00:00Z')), '2026-09-04');
  assert.equal(weekStart(new Date('2026-09-07T13:30:00Z')), '2026-09-04');
  assert.equal(weekStart(new Date('2026-09-10T23:59:00Z')), '2026-09-04');
  // And the next Friday starts a new one rather than extending it.
  assert.equal(weekStart(new Date('2026-09-11T02:30:00Z')), '2026-09-11');
});

test('inside a week the baseline is held, not re-taken each run', () => {
  // Saturday's run: the title has slipped from 10 to 14 since Friday.
  const prior = { rank: 10, week: '2026-09-11' };
  assert.deepEqual(baselineFor(prior, 12, '2026-09-11'), {
    baseRank: 10,
    baseWeek: '2026-09-11',
  });
  // Monday's run, having slipped further. Still measured from Friday's 10 —
  // taking the last run's 12 would report a two-place fall for a title that
  // has actually fallen four.
  assert.deepEqual(baselineFor({ rank: 10, week: '2026-09-11' }, 12, '2026-09-11'), {
    baseRank: 10,
    baseWeek: '2026-09-11',
  });
});

test('a new week starts from where the title finished the last one', () => {
  const prior = { rank: 10, week: '2026-09-11' };
  // Friday 18th: last week's baseline is stale, and last run's rank (12) is
  // where this week begins.
  assert.deepEqual(baselineFor(prior, 12, '2026-09-18'), {
    baseRank: 12,
    baseWeek: '2026-09-18',
  });
});

test('the first run to carry a baseline seeds it from the last run', () => {
  // No prior baseline on disk — the state every existing catalogue.json is in.
  assert.deepEqual(baselineFor(undefined, 7, '2026-09-11'), {
    baseRank: 7,
    baseWeek: '2026-09-11',
  });
});

test('a title new to the list has no baseline and has not climbed', () => {
  // The case that has to stay null. Absent is not "came from the bottom", and
  // a display that treats it as one invents the biggest rise on the page every
  // single week.
  assert.equal(baselineFor(undefined, undefined, '2026-09-11'), null);
  assert.equal(baselineFor(null, null, '2026-09-11'), null);
});

test('movement is positive for a climb and null when unknowable', () => {
  assert.equal(movement({ baseRank: 20, popRank: 6 }), 14);
  assert.equal(movement({ baseRank: 6, popRank: 20 }), -14);
  assert.equal(movement({ baseRank: 6, popRank: 6 }), 0);
  assert.equal(movement({ popRank: 6 }), null);
  assert.equal(movement({ baseRank: 6 }), null);
});

test('a run that changes nothing reports zero, not absence', () => {
  // What the real data looked like when two runs landed 27 minutes apart: every
  // baseline present, every movement zero. The feature has to be able to tell
  // this apart from "no data", because only one of them is worth waiting out.
  const rows = [
    { popRank: 1, baseRank: 1 },
    { popRank: 2, baseRank: 2 },
    { popRank: 3, baseRank: 3 },
  ];
  assert.deepEqual(rows.map(movement), [0, 0, 0]);
  assert.equal(rows.filter((r) => movement(r) !== 0).length, 0);
});
