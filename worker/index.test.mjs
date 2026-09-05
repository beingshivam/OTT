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

console.log(results.join('\n'));
console.log(process.exitCode ? '\nsome checks failed' : `\n${results.length} checks passed`);
