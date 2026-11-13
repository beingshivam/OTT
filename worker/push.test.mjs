/**
 * worker/push.js against a real SQLite database (node:sqlite) behind the D1
 * call shape, so the SQL that ships is the SQL that is tested.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import {
  dispatch,
  handlePush,
  ottNews,
  resetSchemaCache,
  validEndpoint,
  vapidAuthorization,
  vapidKeys,
} from './push.js';

const ORIGIN = 'https://newonott.in';
const EP = 'https://fcm.googleapis.com/fcm/send/abc123';

function d1() {
  const db = new DatabaseSync(':memory:');
  resetSchemaCache();
  return {
    prepare(sql) {
      const stmt = { args: [] };
      const run = () => db.prepare(sql);
      const api = {
        bind(...args) {
          stmt.args = args;
          return api;
        },
        async run() {
          run().run(...stmt.args);
          return { success: true };
        },
        async first() {
          return run().get(...stmt.args) ?? null;
        },
        async all() {
          return { results: run().all(...stmt.args) };
        },
      };
      return api;
    },
  };
}

const feedOf = (rows) => ({
  async fetch() {
    return new Response(JSON.stringify({ weeks: [{ id: 'w', releases: rows }] }), { status: 200 });
  },
});

const call = (env, path, init = {}) =>
  handlePush(new Request(`${ORIGIN}${path}`, { headers: { origin: ORIGIN }, ...init }), new URL(`${ORIGIN}${path}`), env);
const post = (env, path, body) => call(env, path, { method: 'POST', body: JSON.stringify(body) });

test('the Worker makes its own key pair once and keeps it', async () => {
  const DB = d1();
  const a = await vapidKeys(DB);
  const b = await vapidKeys(DB);
  assert.equal(a.publicKey, b.publicKey, 'a second call made a second key');
  assert.equal(Buffer.from(a.publicKey, 'base64url').length, 65, 'not an uncompressed P-256 point');
  const res = await call({ DB }, '/api/push/key');
  assert.equal((await res.json()).publicKey, a.publicKey);
});

test('the VAPID header verifies against the public key it names', async () => {
  const keys = await vapidKeys(d1());
  const header = await vapidAuthorization(EP, keys, Date.UTC(2026, 10, 13));
  const [, token, k] = header.match(/^vapid t=([^,]+), k=(.+)$/);
  assert.equal(k, keys.publicKey);
  const [h, c, sig] = token.split('.');
  assert.equal(JSON.parse(Buffer.from(c, 'base64url')).aud, 'https://fcm.googleapis.com');
  const pub = await crypto.subtle.importKey('raw', Buffer.from(k, 'base64url'), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, Buffer.from(sig, 'base64url'), new TextEncoder().encode(`${h}.${c}`));
  assert.ok(ok, 'the signature does not verify');
});

test('only real push services are accepted as endpoints', () => {
  assert.ok(validEndpoint(EP));
  assert.ok(validEndpoint('https://updates.push.services.mozilla.com/wpush/v2/x'));
  assert.ok(validEndpoint('https://web.push.apple.com/abc'));
  for (const bad of ['http://fcm.googleapis.com/x', 'https://evil.example/x', 'https://fcm.googleapis.com.evil.example/x', 42, null]) {
    assert.ok(!validEndpoint(bad), `accepted ${bad}`);
  }
});

test('follow, then the sweep fires once when the title gets an OTT date', async () => {
  const DB = d1();
  const env = { DB, ASSETS: feedOf([]) };
  assert.equal((await post(env, '/api/push/follow', { endpoint: EP, titleId: 'm-1', title: 'Jailer 2', slug: 'jailer-2' })).status, 200);
  assert.equal((await post(env, '/api/push/follow', { endpoint: EP, titleId: 'm-1', title: 'Jailer 2' })).status, 200, 'a repeat follow errored');

  const sent = [];
  const send = async (url, init) => {
    sent.push({ url, init });
    return new Response(null, { status: 201 });
  };

  // Nothing announced yet: no push.
  let s = await dispatch(env, { send, today: '2026-11-05' });
  assert.equal(s.matched, 0);
  assert.equal(sent.length, 0);

  // Announced: one push, and the device can read what it was about.
  env.ASSETS = feedOf([{ id: 'm-1~ott', title: 'Jailer 2', platforms: ['prime'], releaseDate: '2026-11-12' }]);
  s = await dispatch(env, { send, today: '2026-11-06' });
  assert.equal(s.sent, 1);
  assert.match(sent[0].init.headers.Authorization, /^vapid t=/);
  assert.equal(sent[0].init.headers['Content-Length'], '0', 'a push carried a payload it would have to encrypt');
  const pending = await (await post(env, '/api/push/pending', { endpoint: EP })).json();
  assert.deepEqual(pending.notifications, [
    { title: 'Jailer 2', body: 'Coming to Prime Video on 12 Nov.', url: '/ott-release-date/jailer-2', tag: 'title-m-1' },
  ]);
  assert.deepEqual((await (await post(env, '/api/push/pending', { endpoint: EP })).json()).notifications, [], 'delivered twice');

  // And never again for the same follow.
  s = await dispatch(env, { send, today: '2026-11-13' });
  assert.equal(sent.length, 1, 'a follow fired twice');
});

test('a gone device is forgotten; a failed send is retried', async () => {
  const DB = d1();
  const env = { DB, ASSETS: feedOf([{ id: 'm-2', title: 'X', platforms: ['theatres', 'netflix'], releaseDate: '2026-10-01' }]) };
  await post(env, '/api/push/follow', { endpoint: EP, titleId: 'm-2', title: 'X' });

  let s = await dispatch(env, { send: async () => new Response(null, { status: 500 }) });
  assert.equal(s.failed, 1);
  s = await dispatch(env, { send: async () => new Response(null, { status: 201 }) });
  assert.equal(s.sent, 1, 'a failed send was not retried');

  await post(env, '/api/push/follow', { endpoint: EP, titleId: 'm-3', title: 'Y' });
  env.ASSETS = feedOf([{ id: 'm-3~ott', title: 'Y', platforms: ['zee5'], releaseDate: '2026-10-01' }]);
  s = await dispatch(env, { send: async () => new Response(null, { status: 410 }) });
  assert.equal(s.gone, 1);
  const left = await DB.prepare('SELECT COUNT(*) AS n FROM push_follows').first();
  assert.equal(left.n, 0, 'an unsubscribed device kept its follows');
});

test('bad requests are refused', async () => {
  const env = { DB: d1() };
  assert.equal((await post(env, '/api/push/follow', { endpoint: 'https://evil.example/x', titleId: 'm', title: 't' })).status, 400);
  assert.equal((await post(env, '/api/push/follow', { endpoint: EP })).status, 400);
  const cross = await handlePush(
    new Request(`${ORIGIN}/api/push/follow`, { method: 'POST', headers: { origin: 'https://other.example' }, body: '{}' }),
    new URL(`${ORIGIN}/api/push/follow`),
    env,
  );
  assert.equal(cross.status, 403);
  assert.equal((await call({}, '/api/push/key')).status, 503);
  assert.equal(await handlePush(new Request(`${ORIGIN}/api/search`), new URL(`${ORIGIN}/api/search`), env), null);
});

test('the message says what is known, in the right tense', () => {
  const rows = [
    { id: 'a~ott', platforms: ['netflix'], releaseDate: '2026-12-01' },
    { id: 'b~ott', platforms: ['zee5'], releaseDate: '2026-12-01', namedBy: 'note' },
    { id: 'c~ott', platforms: ['sonyliv'], releaseDate: '2026-11-01' },
  ];
  assert.equal(ottNews(rows, 'a', '2026-11-13'), 'Coming to Netflix on 1 Dec.');
  assert.match(ottNews(rows, 'b', '2026-11-13'), /^Announced for ZEE5 on 1 Dec/);
  assert.equal(ottNews(rows, 'c', '2026-11-13'), 'Now streaming on SonyLIV.');
  assert.equal(ottNews(rows, 'z', '2026-11-13'), null);
});
