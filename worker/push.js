import { mailConfigured, renderMail, sendMail } from './mail.js';

/**
 * "Notify me when it streams" — browser push, end to end on this Worker.
 *
 * The most-searched question in this category is "when is <film> coming to
 * OTT?", and the site used to answer it once and lose the reader for ever.
 * A follow turns that visit into a return: the reader taps Notify on a title
 * page, and the day the film gets an OTT date their phone says so.
 *
 * Three decisions keep this free of setup and of moving parts:
 *
 *   Keys made here. Web push needs a VAPID key pair. Rather than a secret
 *   somebody has to generate and paste into the dashboard, the Worker makes
 *   its own on first use and keeps it in D1, which only this Worker can read.
 *   Nothing to configure, nothing to rotate by hand.
 *
 *   No payload. A push carrying content has to be encrypted per subscription
 *   (RFC 8291). A push with no body needs only the VAPID signature; the
 *   service worker wakes, asks /api/push/pending what happened, and shows it.
 *   Same result for the reader, a fraction of the cryptography here.
 *
 *   An hourly sweep. The scheduled handler compares every waiting follow
 *   against the shipped feed. A follow fires once — when the title first has
 *   an OTT date, announced or arrived — and is then done.
 */

const CONTACT = 'mailto:mail@newonott.in';
/** Push services a browser can hand out. Anything else is refused, so the
 *  dispatcher can never be pointed at an arbitrary URL. */
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/,
  /^updates\.push\.services\.mozilla\.com$/,
  /\.notify\.windows\.com$/,
  /^web\.push\.apple\.com$/,
];
const MAX_FOLLOWS_PER_DEVICE = 200;
const MAX_ENDPOINT = 1024;

const PLATFORM_NAMES = {
  netflix: 'Netflix', prime: 'Prime Video', jiohotstar: 'JioHotstar', sonyliv: 'SonyLIV', zee5: 'ZEE5',
  sunnxt: 'Sun NXT', aha: 'aha', hoichoi: 'hoichoi', manoramamax: 'ManoramaMAX', etvwin: 'ETV Win',
  chaupal: 'Chaupal', mxplayer: 'MX Player', appletv: 'Apple TV+', lionsgate: 'Lionsgate Play',
  mubi: 'MUBI', crunchyroll: 'Crunchyroll', discoveryplus: 'discovery+', shemaroome: 'ShemarooMe',
};
const platformName = (id) => PLATFORM_NAMES[id] ?? id;

const b64u = (bytes) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64uText = (s) => b64u(new TextEncoder().encode(s));

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const spoken = (iso) => {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
};

// ------------------------------------------------------------- storage --

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS push_vapid (id INTEGER PRIMARY KEY CHECK (id = 1), public_key TEXT NOT NULL, private_jwk TEXT NOT NULL, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS push_subs (endpoint TEXT PRIMARY KEY, created_at TEXT NOT NULL, country TEXT, failures INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS push_follows (endpoint TEXT NOT NULL, title_id TEXT NOT NULL, title TEXT NOT NULL, slug TEXT, created_at TEXT NOT NULL, message TEXT, notified_at TEXT, delivered_at TEXT, PRIMARY KEY (endpoint, title_id))`,
  `CREATE INDEX IF NOT EXISTS push_follows_waiting ON push_follows (notified_at)`,
  /* The email half, for readers whose browser cannot take a push (iPhone
     outside a home-screen app, mostly). One row per address and title; the
     token is the unsubscribe link. */
  `CREATE TABLE IF NOT EXISTS email_follows (email TEXT NOT NULL, title_id TEXT NOT NULL, title TEXT NOT NULL, slug TEXT, token TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, country TEXT, notified_at TEXT, PRIMARY KEY (email, title_id))`,
  `CREATE INDEX IF NOT EXISTS email_follows_waiting ON email_follows (notified_at)`,
];

const LOOKS_LIKE_EMAIL = /^[^\s@]+@[^\s@.]+\.[^\s@]{2,}$/;
const MAX_FOLLOWS_PER_EMAIL = 50;
const SITE = 'https://newonott.in';
const unsubscribeUrl = (token) => `${SITE}/api/push/unsubscribe?t=${encodeURIComponent(token)}`;

/* Created on first use rather than by a migration step somebody has to run.
   IF NOT EXISTS makes every later call a no-op; the flag spares the round
   trips within one isolate. */
let schemaReady = false;
export async function ensureSchema(db) {
  if (schemaReady) return;
  for (const sql of SCHEMA) await db.prepare(sql).run();
  schemaReady = true;
}
/** For tests, which build a fresh database each time. */
export function resetSchemaCache() {
  schemaReady = false;
}

/** The key pair, made on first use and kept in D1. Race-safe: two isolates
 *  generating at once both INSERT OR IGNORE, and both read back the winner. */
export async function vapidKeys(db) {
  await ensureSchema(db);
  let row = await db.prepare('SELECT public_key, private_jwk FROM push_vapid WHERE id = 1').first();
  if (!row) {
    const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const publicKey = b64u(await crypto.subtle.exportKey('raw', pair.publicKey));
    const privateJwk = JSON.stringify(await crypto.subtle.exportKey('jwk', pair.privateKey));
    await db
      .prepare('INSERT OR IGNORE INTO push_vapid (id, public_key, private_jwk, created_at) VALUES (1, ?1, ?2, ?3)')
      .bind(publicKey, privateJwk, new Date().toISOString())
      .run();
    row = await db.prepare('SELECT public_key, private_jwk FROM push_vapid WHERE id = 1').first();
  }
  const privateKey = await crypto.subtle.importKey(
    'jwk',
    JSON.parse(row.private_jwk),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  return { publicKey: row.public_key, privateKey };
}

/** The Authorization header a push service accepts (RFC 8292). */
export async function vapidAuthorization(endpoint, keys, now = Date.now()) {
  const aud = new URL(endpoint).origin;
  const header = b64uText(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = b64uText(JSON.stringify({ aud, exp: Math.floor(now / 1000) + 12 * 3600, sub: CONTACT }));
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    keys.privateKey,
    new TextEncoder().encode(`${header}.${claims}`),
  );
  // WebCrypto signs ECDSA as raw r||s, which is exactly JOSE's ES256 form.
  return `vapid t=${header}.${claims}.${b64u(signature)}, k=${keys.publicKey}`;
}

export function validEndpoint(endpoint) {
  if (typeof endpoint !== 'string' || endpoint.length > MAX_ENDPOINT) return false;
  let u;
  try {
    u = new URL(endpoint);
  } catch {
    return false;
  }
  return u.protocol === 'https:' && PUSH_HOSTS.some((re) => re.test(u.hostname));
}

// ---------------------------------------------------------------- HTTP --

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

async function body(request) {
  const raw = await request.text();
  if (raw.length > 4096) throw new Error('too_large');
  return JSON.parse(raw);
}

/** /api/push/* — returns a Response, or null when the path is not ours. */
export async function handlePush(request, url, env) {
  if (!url.pathname.startsWith('/api/push/')) return null;
  if (!env.DB) return json(503, { error: 'not_configured' });
  const origin = request.headers.get('origin');
  if (origin && new URL(origin).host !== url.host) return json(403, { error: 'bad_origin' });

  const route = url.pathname.slice('/api/push/'.length);
  try {
    if (route === 'key' && request.method === 'GET') {
      const { publicKey } = await vapidKeys(env.DB);
      return json(200, { publicKey });
    }
    /* What the page may offer: email only once a sender is configured. */
    if (route === 'config' && request.method === 'GET') {
      return json(200, { email: mailConfigured(env) });
    }
    /* GET from the link in the email, POST from a mail client's one-click
       unsubscribe (RFC 8058). Either way the token is the whole credential. */
    if (route === 'unsubscribe') {
      const token = url.searchParams.get('t') ?? '';
      await ensureSchema(env.DB);
      const row = token
        ? await env.DB.prepare('SELECT title FROM email_follows WHERE token = ?1').bind(token).first()
        : null;
      if (row) await env.DB.prepare('DELETE FROM email_follows WHERE token = ?1').bind(token).run();
      if (request.method === 'POST') return json(200, { ok: true });
      const msg = row ? `You won't get any more emails about ${row.title}.` : 'This link has already been used — you are unsubscribed.';
      return new Response(
        `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">` +
          `<title>Unsubscribed — New on OTT</title><body style="font-family:system-ui,sans-serif;background:#0b0c10;color:#e8eaf0;padding:40px 20px;max-width:520px;margin:auto">` +
          `<h1 style="font-size:22px">Unsubscribed</h1><p>${msg.replace(/[<>&]/g, '')}</p><p><a style="color:#ffb03a" href="/">Back to New on OTT</a></p></body>`,
        { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } },
      );
    }
    if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' });
    const b = await body(request);

    if (route === 'email-follow') {
      if (!mailConfigured(env)) return json(503, { error: 'not_configured' });
      const email = String(b.email ?? '').trim();
      const key = email.toLowerCase();
      const titleId = String(b.titleId ?? '').slice(0, 64);
      const title = String(b.title ?? '').slice(0, 200);
      const slug = b.slug ? String(b.slug).slice(0, 200) : null;
      if (!LOOKS_LIKE_EMAIL.test(email) || email.length > 254) return json(400, { error: 'bad_email' });
      if (!titleId || !title) return json(400, { error: 'bad_title' });
      await ensureSchema(env.DB);
      const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM email_follows WHERE email = ?1').bind(key).first();
      if ((count?.n ?? 0) >= MAX_FOLLOWS_PER_EMAIL) return json(429, { error: 'too_many' });
      const already = await env.DB.prepare('SELECT 1 AS x FROM email_follows WHERE email = ?1 AND title_id = ?2')
        .bind(key, titleId)
        .first();
      if (already) return json(200, { ok: true });
      const token = crypto.randomUUID();
      await env.DB.prepare(
        `INSERT INTO email_follows (email, title_id, title, slug, token, created_at, country) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
      )
        .bind(key, titleId, title, slug, token, new Date().toISOString(), request.cf?.country ?? null)
        .run();
      /* The confirmation is the receipt and the way out in one: whoever owns
         the address learns what was asked for and can stop it in one tap. */
      const page = slug ? `${SITE}/ott-release-date/${slug}` : SITE;
      const mail = renderMail({
        preheader: `One email the day ${title} gets an OTT date.`,
        kicker: "You're on the list",
        heading: title,
        status: "We'll email you the day it gets an OTT date.",
        poster: b.poster,
        lines: [
          `Which platform, and when — one email, the moment it's announced. That's the only email this sends.`,
          `Until then, the page has the expected OTT window and everything else known about it.`,
        ],
        cta: { label: `See ${title}`, url: page },
        unsubscribeUrl: unsubscribeUrl(token),
      });
      await sendMail(env, { to: email, subject: `We'll tell you when ${title} is on OTT`, ...mail, unsubscribeUrl: unsubscribeUrl(token) });
      return json(200, { ok: true });
    }

    const endpoint = b?.endpoint ?? b?.subscription?.endpoint;
    if (!validEndpoint(endpoint)) return json(400, { error: 'bad_endpoint' });
    await ensureSchema(env.DB);
    const now = new Date().toISOString();

    if (route === 'follow') {
      const titleId = String(b.titleId ?? '').slice(0, 64);
      const title = String(b.title ?? '').slice(0, 200);
      const slug = b.slug ? String(b.slug).slice(0, 200) : null;
      if (!titleId || !title) return json(400, { error: 'bad_title' });
      const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM push_follows WHERE endpoint = ?1').bind(endpoint).first();
      if ((count?.n ?? 0) >= MAX_FOLLOWS_PER_DEVICE) return json(429, { error: 'too_many' });
      await env.DB.prepare('INSERT OR IGNORE INTO push_subs (endpoint, created_at, country) VALUES (?1, ?2, ?3)')
        .bind(endpoint, now, request.cf?.country ?? null)
        .run();
      await env.DB.prepare(
        `INSERT INTO push_follows (endpoint, title_id, title, slug, created_at) VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT (endpoint, title_id) DO NOTHING`,
      )
        .bind(endpoint, titleId, title, slug, now)
        .run();
      return json(200, { ok: true });
    }
    if (route === 'unfollow') {
      const titleId = String(b.titleId ?? '');
      await env.DB.prepare('DELETE FROM push_follows WHERE endpoint = ?1 AND title_id = ?2').bind(endpoint, titleId).run();
      return json(200, { ok: true });
    }
    if (route === 'pending') {
      /* What the service worker shows when a push wakes it. The endpoint is
         the credential: unguessable, and only the device holding it has it. */
      const rows = await env.DB.prepare(
        `SELECT title_id, title, slug, message FROM push_follows
         WHERE endpoint = ?1 AND notified_at IS NOT NULL AND delivered_at IS NULL`,
      )
        .bind(endpoint)
        .all();
      const list = rows?.results ?? [];
      if (list.length) {
        await env.DB.prepare(
          'UPDATE push_follows SET delivered_at = ?2 WHERE endpoint = ?1 AND notified_at IS NOT NULL AND delivered_at IS NULL',
        )
          .bind(endpoint, now)
          .run();
      }
      return json(200, {
        notifications: list.map((r) => ({
          title: r.title,
          body: r.message,
          url: r.slug ? `/ott-release-date/${r.slug}` : '/',
          tag: `title-${r.title_id}`,
        })),
      });
    }
    return json(404, { error: 'not_found' });
  } catch (err) {
    if (err?.message === 'too_large') return json(413, { error: 'too_large' });
    if (err instanceof SyntaxError) return json(400, { error: 'bad_json' });
    console.error('push:', route, err);
    return json(500, { error: 'push_failed' });
  }
}

// ------------------------------------------------------------ dispatch --

/**
 * What a follow is waiting for: the first OTT date this title has, from the
 * shipped feed. An `~ott` row is the film's own streaming date; a base row
 * that has gained a service counts too. Null while nothing is known.
 */
export function ottNews(rows, titleId, today) {
  const hits = rows.filter(
    (r) =>
      r.id === `${titleId}~ott` ||
      (r.id === titleId && (r.platforms ?? []).some((p) => p !== 'theatres')),
  );
  if (!hits.length) return null;
  const best = hits.sort((a, b) => a.releaseDate.localeCompare(b.releaseDate))[0];
  const on = best.platforms.filter((p) => p !== 'theatres').map(platformName).join(', ');
  if (!on) return null;
  const arrived = !best.releaseDate || best.releaseDate <= today || best.id === titleId;
  if (arrived) return `Now streaming on ${on}.`;
  return best.namedBy
    ? `Announced for ${on} on ${spoken(best.releaseDate)}. We'll keep checking.`
    : `Coming to ${on} on ${spoken(best.releaseDate)}.`;
}

/**
 * The hourly sweep. Marks every follow whose title now has an OTT date, then
 * sends one empty push per device that has something new. A push service
 * answering 404 or 410 means the reader unsubscribed or reinstalled; the
 * device and its follows are dropped then, which is the only cleanup needed.
 */
export async function dispatch(env, { send = fetch, today = new Date().toISOString().slice(0, 10) } = {}) {
  if (!env.DB || !env.ASSETS) return { skipped: true };
  await ensureSchema(env.DB);
  const waiting = (
    await env.DB.prepare('SELECT endpoint, title_id FROM push_follows WHERE notified_at IS NULL').all()
  )?.results ?? [];
  const emailWaiting = mailConfigured(env)
    ? ((await env.DB.prepare('SELECT COUNT(*) AS n FROM email_follows WHERE notified_at IS NULL').first())?.n ?? 0)
    : 0;
  const stats = { waiting: waiting.length, matched: 0, sent: 0, gone: 0, failed: 0, emailed: 0, emailFailed: 0 };
  if (!waiting.length && !emailWaiting) return stats;

  const res = await env.ASSETS.fetch(new Request('https://newonott.in/data/releases.json'));
  if (!res.ok) return { ...stats, error: `feed ${res.status}` };
  const feed = await res.json();
  const rows = feed.weeks.flatMap((w) => w.releases);

  const now = new Date().toISOString();
  const devices = new Set();
  const newsByTitle = new Map();
  for (const f of waiting) {
    if (!newsByTitle.has(f.title_id)) newsByTitle.set(f.title_id, ottNews(rows, f.title_id, today));
    const message = newsByTitle.get(f.title_id);
    if (!message) continue;
    await env.DB.prepare(
      'UPDATE push_follows SET message = ?3, notified_at = ?4 WHERE endpoint = ?1 AND title_id = ?2 AND notified_at IS NULL',
    )
      .bind(f.endpoint, f.title_id, message, now)
      .run();
    stats.matched++;
    devices.add(f.endpoint);
  }
  await dispatchEmail(env, rows, today, newsByTitle, stats, send);
  if (!devices.size) return stats;

  const keys = await vapidKeys(env.DB);
  for (const endpoint of devices) {
    try {
      const r = await send(endpoint, {
        method: 'POST',
        headers: {
          Authorization: await vapidAuthorization(endpoint, keys),
          TTL: String(3 * 86400),
          Urgency: 'normal',
          'Content-Length': '0',
        },
      });
      if (r.status === 404 || r.status === 410) {
        await env.DB.prepare('DELETE FROM push_follows WHERE endpoint = ?1').bind(endpoint).run();
        await env.DB.prepare('DELETE FROM push_subs WHERE endpoint = ?1').bind(endpoint).run();
        stats.gone++;
      } else if (r.ok) {
        stats.sent++;
      } else {
        stats.failed++;
        await env.DB.prepare('UPDATE push_subs SET failures = failures + 1 WHERE endpoint = ?1').bind(endpoint).run();
        /* Not delivered, so not done: the next sweep tries again. */
        await env.DB.prepare(
          'UPDATE push_follows SET notified_at = NULL WHERE endpoint = ?1 AND notified_at = ?2 AND delivered_at IS NULL',
        )
          .bind(endpoint, now)
          .run();
        console.error('push: send', r.status, new URL(endpoint).host);
      }
    } catch (err) {
      stats.failed++;
      console.error('push: send threw', err);
    }
  }
  return stats;
}

/* Most emails one sweep sends: well inside Resend's free daily allowance,
   and a backlog drains over the following hours rather than in one burst. */
const MAX_EMAILS_PER_SWEEP = 80;

async function dispatchEmail(env, rows, today, newsByTitle, stats, send) {
  if (!mailConfigured(env)) return;
  const waiting = (
    await env.DB.prepare('SELECT email, title_id, title, slug, token FROM email_follows WHERE notified_at IS NULL').all()
  )?.results ?? [];
  if (!waiting.length) return;
  /* The platforms' own app icons, the same list the site's chips use. */
  const logos = await env.ASSETS.fetch(new Request(`${SITE}/data/logos.json`))
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  for (const f of waiting) {
    if (stats.emailed + stats.emailFailed >= MAX_EMAILS_PER_SWEEP) break;
    if (!newsByTitle.has(f.title_id)) newsByTitle.set(f.title_id, ottNews(rows, f.title_id, today));
    const news = newsByTitle.get(f.title_id);
    if (!news) continue;
    const page = f.slug ? `${SITE}/ott-release-date/${f.slug}` : SITE;
    const facts = ottFacts(rows, f.title_id);
    const icon = facts?.platform ? logos?.[facts.platform] : null;
    const mail = renderMail({
      preheader: news,
      kicker: 'OTT alert',
      heading: f.title,
      status: news.replace(/\.$/, ''),
      platform: facts?.platform ? { name: facts.platformName, icon } : null,
      poster: facts?.poster,
      lines: [`This is the one email you asked for about ${f.title}. Nothing more will come about it.`],
      cta: { label: 'Where to watch', url: page },
      unsubscribeUrl: unsubscribeUrl(f.token),
    });
    const ok = await sendMail(
      env,
      { to: f.email, subject: `${f.title} — ${news.replace(/\.$/, '')}`, ...mail, unsubscribeUrl: unsubscribeUrl(f.token) },
      send,
    ).catch(() => false);
    if (ok) {
      await env.DB.prepare('UPDATE email_follows SET notified_at = ?3 WHERE email = ?1 AND title_id = ?2')
        .bind(f.email, f.title_id, new Date().toISOString())
        .run();
      stats.emailed++;
    } else {
      stats.emailFailed++;
    }
  }
}

/** The poster and platform behind a title's OTT news, for the email. */
export function ottFacts(rows, titleId) {
  const ott = rows.find((r) => r.id === `${titleId}~ott`);
  const base = rows.find((r) => r.id === titleId);
  const platform = (ott?.platforms ?? base?.platforms ?? []).find((p) => p !== 'theatres') ?? null;
  return {
    poster: base?.posterUrl ?? ott?.posterUrl ?? null,
    platform,
    platformName: platform ? platformName(platform) : null,
  };
}
