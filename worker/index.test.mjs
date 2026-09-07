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