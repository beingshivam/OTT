/**
 * First-party measurement: counts, nothing else.
 *
 * The site has run for months on guesses — Search Console says who arrived,
 * nothing says what they did next. This keeps one number per event per day
 * (D1 events_daily). No cookies, no identifiers, no IPs, no user agents: a
 * browser says "a subscribe happened" and a counter goes up by one.
 *
 * Every Monday morning the hourly sweep emails the owner last week against the
 * week before, plus the running totals of people who asked to hear from us.
 */

const SITE = 'https://newonott.in';
const FROM = 'New on OTT <mail@newonott.in>';

/** The only names that are counted; anything else is dropped. */
export const EVENTS = {
  visit: 'Visits (devices per day)',
  return: 'Returning visits',
  subscribe: 'Newsletter sign-ups',
  follow_push: 'Notify me — push',
  follow_email: 'Notify me — email',
  myapps_set: 'My apps saved',
  myapps_on: 'My apps switched on',
  outbound: 'Clicks out to a platform',
  share: 'Shares',
  return_apps: 'Returning visits — with My apps set',
  foryou_open: 'Taps on New on your apps',
  foryou_app: 'App chip taps',
  nudge_open: 'Pick my apps prompt taps',
};

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS events_daily (day TEXT NOT NULL, name TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, name))`,
  `CREATE TABLE IF NOT EXISTS report_sends (week TEXT PRIMARY KEY, sent_at TEXT NOT NULL)`,
];
let ready = false;
export function resetStatsCache() {
  ready = false;
}
async function ensure(db) {
  if (ready) return;
  for (const sql of SCHEMA) await db.prepare(sql).run();
  ready = true;
}

const day = (d) => d.toISOString().slice(0, 10);

/** POST /api/e  body {"n":"subscribe"} — one count. Always 204 for a known name. */
export async function handleEvent(request, url, env, now = new Date()) {
  if (request.method !== 'POST') return new Response(null, { status: 405 });
  const origin = request.headers.get('origin');
  if (origin && new URL(origin).host !== url.host) return new Response(null, { status: 403 });
  if (!env.DB) return new Response(null, { status: 204 });
  let name = '';
  try {
    name = String(JSON.parse((await request.text()).slice(0, 200)).n ?? '');
  } catch {
    return new Response(null, { status: 400 });
  }
  if (!Object.hasOwn(EVENTS, name)) return new Response(null, { status: 400 });
  await ensure(env.DB);
  await env.DB.prepare(
    'INSERT INTO events_daily (day, name, count) VALUES (?1, ?2, 1) ON CONFLICT (day, name) DO UPDATE SET count = count + 1',
  )
    .bind(day(now), name)
    .run();
  return new Response(null, { status: 204 });
}

async function sums(db, from, to) {
  const rows =
    (await db.prepare('SELECT name, SUM(count) AS n FROM events_daily WHERE day >= ?1 AND day < ?2 GROUP BY name').bind(from, to).all())
      ?.results ?? [];
  return Object.fromEntries(rows.map((r) => [r.name, Number(r.n)]));
}

/** A table that may not exist yet (nobody has followed anything) counts as 0. */
async function count(db, sql) {
  try {
    return Number((await db.prepare(sql).first())?.n ?? 0);
  } catch {
    return 0;
  }
}

const change = (now, before) => {
  if (!before) return now ? 'new' : '—';
  const pct = Math.round(((now - before) / before) * 100);
  return `${pct >= 0 ? '+' : ''}${pct}%`;
};

/** Last Monday-to-Sunday against the one before, plus running totals. */
export async function buildReport(db, now = new Date()) {
  await ensure(db);
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const monday = new Date(today.getTime() - ((today.getUTCDay() + 6) % 7) * 86_400_000);
  const lastStart = new Date(monday.getTime() - 7 * 86_400_000);
  const prevStart = new Date(monday.getTime() - 14 * 86_400_000);
  const last = await sums(db, day(lastStart), day(monday));
  const prev = await sums(db, day(prevStart), day(lastStart));
  const rows = Object.entries(EVENTS).map(([k, label]) => ({ label, now: last[k] ?? 0, before: prev[k] ?? 0 }));
  const totals = [
    ['Newsletter subscribers', await count(db, 'SELECT COUNT(*) AS n FROM subscribers')],
    ['Waiting for a push', await count(db, 'SELECT COUNT(*) AS n FROM push_follows WHERE notified_at IS NULL')],
    ['Waiting for an email', await count(db, 'SELECT COUNT(*) AS n FROM email_follows WHERE notified_at IS NULL')],
    ['Push devices', await count(db, 'SELECT COUNT(*) AS n FROM push_subs')],
  ];
  const sunday = new Date(monday.getTime() - 86_400_000);
  const fmt = (d) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const range = `${fmt(lastStart)} – ${fmt(sunday)}`;
  return { week: day(monday), range, rows, totals };
}

export function renderReport({ range, rows, totals }) {
  const text = [
    `New on OTT — week of ${range}`,
    '',
    ...rows.map((r) => `${r.label}: ${r.now} (${change(r.now, r.before)} vs ${r.before})`),
    '',
    ...totals.map(([l, n]) => `${l}: ${n}`),
    '',
    'Counts only — no cookies, no identifiers.',
  ].join('\n');
  const td = 'padding:8px 10px;border-bottom:1px solid #232838;';
  const html =
    `<!doctype html><html><body style="margin:0;background:#0b0c10;font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#e8eaf0">` +
    `<div style="max-width:560px;margin:auto;padding:28px 18px">` +
    `<div style="color:#ffb03a;font-weight:700;letter-spacing:.08em;font-size:12px;text-transform:uppercase">New on OTT · weekly numbers</div>` +
    `<h1 style="font-size:22px;margin:6px 0 18px">${range}</h1>` +
    `<table style="width:100%;border-collapse:collapse;font-size:14px;background:#12151f;border-radius:12px">` +
    `<tr style="color:#9aa3b6;font-size:12px"><td style="${td}">Event</td><td style="${td}text-align:right">Last week</td><td style="${td}text-align:right">Change</td></tr>` +
    rows
      .map((r) => {
        const c = change(r.now, r.before);
        const col = c.startsWith('+') || c === 'new' ? '#4ade80' : c.startsWith('-') ? '#f87171' : '#9aa3b6';
        return `<tr><td style="${td}">${r.label}</td><td style="${td}text-align:right;font-weight:700">${r.now}</td><td style="${td}text-align:right;color:${col}">${c}</td></tr>`;
      })
      .join('') +
    `</table><h2 style="font-size:15px;margin:22px 0 8px">Running totals</h2>` +
    `<table style="width:100%;border-collapse:collapse;font-size:14px;background:#12151f;border-radius:12px">` +
    totals.map(([l, n]) => `<tr><td style="${td}">${l}</td><td style="${td}text-align:right;font-weight:700">${n}</td></tr>`).join('') +
    `</table><p style="color:#9aa3b6;font-size:12px;margin-top:20px">Counts only — no cookies, no identifiers. <a style="color:#ffb03a" href="${SITE}">newonott.in</a></p>` +
    `</div></body></html>`;
  return { text, html };
}

/**
 * Run by the hourly sweep: on Monday from 03:30 UTC (09:00 IST), once a week.
 */
export async function mondayReport(env, { send = fetch, now = new Date() } = {}) {
  if (!env.RESEND_API_KEY || !env.DB) return { skipped: 'not configured' };
  if (now.getUTCDay() !== 1 || now.getUTCHours() * 60 + now.getUTCMinutes() < 210) return { skipped: 'not Monday morning' };
  const report = await buildReport(env.DB, now);
  if (await env.DB.prepare('SELECT 1 AS x FROM report_sends WHERE week = ?1').bind(report.week).first()) return { skipped: 'sent' };
  const { text, html } = renderReport(report);
  const res = await send('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: FROM,
      to: [env.REPORT_EMAIL || env.ALERT_EMAIL || 'mail@newonott.in'],
      subject: `New on OTT numbers — ${report.range}`,
      text,
      html,
    }),
  });
  if (!res.ok) {
    console.error('report: resend refused', res.status, await res.text().catch(() => ''));
    return { error: res.status };
  }
  await env.DB.prepare('INSERT OR IGNORE INTO report_sends (week, sent_at) VALUES (?1, ?2)').bind(report.week, now.toISOString()).run();
  return { sent: report.week };
}
