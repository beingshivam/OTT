#!/usr/bin/env node
/**
 * Tests for the OMDb client.
 *
 * OMDb is unreachable from some environments this repo gets worked on in, so
 * the first live call can happen in CI — which makes the network-free parts the
 * ones worth covering: how a response is read, and which failures are a retry,
 * which are a skip, and which are a stop.
 *
 * The distinction matters because OMDb reports all three ambiguously. It
 * answers 200 for "no such film" and 401 for both a rejected key and a spent
 * daily quota, with the reason only in the body. Getting that wrong in either
 * direction is expensive: treat a spent quota as a miss and the run burns
 * several hundred requests discovering it repeatedly; treat a miss as fatal and
 * one obscure title stops the whole pass.
 *
 * Usage: npm run test:omdb
 */

import { Fatal, fetchTitle, scoreFrom, toNumber } from './omdb.mjs';

let failures = 0;
let ran = 0;

function check(name, fn) {
  ran++;
  return Promise.resolve()
    .then(fn)
    .then(() => console.log(`  ok   ${name}`))
    .catch((e) => {
      failures++;
      console.log(`  FAIL ${name}\n       ${e.message}`);
    });
}

const eq = (actual, expected, what = '') => {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${what}expected ${b}, got ${a}`);
};

/** A fetch that answers with one body, and counts how often it was called. */
const stub = (bodies) => {
  const queue = [...bodies];
  const impl = async () => {
    impl.calls++;
    const next = queue.length > 1 ? queue.shift() : queue[0];
    if (next instanceof Error) throw next;
    return { json: async () => next };
  };
  impl.calls = 0;
  return impl;
};

const NOWAIT = { wait: async () => {} };

console.log('\nomdb client\n');

await check('parses a vote count with separators', () => {
  eq(toNumber('731,205'), 731205);
  eq(toNumber('8.4'), 8.4);
});

await check('"N/A" and blanks are undefined, never zero', () => {
  eq(toNumber('N/A'), undefined);
  eq(toNumber(''), undefined);
  eq(toNumber(undefined), undefined);
  eq(toNumber(null), undefined);
});

await check('reads a rating and vote count off a normal response', () => {
  eq(scoreFrom({ imdbRating: '7.6', imdbVotes: '731,205' }), { rating: 7.6, votes: 731205 });
});

await check('a rating with no vote count is not a score', () => {
  eq(scoreFrom({ imdbRating: '8.9', imdbVotes: 'N/A' }), null);
  eq(scoreFrom({ imdbRating: 'N/A', imdbVotes: '12' }), null);
  eq(scoreFrom({}), null);
  eq(scoreFrom(null), null);
});

await check('an unrated title comes back as no score, not as zero', () => {
  const score = scoreFrom({ Title: 'Something new', imdbRating: 'N/A', imdbVotes: 'N/A' });
  eq(score, null);
});

await check('returns the body for a title OMDb knows', async () => {
  const fetchImpl = stub([{ Response: 'True', imdbRating: '7.6', imdbVotes: '1,000' }]);
  const body = await fetchTitle('tt3896198', 'k', { fetchImpl, ...NOWAIT });
  eq(body.imdbRating, '7.6');
  eq(fetchImpl.calls, 1, 'one call: ');
});

await check('a title OMDb has never heard of is a skip, not a failure', async () => {
  const fetchImpl = stub([{ Response: 'False', Error: 'Incorrect IMDb ID.' }]);
  eq(await fetchTitle('tt0', 'k', { fetchImpl, ...NOWAIT }), null);
});

await check('a rejected key stops the run', async () => {
  const fetchImpl = stub([{ Response: 'False', Error: 'Invalid API key!' }]);
  let thrown;
  try {
    await fetchTitle('tt1', 'bad', { fetchImpl, ...NOWAIT });
  } catch (e) {
    thrown = e;
  }
  if (!(thrown instanceof Fatal)) throw new Error('expected a Fatal, got ' + thrown);
  if (!/rejected the key/.test(thrown.message)) throw new Error(`unhelpful: ${thrown.message}`);
});

await check('a spent daily quota stops the run', async () => {
  const fetchImpl = stub([{ Response: 'False', Error: 'Request limit reached!' }]);
  let thrown;
  try {
    await fetchTitle('tt1', 'k', { fetchImpl, ...NOWAIT });
  } catch (e) {
    thrown = e;
  }
  if (!(thrown instanceof Fatal)) throw new Error('expected a Fatal, got ' + thrown);
  if (!/limit reached/i.test(thrown.message)) throw new Error(`unhelpful: ${thrown.message}`);
});

await check('retries a dropped connection, then succeeds', async () => {
  const fetchImpl = stub([new Error('ECONNRESET'), { Response: 'True', imdbRating: '6.1', imdbVotes: '9' }]);
  const body = await fetchTitle('tt2', 'k', { fetchImpl, ...NOWAIT });
  eq(body.imdbRating, '6.1');
  eq(fetchImpl.calls, 2, 'one retry: ');
});

await check('gives up after the attempt budget rather than looping', async () => {
  const fetchImpl = stub([new Error('ECONNRESET')]);
  eq(await fetchTitle('tt3', 'k', { fetchImpl, attempts: 3, ...NOWAIT }), null);
  eq(fetchImpl.calls, 3, 'three attempts: ');
});

await check('a body that is not JSON is retried, not thrown', async () => {
  let n = 0;
  const fetchImpl = async () => {
    n++;
    if (n === 1) return { json: async () => { throw new SyntaxError('Unexpected token <'); } };
    return { json: async () => ({ Response: 'True', imdbRating: '5.0', imdbVotes: '20' }) };
  };
  const body = await fetchTitle('tt4', 'k', { fetchImpl, ...NOWAIT });
  eq(body.imdbRating, '5.0');
  eq(n, 2);
});

await check('sends the id and key as query parameters', async () => {
  let seen;
  const fetchImpl = async (url) => {
    seen = url;
    return { json: async () => ({ Response: 'True', imdbRating: '1.0', imdbVotes: '1' }) };
  };
  await fetchTitle('tt1234567', 'secret', { fetchImpl, ...NOWAIT });
  eq(seen.searchParams.get('i'), 'tt1234567');
  eq(seen.searchParams.get('apikey'), 'secret');
});

// Counted, not written down: a hand-kept total stops matching the moment a
// check is added, and reports a pass count that was never run.
console.log(failures ? `\n${failures} of ${ran} check(s) failed\n` : `\n${ran} checks passed\n`);
process.exit(failures ? 1 : 0);
