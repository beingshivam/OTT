/**
 * The tense on a poster, which is the part a reader checks against reality.
 *
 * Run: npm run test:label
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { releaseLabel, upcoming } from './release-label.mjs';

const TODAY = '2026-10-09';

test('a film that has not opened yet does not say it is playing', () => {
  /*
   * Reported: "Jailer 2 hasn't released yet, it'll release on 15th." The post
   * went out on the 9th reading "In cinemas · Thu 15 Oct", which a reader
   * takes as a film in cinemas now. Three of the five titles on that image
   * were in the same state.
   */
  const label = releaseLabel('In cinemas', '2026-10-15', TODAY, { long: true });
  assert.match(label, /from/, `an unreleased film reads as playing: ${label}`);
  assert.equal(label, 'In cinemas · from Thu 15 Oct');
});

test('a film already out is not pushed into the future either', () => {
  // The opposite error, and just as wrong: "from 9 Oct" on the 9th would read
  // as something a reader still has to wait for.
  const label = releaseLabel('Prime Video', '2026-10-09', TODAY);
  assert.doesNotMatch(label, /from/, `a released film reads as upcoming: ${label}`);
  assert.equal(label, 'Prime Video · 9 Oct');
});

test('the day it opens counts as out, not as coming', () => {
  // The boundary, and the one most likely to be written as `>=` by accident:
  // a film released this morning is out, and a post saying otherwise is wrong
  // on the single day it matters most.
  assert.equal(upcoming('2026-10-09', '2026-10-09'), false);
  assert.equal(upcoming('2026-10-10', '2026-10-09'), true);
  assert.equal(upcoming('2026-10-08', '2026-10-09'), false);
});

test('a weekday is spelled out only where there is room for it', () => {
  assert.equal(releaseLabel('In cinemas', '2026-10-15', TODAY), 'In cinemas · from 15 Oct');
  assert.equal(
    releaseLabel('In cinemas', '2026-10-15', TODAY, { long: true }),
    'In cinemas · from Thu 15 Oct',
  );
});

test('a missing date is never described as upcoming', () => {
  // A row with no release date used to compare as `undefined > today`, which
  // is false, so it fell through to the past tense by luck rather than by
  // decision. Stated instead.
  assert.equal(upcoming(undefined, TODAY), false);
  assert.equal(upcoming('', TODAY), false);
});

test('a platform the site only inferred says so', () => {
  /*
   * "Did nothing release on Jio, Prime, SonyLIV, ZEE5?" — three Indian titles
   * had, and the OTT card showed none of them, because a platform taken from
   * a release note was dropped rather than qualified. DetailSheet has had the
   * middle setting since the Toxic report; the poster builder had not.
   */
  assert.equal(
    releaseLabel('ZEE5', '2026-10-16', '2026-10-16', { guessed: true }),
    'ZEE5 · expected 16 Oct',
  );
});

test('an inferred platform is never dressed up as confirmed', () => {
  // The whole point: a guess must not render identically to a provider, in
  // either tense. That identical rendering is what sent a reader to a
  // subscription for a film that was not there yet.
  const guess = releaseLabel('ZEE5', '2026-10-20', '2026-10-16', { guessed: true });
  const fact = releaseLabel('ZEE5', '2026-10-20', '2026-10-16');
  assert.notEqual(guess, fact);
  assert.match(guess, /expected/);
  assert.doesNotMatch(fact, /expected/);
});
