/**
 * worker/newsletter.js on real SQLite (node:sqlite) behind the D1 call shape.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { handleUnsubscribe, resetNewsletterCache, unsubscribeLink, weekOf, weekly, welcome } from './newsletter.js';

function d1() {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE subscribers (email TEXT PRIMARY KEY, address TEXT, created_at TEXT, country TEXT)');
  resetNewsletterCache();
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

const digest = (weekId = '2026-11-13') => ({
  async fetch(req) {
    const f = new URL(req.url).pathname.split('/').pop();
    const body = {
      'latest.html': `<html><body>${'x'.repeat(200)} {{ unsubscribe }}</body></html>`,
      'latest.txt': 'This week\n{{ unsubscribe }}',
      'subject.txt': '13–19 Nov: Daayra and more\n',
      'meta.json': JSON.stringify({ weekId }),
    }[f];
    return body ? new Response(body) : new Response('', { status: 404 });
  },
});

const sub = (DB, email, at = '2026-10-01') =>
  DB.raw.prepare('INSERT INTO subscribers (email, address, created_at) VALUES (?, ?, ?)').run(email.toLowerCase(), email, at);

function recorder() {
  const calls = [];
  const send = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return new Response('{}', { status: 200 });
  };
  return { calls, send };
}

test('the week runs Friday to Thursday', () => {
  assert.equal(weekOf(new Date('2026-11-13T10:00:00Z')), '2026-11-13');
  assert.equal(weekOf(new Date('2026-11-19T23:00:00Z')), '2026-11-13');
  assert.equal(weekOf(new Date('2026-11-20T01:00:00Z')), '2026-11-20');
});

test('a new subscriber gets this week straight away, with their own way out, and not again on Friday', async () => {
  const DB = d1();
  const env = { DB, ASSETS: digest(), RESEND_API_KEY: 'k' };
  sub(DB, 'Reader@Example.com');
  const r = recorder();
  assert.ok(await welcome(env, 'Reader@Example.com', r.send));
  const mail = r.calls[0].body;
  assert.deepEqual(mail.to, ['Reader@Example.com']);
  assert.match(mail.subject, /^Welcome to New on OTT — 13–19 Nov/);
  assert.ok(!mail.html.includes('{{'), 'the unsubscribe placeholder was left in');
  assert.match(mail.headers['List-Unsubscribe'], /\/api\/subscribe\/unsubscribe\?e=reader%40example\.com&t=/);

  const s = await weekly(env, { send: r.send, now: new Date('2026-11-13T16:00:00Z') });
  assert.deepEqual(s, { done: true, week: '2026-11-13' }, 'the welcomed reader got the same week twice');
});

test('Friday sends to everyone once, within the daily allowance, and finishes later', async () => {
  const DB = d1();
  for (let i = 0; i < 5; i++) sub(DB, `p${i}@example.com`, `2026-10-0${i + 1}`);
  const env = { DB, ASSETS: digest(), RESEND_API_KEY: 'k', NEWSLETTER_DAILY_LIMIT: '3' };
  const r = recorder();

  assert.match((await weekly(env, { send: r.send, now: new Date('2026-11-13T10:00:00Z') })).skipped, /before Friday evening/);
  let s = await weekly(env, { send: r.send, now: new Date('2026-11-13T15:00:00Z') });
  assert.equal(s.sent, 3);
  assert.equal(r.calls[0].url, 'https://api.resend.com/emails/batch');
  assert.equal(r.calls[0].body.length, 3);
  s = await weekly(env, { send: r.send, now: new Date('2026-11-13T16:00:00Z') });
  assert.match(s.skipped, /allowance/, 'went over the daily allowance');
  s = await weekly(env, { send: r.send, now: new Date('2026-11-14T05:00:00Z') });
  assert.equal(s.sent, 2, 'the rest did not go out the next day');
  s = await weekly(env, { send: r.send, now: new Date('2026-11-14T06:00:00Z') });
  assert.equal(s.done, true);
  const everyone = r.calls.flatMap((c) => c.body.map((m) => m.to[0])).sort();
  assert.deepEqual(everyone, ['p0@example.com', 'p1@example.com', 'p2@example.com', 'p3@example.com', 'p4@example.com']);
});

test("last week's digest is never sent as this week's", async () => {
  const DB = d1();
  sub(DB, 'a@example.com');
  const env = { DB, ASSETS: digest('2026-11-06'), RESEND_API_KEY: 'k' };
  const s = await weekly(env, { send: recorder().send, now: new Date('2026-11-13T20:00:00Z') });
  assert.match(s.skipped, /2026-11-06, not 2026-11-13/);
});

test('the unsubscribe link works, and a forged one does not', async () => {
  const DB = d1();
  sub(DB, 'a@example.com');
  sub(DB, 'b@example.com');
  const env = { DB };
  const forged = await handleUnsubscribe(new Request('https://newonott.in/x'), new URL('https://newonott.in/api/subscribe/unsubscribe?e=b%40example.com&t=guess'), env);
  assert.match(await forged.text(), /not recognised/);
  const link = await unsubscribeLink(DB, 'A@Example.com');
  const ok = await handleUnsubscribe(new Request(link, { method: 'POST' }), new URL(link), env);
  assert.equal(ok.status, 200);
  const left = DB.raw.prepare('SELECT email FROM subscribers').all().map((r) => r.email);
  assert.deepEqual(left, ['b@example.com']);
});

test('nothing is sent without a sender', async () => {
  const DB = d1();
  sub(DB, 'a@example.com');
  assert.equal(await welcome({ DB, ASSETS: digest() }, 'a@example.com'), false);
  assert.equal((await weekly({ DB, ASSETS: digest() })).skipped, 'not configured');
});
