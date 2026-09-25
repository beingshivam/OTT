/**
 * Exercises the subscribe endpoint against a fake D1 and a fake asset server.
 *
 * This code runs on Cloudflare and nowhere else, which meant it had never been
 * executed at all — it was written, committed, and would first have run against
 * real visitors and a real database. The handler is a plain fetch(request, env)
 * function, so the whole of it can be driven from node with two stubs and no
 * wrangler, no credentials and no network.
 *
 * Run: node worker/index.test.mjs
 */

import assert from 'node:assert/strict';
import worker, { lastDueSlot } from './index.js';

const ORIGIN = 'https://newonott.in';

/** Records what it was asked to store, and can be told to fail. */
function fakeDB({ throws = false } = {}) {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async run() {
              if (throws) throw new Error('D1 unavailable');
              calls.push({ sql: sql.replace(/\s+/g, ' ').trim(), args });
              return { success: true };
            },
          };
        },
      };
    },
  };
}

const fakeAssets = {
  fetched: [],
  async fetch(request) {
    this.fetched.push(new URL(request.url).pathname);
    return new Response('the board', { status: 200 });
  },
};

const post = (body, { headers = {}, method = 'POST', path = '/api/subscribe' } = {}) =>
  new Request(`${ORIGIN}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: method === 'GET' ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });

const results = [];
async function test(name, fn) {
  try {
    await fn();
    results.push(`  ok   ${name}`);
  } catch (err) {
    results.push(`  FAIL ${name}\n       ${err.message}`);
    process.exitCode = 1;
  }
}

// --- everything that is not the endpoint goes to the assets -----------------

await test('a page request is handed to the asset server untouched', async () => {
  const assets = { ...fakeAssets, fetched: [] };
  const res = await worker.fetch(new Request(`${ORIGIN}/netflix`), { ASSETS: assets });
  assert.equal(res.status, 200);
  assert.deepEqual(assets.fetched, ['/netflix']);
});

await test('a deep page path is handed over too', async () => {
  const assets = { ...fakeAssets, fetched: [] };
  await worker.fetch(new Request(`${ORIGIN}/ott-release-date/mirzapur-the-movie`), { ASSETS: assets });
  assert.deepEqual(assets.fetched, ['/ott-release-date/mirzapur-the-movie']);
});

// --- the welcome email -------------------------------------------------------

/**
 * What a new subscriber gets immediately, and everything that must not happen
 * when it goes wrong.
 *
 * The rule under all of these: the row is the product, the email is best
 * effort. Brevo being slow, broken, unconfigured or absent may cost the
 * welcome mail and must never cost the subscription — the reader has already
 * been told they are on the list, and they are.
 */

/** Collects what waitUntil was handed so a test can await the send. */
function fakeCtx() {
  const pending = [];
  return { waitUntil: (p) => pending.push(p), settle: () => Promise.all(pending) };
}

/** Serves the digest the build copies into /email/. */
const emailAssets = (files) => ({
  fetched: [],
  async fetch(request) {
    const name = new URL(request.url).pathname.split('/').pop();
    this.fetched.push(name);
    const body = files[name];
    return body == null
      ? new Response('nope', { status: 404 })
      : new Response(body, { status: 200 });
  },
});

const DIGEST = {
  'latest.html': '<p>Mirzapur: The Movie is out.</p><p>{{ unsubscribe }}</p>',
  'latest.txt': 'Mirzapur: The Movie is out.\n{{ unsubscribe }}',
  'subject.txt': '4-10 Sep: Mirzapur and 31 more\n',
};

/** Captures the Brevo call without making one. */
function captureBrevo(response = new Response('{"messageId":"x"}', { status: 201 })) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return response;
  };
  return calls;
}

await test('a new subscriber is sent this week\'s digest', async () => {
  const calls = captureBrevo();
  const ctx = fakeCtx();
  const res = await worker.fetch(post({ email: 'Reader@Example.com' }), {
    DB: fakeDB(),
    ASSETS: emailAssets(DIGEST),
    BREVO_API_KEY: 'test-key',
  }, ctx);
  assert.equal(res.status, 200);
  await ctx.settle();

  assert.equal(calls.length, 1, 'exactly one send');
  const [call] = calls;
  assert.equal(call.url, 'https://api.brevo.com/v3/smtp/email');
  assert.equal(call.init.headers['api-key'], 'test-key');
  const body = JSON.parse(call.init.body);
  // The address as typed, not the lowercased key — mail servers may treat the
  // local part as case-sensitive.
  assert.deepEqual(body.to, [{ email: 'Reader@Example.com' }]);
  assert.equal(body.subject, '4-10 Sep: Mirzapur and 31 more', 'subject is trimmed');
  assert.match(body.htmlContent, /Mirzapur/);
  assert.ok(body.headers['List-Unsubscribe'], 'inbox-level unsubscribe is offered');
});

await test('the unsubscribe placeholder never reaches an inbox', async () => {
  // Shipping "{{ unsubscribe }}" literally is worse than having no unsubscribe.
  const calls = captureBrevo();
  const ctx = fakeCtx();
  await worker.fetch(post({ email: 'a@b.co' }), {
    DB: fakeDB(),
    ASSETS: emailAssets(DIGEST),
    BREVO_API_KEY: 'k',
  }, ctx);
  await ctx.settle();
  const body = JSON.parse(calls[0].init.body);
  assert.ok(!body.htmlContent.includes('{{'), `token left in html: ${body.htmlContent}`);
  assert.ok(!body.textContent.includes('{{'), `token left in text: ${body.textContent}`);
  assert.match(body.htmlContent, /stop/i, 'and says how to opt out');
});

await test('no API key means no send, and still a successful signup', async () => {
  const calls = captureBrevo();
  const ctx = fakeCtx();
  const res = await worker.fetch(post({ email: 'a@b.co' }), {
    DB: fakeDB(),
    ASSETS: emailAssets(DIGEST),
  }, ctx);
  assert.equal(res.status, 200);
  await ctx.settle();
  assert.equal(calls.length, 0);
});

await test('a deploy with no digest sends nothing rather than an empty mail', async () => {
  const calls = captureBrevo();
  const ctx = fakeCtx();
  const res = await worker.fetch(post({ email: 'a@b.co' }), {
    DB: fakeDB(),
    ASSETS: emailAssets({}),
    BREVO_API_KEY: 'k',
  }, ctx);
  assert.equal(res.status, 200);
  await ctx.settle();
  assert.equal(calls.length, 0);
});

await test('Brevo refusing the send does not fail the subscription', async () => {
  captureBrevo(new Response('{"code":"unauthorized"}', { status: 401 }));
  const ctx = fakeCtx();
  const res = await worker.fetch(post({ email: 'a@b.co' }), {
    DB: fakeDB(),
    ASSETS: emailAssets(DIGEST),
    BREVO_API_KEY: 'wrong',
  }, ctx);
  assert.equal(res.status, 200);
  await ctx.settle(); // must not reject
});

await test('Brevo being unreachable does not fail the subscription', async () => {
  globalThis.fetch = async () => {
    throw new TypeError('fetch failed');
  };
  const ctx = fakeCtx();
  const res = await worker.fetch(post({ email: 'a@b.co' }), {
    DB: fakeDB(),
    ASSETS: emailAssets(DIGEST),
    BREVO_API_KEY: 'k',
  }, ctx);
  assert.equal(res.status, 200);
  await ctx.settle();
});

await test('a runtime that passes no ctx still stores the address', async () => {
  // Optional-chaining guard: no welcome mail, but never a 500 on a stored row.
  captureBrevo();
  const res = await worker.fetch(post({ email: 'a@b.co' }), {
    DB: fakeDB(),
    ASSETS: emailAssets(DIGEST),
    BREVO_API_KEY: 'k',
  });
  assert.equal(res.status, 200);
});

// --- one casing per page ----------------------------------------------------

/**
 * /THEATRES used to answer 200 with the SPA fallback, whose canonical points at
 * the homepage — a crawlable URL serving a document claiming to be a different
 * one. These pin the redirect and, more importantly, pin the exception: poster
 * filenames are case-sensitive, so lowercasing an /img/ path would 404 every
 * poster on the site.
 */

await test('an uppercase path is redirected to its lowercase form', async () => {
  const assets = { ...fakeAssets, fetched: [] };
  const res = await worker.fetch(new Request(`${ORIGIN}/THEATRES`), { ASSETS: assets });
  assert.equal(res.status, 301);
  assert.equal(res.headers.get('location'), `${ORIGIN}/theatres`);
  assert.deepEqual(assets.fetched, [], 'the asset server should not have been asked');
});

await test('mixed case anywhere in the path redirects', async () => {
  const res = await worker.fetch(
    new Request(`${ORIGIN}/ott-release-date/Sardar-2`),
    { ASSETS: { ...fakeAssets, fetched: [] } },
  );
  assert.equal(res.status, 301);
  assert.equal(res.headers.get('location'), `${ORIGIN}/ott-release-date/sardar-2`);
});

await test('the query string survives the redirect', async () => {
  const res = await worker.fetch(new Request(`${ORIGIN}/Netflix?w=2026-09-04`), {
    ASSETS: { ...fakeAssets, fetched: [] },
  });
  assert.equal(res.headers.get('location'), `${ORIGIN}/netflix?w=2026-09-04`);
});

await test('a hashed bundle keeps its capitals', async () => {
  // The regression that took the site down: Vite names bundles like
  // index-CqG28YpW.js. Lowercasing one sends it to a path that does not exist,
  // the SPA fallback answers with index.html, and the browser refuses to
  // execute HTML as JavaScript.
  const assets = { ...fakeAssets, fetched: [] };
  const res = await worker.fetch(new Request(`${ORIGIN}/assets/index-CqG28YpW.js`), {
    ASSETS: assets,
  });
  assert.notEqual(res.status, 301, 'a bundle must never be redirected');
  assert.deepEqual(assets.fetched, ['/assets/index-CqG28YpW.js'], 'casing must reach the asset server intact');
});

await test('any dotted path keeps its capitals', async () => {
  for (const path of ['/Build.txt', '/Sitemap.xml', '/assets/Index-AbC.css']) {
    const assets = { ...fakeAssets, fetched: [] };
    const res = await worker.fetch(new Request(`${ORIGIN}${path}`), { ASSETS: assets });
    assert.notEqual(res.status, 301, `${path} should not redirect`);
    assert.deepEqual(assets.fetched, [path]);
  }
});

await test('an already-lowercase path is not redirected', async () => {
  const assets = { ...fakeAssets, fetched: [] };
  const res = await worker.fetch(new Request(`${ORIGIN}/theatres`), { ASSETS: assets });
  assert.equal(res.status, 200);
  assert.deepEqual(assets.fetched, ['/theatres']);
});

await test('a poster path keeps its capitals', async () => {
  // The one case that must never be lowercased: TMDB filenames are
  // case-sensitive, and this branch runs before the redirect for that reason.
  let asked = null;
  globalThis.fetch = async (req) => {
    asked = typeof req === 'string' ? req : req.url;
    return new Response('jpeg', { status: 200, headers: { 'content-type': 'image/jpeg' } });
  };
  const res = await worker.fetch(
    new Request(`${ORIGIN}/img/w500/5PJNeckEmOcMVh8xT4YVjdUf5nj.jpg`),
    { ASSETS: { ...fakeAssets, fetched: [] } },
  );
  assert.notEqual(res.status, 301, 'a poster path must not be redirected');
  assert.ok(
    asked && asked.includes('5PJNeckEmOcMVh8xT4YVjdUf5nj.jpg'),
    `upstream should have kept the original casing, asked for: ${asked}`,
  );
});

// --- the endpoint's guards ---------------------------------------------------

await test('GET on the endpoint is rejected, not passed to assets', async () => {
  const assets = { ...fakeAssets, fetched: [] };
  const res = await worker.fetch(post(null, { method: 'GET' }), { ASSETS: assets, DB: fakeDB() });
  assert.equal(res.status, 405);
  assert.deepEqual(assets.fetched, []);
});

await test('a cross-site Origin is refused', async () => {
  const res = await worker.fetch(
    post({ email: 'a@b.co' }, { headers: { origin: 'https://evil.example' } }),
    { DB: fakeDB() },
  );
  assert.equal(res.status, 403);
});

await test('our own Origin is accepted', async () => {
  const db = fakeDB();
  const res = await worker.fetch(post({ email: 'a@b.co' }, { headers: { origin: ORIGIN } }), { DB: db });
  assert.equal(res.status, 200);
  assert.equal(db.calls.length, 1);
});

await test('no database bound answers 503 rather than pretending', async () => {
  const res = await worker.fetch(post({ email: 'a@b.co' }), {});
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error, 'not_configured');
});

await test('a body that is not JSON is refused', async () => {
  const res = await worker.fetch(post('not json at all'), { DB: fakeDB() });
  assert.equal(res.status, 400);
});

await test('an oversized body is refused before it is parsed', async () => {
  const res = await worker.fetch(post(`{"email":"${'a'.repeat(4000)}@b.co"}`), { DB: fakeDB() });
  assert.equal(res.status, 413);
});

await test('addresses that are not addresses are refused', async () => {
  for (const bad of ['', '   ', 'nope', 'a@b', '@b.co', 'a b@c.co', 'a@b.']) {
    const res = await worker.fetch(post({ email: bad }), { DB: fakeDB() });
    assert.equal(res.status, 400, `expected 400 for ${JSON.stringify(bad)}`);
  }
});

await test('a 300-character address is refused', async () => {
  const res = await worker.fetch(post({ email: `${'a'.repeat(290)}@b.co` }), { DB: fakeDB() });
  assert.equal(res.status, 400);
});

// --- the happy paths ---------------------------------------------------------

await test('a valid address is stored, lowercased, with the original kept', async () => {
  const db = fakeDB();
  const res = await worker.fetch(post({ email: '  Shivam.A@Example.CO  ' }), { DB: db });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  const [key, original] = db.calls[0].args;
  assert.equal(key, 'shivam.a@example.co');
  assert.equal(original, 'Shivam.A@Example.CO');
});

await test('email_address is read too, since the form sends both names', async () => {
  const db = fakeDB();
  const res = await worker.fetch(post({ email_address: 'kit@example.co' }), { DB: db });
  assert.equal(res.status, 200);
  assert.equal(db.calls[0].args[0], 'kit@example.co');
});

await test('the insert ignores duplicates rather than erroring', async () => {
  const db = fakeDB();
  await worker.fetch(post({ email: 'a@b.co' }), { DB: db });
  assert.match(db.calls[0].sql, /INSERT OR IGNORE INTO subscribers/);
});

await test('a database failure is a 500, not a silent success', async () => {
  const res = await worker.fetch(post({ email: 'a@b.co' }), { DB: fakeDB({ throws: true }) });
  assert.equal(res.status, 500);
});

await test('responses are never cached', async () => {
  const res = await worker.fetch(post({ email: 'a@b.co' }), { DB: fakeDB() });
  assert.equal(res.headers.get('cache-control'), 'no-store');
});


/* ------------------------------------------------------------ poster proxy ---- */

/**
 * The image proxy exists so the share card's canvas can be read back, and the
 * only thing that makes it safe is being unable to fetch anything but a TMDB
 * image path. Most of what follows is that refusal.
 */

/** Stands in for image.tmdb.org, recording what was asked of it. */
function fakeUpstream({ status = 200 } = {}) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), method: init?.method });
    return new Response(status === 200 ? new Uint8Array([1, 2, 3]) : null, {
      status,
      headers: { 'content-type': 'image/jpeg' },
    });
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

const img = (path, init) => worker.fetch(new Request(`${ORIGIN}${path}`, init), {});

await test('serves a TMDB poster from our own origin', async () => {
  const up = fakeUpstream();
  try {
    const res = await img('/img/w342/abcdefgh12345678.jpg');
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/jpeg');
    assert.match(res.headers.get('cache-control'), /immutable/);
    assert.equal(up.calls[0].url, 'https://image.tmdb.org/t/p/w342/abcdefgh12345678.jpg');
  } finally {
    up.restore();
  }
});

/**
 * The property that matters is that none of these reach TMDB — not which of the
 * two ways they are stopped.
 *
 * Traversal attempts are normalised away by the URL parser before the worker
 * sees them: "/img/../../etc/passwd" arrives as "/etc/passwd", never matches the
 * /img/ prefix, and is handed to the asset server like any other unknown path.
 * The first version of this test asserted a 404 from the proxy and failed on
 * exactly those cases, which was the test being wrong about where the defence
 * sits rather than the defence being missing. So assert the invariant instead:
 * whatever route it takes, nothing is fetched upstream.
 */
await test('never becomes an open proxy', async () => {
  const up = fakeUpstream();
  const env = { ASSETS: { ...fakeAssets, fetched: [] } };
  try {
    for (const path of [
      '/img/../../etc/passwd',
      '/img/w342/../../secret.jpg',
      '/img/w342/evil.jpg/../../x',
      '/img/http://example.com/x.jpg',
      '/img/w342/x.svg%00.jpg',
      '/img/notasize/abcdefgh12345678.jpg',
      '/img/w342/short.jpg',
      '/img/w342/abcdefgh12345678.exe',
      '/img/w342/abcdefgh12345678',
      '/img/w342/a'.padEnd(200, 'b') + '.jpg',
    ]) {
      const res = await worker.fetch(new Request(`${ORIGIN}${path}`), env);
      assert.ok(res.status !== 200 || !res.headers.get('content-type')?.startsWith('image/'),
        `${path} came back as an image`);
    }
    assert.equal(up.calls.length, 0, `fetched upstream: ${up.calls.map((c) => c.url).join(', ')}`);
  } finally {
    up.restore();
  }
});

await test('refuses anything but a read', async () => {
  const up = fakeUpstream();
  try {
    const res = await img('/img/w342/abcdefgh12345678.jpg', { method: 'POST' });
    assert.equal(res.status, 405);
    assert.equal(up.calls.length, 0);
  } finally {
    up.restore();
  }
});

await test('passes a missing poster through as missing', async () => {
  const up = fakeUpstream({ status: 404 });
  try {
    assert.equal((await img('/img/w342/abcdefgh12345678.jpg')).status, 404);
  } finally {
    up.restore();
  }
});

await test('reports an upstream failure as a gateway error, not as an image', async () => {
  const up = fakeUpstream({ status: 500 });
  try {
    assert.equal((await img('/img/w342/abcdefgh12345678.jpg')).status, 502);
  } finally {
    up.restore();
  }
});

await test('the query string is not forwarded', async () => {
  const up = fakeUpstream();
  try {
    await img('/img/w342/abcdefgh12345678.jpg?api_key=leak');
    assert.ok(!up.calls[0].url.includes('api_key'), up.calls[0].url);
  } finally {
    up.restore();
  }
});

/**
 * The watchdog's clock.
 *
 * Worth testing rather than eyeballing, because both ways of being wrong are
 * silent. Too eager and it emails every week about a refresh that ran fine,
 * which teaches the owner to ignore it — the same silence it exists to end.
 * Too lax and it never fires, which is where this started: a refresh that did
 * not happen looked exactly like one that did, for four days.
 */
const at = (iso) => new Date(iso);

await test('a slot inside its grace period is late, not missing', async () => {
  /*
   * Friday 09:30. The 08:30 slot is an hour old and well inside the grace, so
   * it is not the one to measure against — GitHub running late is not a reason
   * to email anybody, and on this repo it always runs late: 4h13m, 4h24m and
   * 5h19m on the three scheduled runs measured, which is why the grace is six
   * hours rather than the three a single early sample suggested.
   *
   * The 00:00 slot is nine and a half hours old, so that is the one a missing
   * build would be measured against.
   */
  const due = lastDueSlot(at('2026-09-11T09:30:00Z'));
  assert.equal(due.toISOString(), '2026-09-11T00:00:00.000Z');
});

await test('past its grace period, the slot is the one to measure against', async () => {
  /*
   * Friday 15:00, by which point the 08:30 slot is six and a half hours old and
   * has run out of excuses. Deliberately a different hour from the test above:
   * the two together pin both sides of the grace boundary, and with two Friday
   * slots now they would otherwise both land on the same answer and test one
   * thing twice.
   */
  const due = lastDueSlot(at('2026-09-11T15:00:00Z'));
  assert.equal(due.toISOString(), '2026-09-11T08:30:00.000Z');
});

await test('Saturday measures against Saturday', async () => {
  const due = lastDueSlot(at('2026-09-12T12:00:00Z'));
  assert.equal(due.toISOString(), '2026-09-12T04:30:00.000Z');
});

await test('every day measures against its own morning slot', async () => {
  /*
   * These three assertions used to encode the week's quiet days: Sunday and
   * Monday measured against Saturday, Thursday still measured against Monday,
   * and the comment explained that "nothing is scheduled between Monday and
   * Friday". Something is now — there is a 04:30 run every day the three
   * original slots do not cover, so a feed built on Monday is no longer
   * correct on Thursday and the watchdog should say so.
   *
   * What is being tested has not changed: the last slot that has come due is
   * the one a staleness alarm measures against.
   */
  assert.equal(lastDueSlot(at('2026-09-13T12:00:00Z')).toISOString(), '2026-09-13T04:30:00.000Z');
  assert.equal(lastDueSlot(at('2026-09-15T12:00:00Z')).toISOString(), '2026-09-15T04:30:00.000Z');
  assert.equal(lastDueSlot(at('2026-09-17T12:00:00Z')).toISOString(), '2026-09-17T04:30:00.000Z');
});

await test('Monday noon still measures against Sunday', async () => {
  /*
   * Monday is the one day with no morning run — its slot is 13:30, kept there
   * because it is the run that picks up the weekend's corrections. So at noon
   * the last slot that has come due is Sunday's, and a feed built on Sunday is
   * correct: expecting Monday's output before Monday has run is precisely the
   * false alarm this function exists to prevent.
   *
   * Asserted because I got it wrong writing the test above this one, claiming
   * Monday had a 04:30 slot it does not have. The schedule is easier to
   * misremember than to read.
   */
  assert.equal(lastDueSlot(at('2026-09-14T12:00:00Z')).toISOString(), '2026-09-13T04:30:00.000Z');
  assert.equal(lastDueSlot(at('2026-09-14T23:00:00Z')).toISOString(), '2026-09-14T13:30:00.000Z');
});

/*
 * One path per page, without a trailing slash.
 *
 * Search Console, 4-14 September, listed /theatres and /theatres/ as separate
 * rows — 39 impressions against 21 — for one page, because the asset server
 * answers both with the same file and Google indexed each. The canonical said
 * /theatres throughout and was ignored, which is what canonicals do when both
 * URLs return 200: a hint loses to two live pages, a redirect does not.
 */
await test('a trailing slash redirects to the one canonical path', async () => {
  const assets = { ...fakeAssets, fetched: [] };
  const res = await worker.fetch(new Request(`${ORIGIN}/theatres/`), { ASSETS: assets });
  assert.equal(res.status, 301);
  assert.equal(res.headers.get('location'), `${ORIGIN}/theatres`);
  assert.deepEqual(assets.fetched, [], 'the asset server should not have been asked');
});

await test('the query string survives a trailing-slash redirect', async () => {
  const res = await worker.fetch(new Request(`${ORIGIN}/netflix/?r=IN`), { ASSETS: fakeAssets });
  assert.equal(res.headers.get('location'), `${ORIGIN}/netflix?r=IN`);
});

await test('the root keeps its slash, being the one path that is only a slash', async () => {
  const assets = { ...fakeAssets, fetched: [] };
  const res = await worker.fetch(new Request(`${ORIGIN}/`), { ASSETS: assets });
  assert.notEqual(res.status, 301, 'the homepage must not redirect to the empty path');
  assert.equal(assets.fetched.length, 1, 'it should be served, not bounced');
});

await test('a capitalised path with a trailing slash ends up lowercase and slashless', async () => {
  // Two rules in a row: the casing redirect fires first and the next request
  // hits the slash rule. Worth pinning, because a rule that redirects to
  // something the other rule also redirects is how a loop starts.
  const first = await worker.fetch(new Request(`${ORIGIN}/Theatres/`), { ASSETS: fakeAssets });
  assert.equal(first.status, 301);
  const second = await worker.fetch(new Request(first.headers.get('location')), { ASSETS: fakeAssets });
  assert.equal(second.status, 301);
  assert.equal(second.headers.get('location'), `${ORIGIN}/theatres`);
  const third = await worker.fetch(new Request(second.headers.get('location')), { ASSETS: fakeAssets });
  assert.notEqual(third.status, 301, 'three hops means a loop');
});

/*
 * Printed on exit rather than here, because "here" has been wrong twice.
 *
 * This was a pair of console.logs at the end of the file, and twice now a
 * batch of tests has been appended below them — passing, uncounted, invisible.
 * The first time it printed 41 lines under a tally of 45 and the fix was to
 * move the printer. It was the same fix as moving a deckchair: the next person
 * to append tests hit it again, which is this comment's whole reason for
 * existing.
 *
 * An exit handler cannot be appended past. The trap is gone rather than
 * relocated.
 */
process.on('exit', () => {
  console.log(results.join('\n'));
  console.log(process.exitCode ? '\nsome checks failed' : `\n${results.length} checks passed`);
});

/*
 * Search, which is the first thing this Worker answers that it is allowed to
 * cache and the first that reaches a third party on a reader's behalf.
 *
 * The cases that matter are the dishonest ones: claiming a corpus it cannot
 * reach, and turning a TMDB outage into a broken search box rather than a
 * smaller one.
 */
const ctx = { waitUntil() {} };

/** caches.default does not exist outside Workers; this is enough of it. */
function fakeCache() {
  const store = new Map();
  globalThis.caches = {
    default: {
      async match(req) {
        const hit = store.get(req.url);
        return hit ? hit.clone() : undefined;
      },
      async put(req, res) {
        store.set(req.url, res.clone());
      },
    },
  };
  return store;
}

await test('with no token, search says so rather than pretending', async () => {
  // The front end reads `remote` to decide whether it may print "1M+ titles".
  // A placeholder promising a million over a search of nine hundred is the
  // lie this flag exists to prevent.
  fakeCache();
  const res = await worker.fetch(new Request(`${ORIGIN}/api/search?q=rajini`), {}, ctx);
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.remote, false);
  assert.deepEqual(body.results, []);
});

await test('an empty query is a capability probe, and costs no upstream call', async () => {
  fakeCache();
  let called = 0;
  globalThis.fetch = async () => {
    called++;
    return { ok: true, json: async () => ({ results: [] }) };
  };
  const res = await worker.fetch(new Request(`${ORIGIN}/api/search?q=`), { TMDB_TOKEN: 't' }, ctx);
  const body = await res.json();
  assert.equal(body.remote, true, 'it reports the capability');
  assert.equal(called, 0, 'and asks TMDB nothing');
});

await test('results are trimmed to what a row draws', async () => {
  fakeCache();
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      total_results: 1240,
      results: [
        { media_type: 'movie', id: 11, title: 'Coolie', release_date: '2026-08-14',
          poster_path: '/a.jpg', original_language: 'ta', overview: 'x'.repeat(900), popularity: 9 },
        { media_type: 'person', id: 22, name: 'Rajinikanth', profile_path: '/p.jpg',
          known_for_department: 'Acting', known_for: [{ title: 'Muthu' }, { name: 'Enthiran' }] },
        { media_type: 'collection', id: 33, name: 'Ignore me' },
      ],
    }),
  });
  const res = await worker.fetch(new Request(`${ORIGIN}/api/search?q=coolie`), { TMDB_TOKEN: 't' }, ctx);
  const body = await res.json();

  assert.equal(body.total, 1240);
  assert.equal(body.results.length, 2, 'a collection is neither a title nor a person');
  const [film, person] = body.results;
  assert.deepEqual(film, {
    kind: 'film', id: 'm-11', title: 'Coolie', year: '2026', image: '/img/w185/a.jpg', lang: 'ta',
  });
  assert.equal(JSON.stringify(film).includes('overview'), false, 'the 900-byte synopsis is dropped');
  assert.equal(person.kind, 'person');
  assert.equal(person.id, 'p-22');
  assert.deepEqual(person.knownFor, ['Muthu', 'Enthiran']);
});

await test('the id shape matches the feed, so a remote hit can be matched to a local row', async () => {
  // Without this the same film appears twice — once from the calendar and once
  // from TMDB — which reads as a bug and wastes the row that could have said
  // where to watch it.
  fakeCache();
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ results: [{ media_type: 'tv', id: 77, name: 'Show', first_air_date: '2026-01-02' }] }),
  });
  const res = await worker.fetch(new Request(`${ORIGIN}/api/search?q=show`), { TMDB_TOKEN: 't' }, ctx);
  const [row] = (await res.json()).results;
  assert.equal(row.id, 't-77');
  assert.equal(row.kind, 'series');
});

await test('a TMDB outage shrinks the search instead of breaking it', async () => {
  // The local half has already rendered by the time this returns. An error
  // here would replace useful results with a message nobody can act on.
  fakeCache();
  globalThis.fetch = async () => {
    throw new Error('network');
  };
  const res = await worker.fetch(new Request(`${ORIGIN}/api/search?q=x`), { TMDB_TOKEN: 't' }, ctx);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.degraded, true);
  assert.deepEqual(body.results, []);
});

await test('a repeated query is served from the edge, not from TMDB', async () => {
  fakeCache();
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return { ok: true, json: async () => ({ results: [{ media_type: 'movie', id: 1, title: 'A' }] }) };
  };
  const env = { TMDB_TOKEN: 't' };
  await worker.fetch(new Request(`${ORIGIN}/api/search?q=Kantara`), env, ctx);
  await worker.fetch(new Request(`${ORIGIN}/api/search?q=kantara`), env, ctx);
  assert.equal(calls, 1, 'case differs, the query does not');
});

await test('the watchdog says whether search has a credential, without saying what it is', async () => {
  /*
   * The one way to find out. Search degrades quietly by design — a Worker with
   * no TMDB binding returns an honest empty half and the box drops its "1M+"
   * claim — so a secret that was never added looks exactly like a search that
   * found nothing. The token is bound to Actions for the refresh and has to be
   * bound here separately, which is precisely the step that gets missed.
   */
  const withToken = await (
    await worker.fetch(new Request(`${ORIGIN}/api/watchdog`), { TMDB_TOKEN: 'secret-value' }, ctx)
  ).json();
  const without = await (await worker.fetch(new Request(`${ORIGIN}/api/watchdog`), {}, ctx)).json();

  assert.equal(withToken.searchable, true);
  assert.equal(without.searchable, false);
  assert.ok(
    !JSON.stringify(withToken).includes('secret-value'),
    'it reports that the binding exists, never its contents',
  );
});

await test('search is a GET', async () => {
  fakeCache();
  const res = await worker.fetch(new Request(`${ORIGIN}/api/search?q=a`, { method: 'POST' }), {}, ctx);
  assert.equal(res.status, 405);
});

/*
 * ---------------------------------------------------------------------------
 * Getting nothing out of a million titles
 *
 * Measured against the live index rather than imagined: TMDB's /search/multi
 * needs every token to land, and one it does not know returns nothing at all
 * rather than fewer rows.
 *
 *   jawan   65 results | jawan movie  nothing
 *   coolie  27 results | coolie 2025  nothing
 *
 * So the commonest way to miss is to type the word "movie" after the name.
 */

await test('the words people add to a title do not erase it', async () => {
  fakeCache();
  const asked = [];
  globalThis.fetch = async (u) => {
    const q = new URL(u).searchParams.get('query');
    asked.push(q);
    return {
      ok: true,
      json: async () => ({
        total_results: q === 'jawan' ? 65 : 0,
        results: q === 'jawan' ? [{ media_type: 'movie', id: 1, title: 'Jawan' }] : [],
      }),
    };
  };
  const res = await worker.fetch(new Request(`${ORIGIN}/api/search?q=jawan%20movie`), { TMDB_TOKEN: 't' }, ctx);
  const body = await res.json();
  assert.deepEqual(asked, ['jawan movie', 'jawan'], `asked: ${asked.join(' | ')}`);
  assert.equal(body.results[0].title, 'Jawan');
  assert.equal(body.relaxedTo, 'jawan', 'the reader is not told which query answered');
});

await test('a year the reader added is not part of the title either', async () => {
  fakeCache();
  const asked = [];
  globalThis.fetch = async (u) => {
    const q = new URL(u).searchParams.get('query');
    asked.push(q);
    return { ok: true, json: async () => ({ results: q === 'coolie' ? [{ media_type: 'movie', id: 2, title: 'Coolie' }] : [] }) };
  };
  const res = await worker.fetch(new Request(`${ORIGIN}/api/search?q=coolie%202025`), { TMDB_TOKEN: 't' }, ctx);
  assert.deepEqual(asked, ['coolie 2025', 'coolie']);
  assert.equal((await res.json()).results[0].title, 'Coolie');
});

await test('the distinctive word carries a half-remembered title', async () => {
  // "pyar ka punchnama" finds nothing and "punchnama" finds the film. The
  // longest word is the one worth asking for on its own.
  fakeCache();
  const asked = [];
  globalThis.fetch = async (u) => {
    const q = new URL(u).searchParams.get('query');
    asked.push(q);
    return { ok: true, json: async () => ({ results: q === 'punchnama' ? [{ media_type: 'movie', id: 3, title: 'Pyaar Ka Punchnama' }] : [] }) };
  };
  const res = await worker.fetch(new Request(`${ORIGIN}/api/search?q=pyar%20ka%20punchnama`), { TMDB_TOKEN: 't' }, ctx);
  assert.deepEqual(asked, ['pyar ka punchnama', 'punchnama']);
  assert.equal((await res.json()).relaxedTo, 'punchnama');
});

await test('a query that works costs exactly one call', async () => {
  // The fallbacks are for misses. Paying for them on every search would make
  // the common case slower to rescue the uncommon one.
  fakeCache();
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return { ok: true, json: async () => ({ results: [{ media_type: 'movie', id: 4, title: 'Kantara' }] }) };
  };
  const res = await worker.fetch(new Request(`${ORIGIN}/api/search?q=kantara`), { TMDB_TOKEN: 't' }, ctx);
  assert.equal(calls, 1);
  assert.equal((await res.json()).relaxedTo, undefined, 'an untouched query claims no relaxation');
});

await test('an outage is not retried three ways and called "nothing matched"', async () => {
  // The difference that matters: TMDB saying no, and TMDB not answering. The
  // second must still reach the reader as degraded rather than as an empty
  // result they would read as "this site does not have it".
  fakeCache();
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error('network');
  };
  const res = await worker.fetch(new Request(`${ORIGIN}/api/search?q=jawan%20movie`), { TMDB_TOKEN: 't' }, ctx);
  const body = await res.json();
  assert.equal(calls, 1, 'an unreachable TMDB was asked again');
  assert.equal(body.degraded, true);
});

await test('a genuine miss is still a miss, and is cached as one', async () => {
  fakeCache();
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ results: [] }) });
  const res = await worker.fetch(new Request(`${ORIGIN}/api/search?q=zzzz%20qqqq`), { TMDB_TOKEN: 't' }, ctx);
  const body = await res.json();
  assert.equal(body.remote, true);
  assert.deepEqual(body.results, []);
  assert.equal(body.degraded, undefined, 'a miss is not an outage');
});

/*
 * ---------------------------------------------------------------------------
 * One title, for the sheet a search result now opens
 *
 * The row for a film TMDB has and this calendar does not used to be inert,
 * because there was nowhere to send anybody. A sheet is not a page — not
 * crawled, not indexed, not linked — so search can answer rather than only
 * acknowledge, and "publishing stays earned" survives intact.
 *
 * What makes it worth opening is the providers, not the cast.
 */

const TITLE_BODY = {
  id: 278,
  title: 'The Shawshank Redemption',
  release_date: '1994-09-23',
  overview: 'Two imprisoned men bond over a number of years.',
  poster_path: '/p.jpg',
  backdrop_path: '/b.jpg',
  runtime: 142,
  vote_average: 8.7,
  vote_count: 27000,
  genres: [{ name: 'Drama' }, { name: 'Crime' }],
  original_language: 'en',
  credits: {
    cast: Array.from({ length: 20 }, (_, i) => ({ name: `Actor ${i}` })),
    crew: [{ job: 'Producer', name: 'Someone' }, { job: 'Director', name: 'Frank Darabont' }],
  },
  release_dates: {
    results: [
      { iso_3166_1: 'US', release_dates: [{ certification: 'R' }] },
      { iso_3166_1: 'IN', release_dates: [{ certification: '' }, { certification: 'A' }] },
    ],
  },
  'watch/providers': {
    results: {
      IN: { flatrate: [{ provider_id: 8 }], rent: [{ provider_id: 9 }] },
      US: { flatrate: [{ provider_id: 15 }] },
    },
  },
};

await test('a search result opens into something worth opening', async () => {
  fakeCache();
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => TITLE_BODY });
  const res = await worker.fetch(new Request(`${ORIGIN}/api/title?id=m-278`), { TMDB_TOKEN: 't' }, ctx);
  const b = await res.json();

  assert.equal(b.title, 'The Shawshank Redemption');
  assert.equal(b.year, '1994');
  assert.equal(b.kind, 'film');
  assert.equal(b.director, 'Frank Darabont', 'the director is found among the crew, not assumed first');
  assert.equal(b.cast.length, 8, 'twenty names is a credits page, not a sheet');
  assert.equal(b.runtimeMinutes, 142);
  assert.equal(b.rating, 8.7);
  assert.equal(b.certification, 'A', 'the Indian certificate, and not the blank one before it');
  assert.equal(b.posterUrl, '/img/w500/p.jpg', 'artwork goes through the proxy, not to image.tmdb.org');
});

await test('only India is offered, because only India is the answer', async () => {
  // Telling a reader in Chennai that a film is on a service they cannot get
  // is worse than telling them nothing, because it reads as an answer.
  fakeCache();
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => TITLE_BODY });
  const res = await worker.fetch(new Request(`${ORIGIN}/api/title?id=m-278`), { TMDB_TOKEN: 't' }, ctx);
  const b = await res.json();
  assert.deepEqual(b.providerIds, [8], 'a US provider reached an Indian reader');
  assert.deepEqual(b.rentBuyIds, [9], 'renting is a different offer from streaming and is kept apart');
});

await test('a series is asked the questions a series has answers to', async () => {
  fakeCache();
  let asked = '';
  globalThis.fetch = async (u) => {
    asked = String(u);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        id: 1399, name: 'Show', first_air_date: '2011-04-17', episode_run_time: [62],
        number_of_seasons: 8, created_by: [{ name: 'A Creator' }], credits: {},
        content_ratings: { results: [{ iso_3166_1: 'IN', rating: 'U/A 16+' }] },
        'watch/providers': { results: {} },
      }),
    };
  };
  const res = await worker.fetch(new Request(`${ORIGIN}/api/title?id=t-1399`), { TMDB_TOKEN: 't' }, ctx);
  const b = await res.json();
  assert.ok(asked.includes('/tv/1399'), `asked the film endpoint for a series: ${asked}`);
  assert.ok(asked.includes('content_ratings'), 'a series has no release_dates to rate');
  assert.equal(b.kind, 'series');
  assert.equal(b.seasons, 8);
  assert.equal(b.certification, 'U/A 16+');
  assert.equal(b.director, 'A Creator', 'a series is created, not directed');
  assert.equal(b.runtimeMinutes, 62);
});

await test('a made-up id is refused before it costs a TMDB call', async () => {
  fakeCache();
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return { ok: true, status: 200, json: async () => ({}) }; };
  for (const id of ['', 'x-1', 'm-', 'm-abc', '../secrets', 'm-99999999999999999999']) {
    const res = await worker.fetch(new Request(`${ORIGIN}/api/title?id=${encodeURIComponent(id)}`), { TMDB_TOKEN: 't' }, ctx);
    assert.equal(res.status, 400, `"${id}" was let through`);
  }
  assert.equal(calls, 0, 'a malformed id reached TMDB');
});

await test('a title that does not exist says so, rather than degrading', async () => {
  // 404 and "TMDB is down" want different words on the page, so they must not
  // arrive as the same response.
  fakeCache();
  globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });
  const res = await worker.fetch(new Request(`${ORIGIN}/api/title?id=m-1`), { TMDB_TOKEN: 't' }, ctx);
  assert.equal(res.status, 404);
});

await test('an outage on the title route degrades like the search does', async () => {
  fakeCache();
  globalThis.fetch = async () => { throw new Error('network'); };
  const res = await worker.fetch(new Request(`${ORIGIN}/api/title?id=m-278`), { TMDB_TOKEN: 't' }, ctx);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).degraded, true);
});

await test('the title route is a GET and is cached at the edge', async () => {
  fakeCache();
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return { ok: true, status: 200, json: async () => TITLE_BODY }; };
  await worker.fetch(new Request(`${ORIGIN}/api/title?id=m-278`), { TMDB_TOKEN: 't' }, ctx);
  await worker.fetch(new Request(`${ORIGIN}/api/title?id=m-278`), { TMDB_TOKEN: 't' }, ctx);
  assert.equal(calls, 1, 'the second open went back to TMDB');

  const post = await worker.fetch(
    new Request(`${ORIGIN}/api/title?id=m-278`, { method: 'POST' }), { TMDB_TOKEN: 't' }, ctx,
  );
  assert.equal(post.status, 405);
});
