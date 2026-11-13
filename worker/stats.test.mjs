/**
 * worker/stats.js on real SQLite (node:sqlite) behind the D1 call shape.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { buildReport, handleEvent, mondayReport, renderReport, resetStatsCache } from './stats.js';

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
