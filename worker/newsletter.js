/**
 * The Friday list, actually sent.
 *
 * The sign-up form had been collecting addresses since September and telling
 * each person "this week's list is on its way now, and the next one lands
 * Friday" — while the welcome mail needed a Brevo key that was never bound and
 * no weekly send existed anywhere. This sends both through Resend, the sender
 * the alert emails already use (worker/mail.js).
 *
 *   Welcome. On sign-up, this week's digest, straight away.
 *   Weekly. The hourly sweep sends the new week's digest to every subscriber
 *     once the Friday refresh has built it (email/meta.json names the week),
 *     paced to stay inside the sender's daily allowance; whoever is not
 *     reached today is reached by the next sweeps. digest_sends records who
 *     has had which week, so nobody gets one twice.
 *   Unsubscribe. A signed link per address (HMAC with a key the Worker makes
 *     and keeps in D1), one tap from the email or one click from a mail
 *     client's own button (RFC 8058). Signed so that knowing an address is not
 *     enough to remove it.
 */
import { mailConfigured } from './mail.js';

const SITE = 'https://newonott.in';
const FROM = 'New on OTT <mail@newonott.in>';
/* The free Resend plan allows 100 a day, alerts included; the Friday send
   takes most of it and leaves room for the day's alerts and welcomes. */
const DEFAULT_DAILY_LIMIT = 80;
const BATCH = 100;

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS newsletter_key (id INTEGER PRIMARY KEY CHECK (id = 1), secret TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS digest_sends (email TEXT NOT NULL, week_id TEXT NOT NULL, sent_at TEXT NOT NULL, PRIMARY KEY (email, week_id))`,
  `CREATE INDEX IF NOT EXISTS digest_sends_day ON digest_sends (sent_at)`,
];
let ready = false;
export function resetNewsletterCache() {
  ready = false;
}
async function ensure(db) {
  if (ready) return;
  for (const sql of SCHEMA) await db.prepare(sql).run();
  ready = true;
}

const b64u = (bytes) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function hmacKey(db) {
  await ensure(db);
  let row = await db.prepare('SELECT secret FROM newsletter_key WHERE id = 1').first();
  if (!row) {
    const secret = b64u(crypto.getRandomValues(new Uint8Array(32)));
    await db.prepare('INSERT OR IGNORE INTO newsletter_key (id, secret) VALUES (1, ?1)').bind(secret).run();
    row = await db.prepare('SELECT secret FROM newsletter_key WHERE id = 1').first();
  }
  return crypto.subtle.importKey('raw', new TextEncoder().encode(row.secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}

export async function unsubscribeToken(db, email) {
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(db), new TextEncoder().encode(email.toLowerCase()));
  return b64u(sig).slice(0, 32);
}

export async function unsubscribeLink(db, email) {
  return `${SITE}/api/subscribe/unsubscribe?e=${encodeURIComponent(email.toLowerCase())}&t=${await unsubscribeToken(db, email)}`;
}

const page = (title, msg) =>
  new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">` +
      `<title>${title} — New on OTT</title><body style="font-family:system-ui,sans-serif;background:#0b0c10;color:#e8eaf0;padding:40px 20px;max-width:520px;margin:auto">` +
      `<h1 style="font-size:22px">${title}</h1><p>${msg}</p><p><a style="color:#ffb03a" href="/">Back to New on OTT</a></p></body>`,
    { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } },
  );

/** /api/subscribe/unsubscribe — GET from the email, POST from a mail client. */
export async function handleUnsubscribe(request, url, env) {
  if (!env.DB) return new Response('not configured', { status: 503 });
  const email = (url.searchParams.get('e') ?? '').toLowerCase();
  const token = url.searchParams.get('t') ?? '';
  const valid = email && token && token === (await unsubscribeToken(env.DB, email));
  if (valid) await env.DB.prepare('DELETE FROM subscribers WHERE email = ?1').bind(email).run();
  if (request.method === 'POST') return new Response(null, { status: valid ? 200 : 400 });
  return valid
    ? page('Unsubscribed', "You're off the Friday list. No more emails from New on OTT — you can always sign up again on the site.")
    : page('Link not recognised', 'This unsubscribe link is incomplete. Reply to any of our emails with "stop" and we will remove you by hand.');
}

/** This deploy's digest: the bodies, the subject, and which week it is. */
export async function loadDigest(env) {
  const get = (f) =>
    env.ASSETS.fetch(new Request(`${SITE}/email/${f}`)).then((r) => (r.ok ? r.text() : null)).catch(() => null);
  const [html, text, subject, meta] = await Promise.all(['latest.html', 'latest.txt', 'subject.txt', 'meta.json'].map(get));
  if (!html || html.length < 100 || !subject) return null;
  let weekId = null;
  try {
    weekId = JSON.parse(meta ?? '{}').weekId ?? null;
  } catch {
    /* An older deploy without meta.json: welcome mail still works, the weekly send waits. */
  }
  return { html, text: text ?? '', subject: subject.trim(), weekId };
}

/** One subscriber's copy: the unsubscribe placeholder filled with their link. */
function personal(digest, link) {
  const html = digest.html.replace(/\{\{\s*unsubscribe\s*\}\}/g, `<a href="${link}" style="color:#9aa3b6;">Unsubscribe</a>`);
  const text = digest.text.replace(/\{\{\s*unsubscribe\s*\}\}/g, `Unsubscribe: ${link}`);
  return { html, text };
}

const message = (to, subject, body, link) => ({
  from: FROM,
  to: [to],
  subject,
  html: body.html,
  text: body.text,
  headers: { 'List-Unsubscribe': `<${link}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
});

/** On sign-up: this week's list, now. Recorded so Friday does not repeat it. */
export async function welcome(env, address, send = fetch) {
  if (!mailConfigured(env) || !env.DB) return false;
  const digest = await loadDigest(env);
  if (!digest) {
    console.log('welcome: skipped — no digest in this deploy');
    return false;
  }
  const link = await unsubscribeLink(env.DB, address);
  const res = await send('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify(message(address, `Welcome to New on OTT — ${digest.subject}`, personal(digest, link), link)),
  });
  if (!res.ok) {
    console.error('welcome: resend refused', res.status, await res.text().catch(() => ''));
    return false;
  }
  if (digest.weekId) {
    await env.DB.prepare('INSERT OR IGNORE INTO digest_sends (email, week_id, sent_at) VALUES (?1, ?2, ?3)')
      .bind(address.toLowerCase(), digest.weekId, new Date().toISOString())
      .run();
  }
  return true;
}

/** The week a moment belongs to: Friday to Thursday, as the site's weeks are. */
export function weekOf(now) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return new Date(d.getTime() - ((d.getUTCDay() + 2) % 7) * 86_400_000).toISOString().slice(0, 10);
}

/**
 * The weekly send, run by the hourly sweep. Waits until Friday 14:30 UTC
 * (20:00 IST) and until this deploy's digest is this week's — the Friday
 * refresh builds it, often hours after its slot. Then sends to whoever has
 * not had this week, as many as today's allowance leaves.
 */
export async function weekly(env, { send = fetch, now = new Date() } = {}) {
  if (!mailConfigured(env) || !env.DB || !env.ASSETS) return { skipped: 'not configured' };
  const week = weekOf(now);
  if (now < new Date(`${week}T14:30:00Z`)) return { skipped: 'before Friday evening' };
  const digest = await loadDigest(env);
  if (!digest || digest.weekId !== week) return { skipped: `digest is ${digest?.weekId ?? 'missing'}, not ${week}` };
  await ensure(env.DB);

  const limit = Number(env.NEWSLETTER_DAILY_LIMIT ?? DEFAULT_DAILY_LIMIT);
  const today = now.toISOString().slice(0, 10);
  const sentToday = (await env.DB.prepare('SELECT COUNT(*) AS n FROM digest_sends WHERE substr(sent_at, 1, 10) = ?1').bind(today).first())?.n ?? 0;
  const room = Math.max(0, Math.min(BATCH, limit - sentToday));
  if (!room) return { skipped: 'daily allowance used', sentToday };

  const due = (
    await env.DB.prepare(
      `SELECT s.email, s.address FROM subscribers s
       LEFT JOIN digest_sends d ON d.email = s.email AND d.week_id = ?1
       WHERE d.email IS NULL ORDER BY s.created_at LIMIT ?2`,
    )
      .bind(week, room)
      .all()
  )?.results ?? [];
  if (!due.length) return { done: true, week };

  const batch = [];
  for (const s of due) {
    const link = await unsubscribeLink(env.DB, s.email);
    batch.push(message(s.address ?? s.email, digest.subject, personal(digest, link), link));
  }
  const res = await send('https://api.resend.com/emails/batch', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify(batch),
  });
  if (!res.ok) {
    console.error('newsletter: resend refused the batch', res.status, await res.text().catch(() => ''));
    return { error: res.status };
  }
  const stamp = now.toISOString();
  for (const s of due) {
    await env.DB.prepare('INSERT OR IGNORE INTO digest_sends (email, week_id, sent_at) VALUES (?1, ?2, ?3)').bind(s.email, week, stamp).run();
  }
  return { sent: due.length, week };
}
