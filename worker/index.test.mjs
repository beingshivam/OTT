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
import worker from './index.js';

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



console.log(results.join('\n'));
console.log(process.exitCode ? '\nsome checks failed' : `\n${results.length} checks passed`);