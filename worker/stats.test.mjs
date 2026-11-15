/**
 * worker/stats.js on real SQLite (node:sqlite) behind the D1 call shape.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { buildReport, bucketOf, handleEvent, handleVital, mondayReport, renderReport, resetStatsCache, summarise } from './stats.js';

function d1() {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE subscribers (email TEXT PRIMARY KEY)');
  db.exec("INSERT INTO subscribers VALUES ('a@x.com'), ('b@x.com')");
  resetStatsCache();
  return {
    raw: db,
    prepare(sql) {
      let args = [];
      const api = {
        bind(...a) {
          args = a;
          return api;
        },
        async run() {
          db.prepare(sql).run(...args);
          return { success: true };
        },
        async first() {
          return db.prepare(sql).get(...args) ?? null;
        },
        async all() {
          return { results: db.prepare(sql).all(...args) };
        },
      };
      return api;
    },
  };
}

const ORIGIN = 'https://newonott.in';
const hit = (env, body, { origin = ORIGIN, at } = {}) =>
  handleEvent(
    new Request(`${ORIGIN}/api/e`, { method: 'POST', headers: { origin }, body: JSON.stringify(body) }),
    new URL(`${ORIGIN}/api/e`),
    env,
    at ? new Date(at) : undefined,
  );

test('known events are counted per day; unknown names and other sites are not', async () => {
  const DB = d1();
  const env = { DB };
  assert.equal((await hit(env, { n: 'subscribe' }, { at: '2026-11-10T10:00:00Z' })).status, 204);
  await hit(env, { n: 'subscribe' }, { at: '2026-11-10T11:00:00Z' });
  await hit(env, { n: 'visit' }, { at: '2026-11-11T11:00:00Z' });
  assert.equal((await hit(env, { n: 'drop table' })).status, 400);
  assert.equal((await hit(env, { n: 'toString' })).status, 400);
  assert.equal((await hit(env, { n: 'visit' }, { origin: 'https://evil.example' })).status, 403);
  const rows = DB.raw.prepare('SELECT day, name, count FROM events_daily ORDER BY day, name').all();
  assert.deepEqual(rows.map((r) => ({ ...r })), [
    { day: '2026-11-10', name: 'subscribe', count: 2 },
    { day: '2026-11-11', name: 'visit', count: 1 },
  ]);
});

test('the report compares last Monday–Sunday with the week before', async () => {
  const DB = d1();
  const env = { DB };
  for (let i = 0; i < 3; i++) await hit(env, { n: 'visit' }, { at: '2026-11-03T10:00:00Z' }); // week before
  for (let i = 0; i < 6; i++) await hit(env, { n: 'visit' }, { at: '2026-11-15T10:00:00Z' }); // last week (Sun)
  await hit(env, { n: 'visit' }, { at: '2026-11-16T10:00:00Z' }); // this Monday: not counted yet
  const r = await buildReport(DB, new Date('2026-11-16T04:00:00Z'));
  assert.equal(r.week, '2026-11-16');
  assert.equal(r.range, '9 Nov – 15 Nov');
  const visits = r.rows.find((x) => x.label.startsWith('Visits'));
  assert.deepEqual([visits.now, visits.before], [6, 3]);
  assert.deepEqual(r.totals[0], ['Newsletter subscribers', 2]);
  assert.deepEqual(r.totals[1], ['Waiting for a push', 0], 'a missing table should read as zero');
  assert.match(renderReport(r).text, /Visits \(devices per day\): 6 \(\+100% vs 3\)/);
});

test('the Monday email goes once, only on Monday morning', async () => {
  const DB = d1();
  const sent = [];
  const send = async (u, init) => {
    sent.push(JSON.parse(init.body));
    return new Response('{}');
  };
  const env = { DB, RESEND_API_KEY: 'k', ALERT_EMAIL: 'owner@example.com' };
  assert.match((await mondayReport(env, { send, now: new Date('2026-11-16T02:00:00Z') })).skipped, /Monday/);
  assert.match((await mondayReport(env, { send, now: new Date('2026-11-17T05:00:00Z') })).skipped, /Monday/);
  assert.deepEqual(await mondayReport(env, { send, now: new Date('2026-11-16T04:17:00Z') }), { sent: '2026-11-16' });
  assert.equal((await mondayReport(env, { send, now: new Date('2026-11-16T05:17:00Z') })).skipped, 'sent');
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].to, ['owner@example.com']);
  assert.match(sent[0].subject, /9 Nov – 15 Nov/);
  assert.equal((await mondayReport({ DB })).skipped, 'not configured');
});

const vital = (env, body, { origin = ORIGIN, at } = {}) =>
  handleVital(
    new Request(`${ORIGIN}/api/v`, { method: 'POST', headers: { origin }, body: JSON.stringify(body) }),
    new URL(`${ORIGIN}/api/v`),
    env,
    at ? new Date(at) : undefined,
  );

test('vitals land as bucket counts; anything malformed is refused', async () => {
  const DB = d1();
  const env = { DB };
  assert.equal((await vital(env, { m: 'LCP', v: 1834.2, p: 'home', d: 'mobile' }, { at: '2026-11-12T10:00:00Z' })).status, 204);
  await vital(env, { m: 'LCP', v: 1899, p: 'home', d: 'mobile' }, { at: '2026-11-12T11:00:00Z' });
  for (const bad of [
    { m: 'FID', v: 10, p: 'home', d: 'mobile' },
    { m: 'LCP', v: 'x', p: 'home', d: 'mobile' },
    { m: 'LCP', v: -1, p: 'home', d: 'mobile' },
    { m: 'LCP', v: 100, p: '/secret', d: 'mobile' },
    { m: 'LCP', v: 100, p: 'home', d: 'fridge' },
  ]) assert.equal((await vital(env, bad)).status, 400, JSON.stringify(bad));
  assert.equal((await vital(env, { m: 'CLS', v: 0, p: 'home', d: 'mobile' }, { origin: 'https://evil.example' })).status, 403);
  const rows = DB.raw.prepare('SELECT metric, page, device, bucket, count FROM vitals_daily').all().map((r) => ({ ...r }));
  assert.deepEqual(rows, [{ metric: 'LCP', page: 'home', device: 'mobile', bucket: 19, count: 2 }], 'both values sit in (1800, 1900]');
});

test('a value on a threshold is good, as Google counts it', () => {
  assert.equal(bucketOf('LCP', 2500), 25);
  assert.equal(bucketOf('LCP', 2500.4), 26);
  assert.equal(bucketOf('CLS', 0.1), 10);
  assert.equal(bucketOf('INP', 1e9), 200, 'capped');
  const s = summarise('LCP', [{ bucket: 25, count: 3 }, { bucket: 41, count: 1 }]);
  assert.deepEqual(s, { n: 4, p75: 2500, good: 75, poor: 25 });
});

test('the Monday report carries real-visitor speed once there is some', async () => {
  const DB = d1();
  const env = { DB };
  const empty = renderReport(await buildReport(DB, new Date('2026-11-16T04:00:00Z')));
  assert.doesNotMatch(empty.text, /Speed, real visitors/, 'an empty speed table is noise');
  for (const v of [1200, 1500, 1900, 2600]) await vital(env, { m: 'LCP', v, p: 'title', d: 'mobile' }, { at: '2026-11-14T10:00:00Z' });
  await vital(env, { m: 'CLS', v: 0.02, p: 'home', d: 'desktop' }, { at: '2026-11-14T10:00:00Z' });
  await vital(env, { m: 'LCP', v: 9000, p: 'home', d: 'mobile' }, { at: '2026-11-16T03:00:00Z' }); // this week: not in last week's report
  const r = await buildReport(DB, new Date('2026-11-16T04:00:00Z'));
  const { text, html } = renderReport(r);
  assert.match(text, /Largest paint \(LCP\): phone 1\.9s · 75% good \(n=4\), desktop —/);
  assert.match(text, /Layout shift \(CLS\): phone — \(n=0\), desktop 0\.02 · 100% good/);
  assert.match(text, /LCP on phone, title: 1\.9s · 75% good \(n=4\)/);
  assert.match(html, /Speed, real visitors/);
});
