/**
 * The shared TMDB client's pacing and pooling.
 *
 * Both of these exist because the fetch was leaving three quarters of its
 * permitted request rate unused and running out of budget at about thirteen
 * hundred titles, while Tamil alone has nearly two thousand on Indian
 * streaming. So they are the difference between the site covering India and
 * covering a corner of it, and they are the kind of code that is easy to get
 * subtly wrong in a way no output ever shows: a limiter that does not actually
 * limit looks fine until TMDB starts answering 429, and a pool that loses an
 * item looks fine until a title quietly stops having a page.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

process.env.TMDB_TOKEN ??= 'test-token';
const { mapPool } = await import('./tmdb.mjs');

test('the pool keeps order, and every item is visited exactly once', async () => {
  const seen = [];
  const { results, done, stopped } = await mapPool([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
    /* Uneven durations on purpose: if the pool were assembling results by
       completion order rather than by index, this is what would expose it. */
    await new Promise((r) => setTimeout(r, n % 2 ? 12 : 1));
    seen.push(n);
    return n * 10;
  });

  assert.deepEqual(results, [10, 20, 30, 40, 50, 60, 70], 'results came back out of order');
  assert.deepEqual([...seen].sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7], 'an item was skipped or run twice');
  assert.equal(done, 7);
  assert.equal(stopped, false);
});

test('the pool really does overlap', async () => {
  // The whole point of the change. Serial would be 8 × 20ms; four at a time
  // should land nearer a quarter of that.
  let inFlight = 0;
  let peak = 0;
  const began = Date.now();
  await mapPool(Array.from({ length: 8 }, (_, i) => i), 4, async () => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, 20));
    inFlight -= 1;
  });
  const took = Date.now() - began;

  assert.equal(peak, 4, `only ${peak} were ever in flight at once`);
  assert.ok(took < 120, `took ${took}ms, which is serial rather than pooled`);
});

test('never more in flight than the limit allows', async () => {
  let inFlight = 0;
  let peak = 0;
  await mapPool(Array.from({ length: 30 }, (_, i) => i), 5, async () => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, 2));
    inFlight -= 1;
  });
  assert.ok(peak <= 5, `${peak} were in flight against a limit of 5`);
});

test('a limit above the item count is not an error', async () => {
  const { results, done } = await mapPool([1, 2], 12, async (n) => n + 1);
  assert.deepEqual(results, [2, 3]);
  assert.equal(done, 2);
});

test('nothing to do is not a hang', async () => {
  const { results, done, stopped } = await mapPool([], 4, async () => 1);
  assert.deepEqual(results, []);
  assert.equal(done, 0);
  assert.equal(stopped, false);
});

test('stopping keeps what was fetched and leaves the rest as holes', async () => {
  /*
   * How running out of the time budget has to behave. A partial catalogue is
   * the documented outcome, so the caller needs to tell "never reached" from
   * "came back with nothing" — the second is a title to drop and the first is
   * a title to leave alone. Reporting the first as the second would make a
   * short run look like a wall of drops, which is exactly what the fetch's
   * collapse guard is watching for.
   */
  let ran = 0;
  const { results, stopped, done } = await mapPool(
    Array.from({ length: 20 }, (_, i) => i),
    2,
    async (n) => {
      ran += 1;
      return n;
    },
    () => ran >= 6,
  );

  assert.equal(stopped, true, 'the stop signal was ignored');
  assert.ok(done <= 8 && done >= 6, `ran ${done} items after being told to stop at 6`);
  assert.equal(results.length, 20, 'the result array lost its shape');
  assert.ok(
    results.slice(done).every((r) => r === undefined),
    'items that were never reached came back as something',
  );
  assert.ok(
    results.slice(0, 6).every((r) => r !== undefined),
    'work that finished before the stop was thrown away',
  );
});

test('a stop that is true from the start does no work at all', async () => {
  let ran = 0;
  const { stopped, done } = await mapPool([1, 2, 3], 3, async () => { ran += 1; }, () => true);
  assert.equal(ran, 0, `did ${ran} items after being told not to start`);
  assert.equal(done, 0);
  assert.equal(stopped, true);
});

test('the rate limiter paces concurrent callers rather than just serial ones', async () => {
  /*
   * The bug the old pacing had. `if (calls++ > 0) await sleep(60)` reads as a
   * rate limit and is only one because nothing ever called twice at once —
   * fire twenty at the same moment and all twenty sleep the same 60ms in
   * parallel and then leave together. The slot allocator has to space them
   * whether they arrive one at a time or all at once, or making the fetch
   * concurrent would have turned a quarter-speed client into a burst that
   * earns a 429.
   *
   * Tested through fetch, since the allocator is deliberately not exported:
   * the thing worth asserting is that requests leave spaced out, not that a
   * particular helper exists.
   */
  const at = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    at.push(Date.now());
    return { ok: true, status: 200, json: async () => ({}) };
  };
  try {
    const { tmdb } = await import('./tmdb.mjs');
    const n = 10;
    await Promise.all(Array.from({ length: n }, () => tmdb('/configuration')));

    assert.equal(at.length, n, `${at.length} requests left for ${n} calls`);
    const span = Math.max(...at) - Math.min(...at);
    /* Ten calls at 25ms apart span about 225ms. Anything near zero means they
       all left together, which is the failure this guards. Generous lower
       bound so a slow CI runner cannot fail it for being slow. */
    assert.ok(span > 120, `ten concurrent calls left within ${span}ms of each other`);
  } finally {
    globalThis.fetch = realFetch;
  }
});
