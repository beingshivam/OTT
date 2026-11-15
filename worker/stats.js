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
  `CREATE TABLE IF NOT EXISTS vitals_daily (day TEXT NOT NULL, metric TEXT NOT NULL, page TEXT NOT NULL, device TEXT NOT NULL, bucket INTEGER NOT NULL, count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, metric, page, device, bucket))`,
];

/**
 * Real visitors' Core Web Vitals.
 *
 * Lighthouse is a lab: one simulated phone. It reported a layout shift of 0
 * for months while real phones saw 0.4–0.8, because its default mode hid
 * every frame behind a blocking font. So the site measures itself where it
 * matters: each visit reports Google's five vitals once (web-vitals, in
 * src/lib/vitals.ts), and each lands here as a count in a value bucket — no
 * raw values, no identifiers. The report reads the 75th percentile and the
 * share in Google's "good" band, which is how Search ranks them.
 *
 * Buckets are right-closed — bucket b holds ((b-1)·w, b·w] — so a value right
 * on a threshold (LCP of exactly 2500ms) counts as good, as Google counts it.
 */
export const VITALS = {
  LCP: { label: 'Largest paint (LCP)', width: 100, max: 10000, good: 2500, poor: 4000, unit: 's' },
  INP: { label: 'Tap response (INP)', width: 10, max: 2000, good: 200, poor: 500, unit: 'ms' },
  CLS: { label: 'Layout shift (CLS)', width: 0.01, max: 1, good: 0.1, poor: 0.25, unit: '' },
  FCP: { label: 'First paint (FCP)', width: 100, max: 10000, good: 1800, poor: 3000, unit: 's' },
  TTFB: { label: 'Server response (TTFB)', width: 100, max: 10000, good: 800, poor: 1800, unit: 's' },
};
export const VITAL_PAGES = ['home', 'streaming', 'upcoming', 'title', 'other'];
const DEVICES = ['mobile', 'desktop'];

export const bucketOf = (metric, value) => {
  const m = VITALS[metric];
  return Math.min(Math.round(m.max / m.width), Math.max(0, Math.ceil(value / m.width - 1e-9)));
};
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

/** POST /api/v  body {"m":"LCP","v":1834.2,"p":"home","d":"mobile"} */
export async function handleVital(request, url, env, now = new Date()) {
  if (request.method !== 'POST') return new Response(null, { status: 405 });
  const origin = request.headers.get('origin');
  if (origin && new URL(origin).host !== url.host) return new Response(null, { status: 403 });
  if (!env.DB) return new Response(null, { status: 204 });
  let b;
  try {
    b = JSON.parse((await request.text()).slice(0, 300));
  } catch {
    return new Response(null, { status: 400 });
  }
  const m = String(b?.m ?? '');
  const v = Number(b?.v);
  const page = String(b?.p ?? '');
  const device = String(b?.d ?? '');
  if (!Object.hasOwn(VITALS, m) || !Number.isFinite(v) || v < 0 || !VITAL_PAGES.includes(page) || !DEVICES.includes(device)) {
    return new Response(null, { status: 400 });
  }
  await ensure(env.DB);
  await env.DB.prepare(
    `INSERT INTO vitals_daily (day, metric, page, device, bucket, count) VALUES (?1, ?2, ?3, ?4, ?5, 1)
     ON CONFLICT (day, metric, page, device, bucket) DO UPDATE SET count = count + 1`,
  )
    .bind(day(now), m, page, device, bucketOf(m, v))
    .run();
  return new Response(null, { status: 204 });
}

/** p75 and the good / poor shares from bucket counts. */
export function summarise(metric, buckets) {
  const m = VITALS[metric];
  const n = buckets.reduce((s, x) => s + x.count, 0);
  if (!n) return null;
  const sorted = [...buckets].sort((a, b) => a.bucket - b.bucket);
  let acc = 0;
  let p75 = 0;
  for (const x of sorted) {
    acc += x.count;
    if (acc >= 0.75 * n) {
      p75 = x.bucket * m.width;
      break;
    }
  }
  const share = (f) => Math.round((100 * sorted.filter((x) => f(x.bucket * m.width)).reduce((s, x) => s + x.count, 0)) / n);
  return { n, p75: +p75.toFixed(2), good: share((v) => v <= m.good + 1e-9), poor: share((v) => v > m.poor + 1e-9) };
}

const vitalFmt = (metric, v) => {
  const u = VITALS[metric].unit;
  return u === 's' ? `${(v / 1000).toFixed(1)}s` : u === 'ms' ? `${Math.round(v)}ms` : v.toFixed(2);
};

/** Mobile and desktop, every metric, plus LCP per page type on mobile. */
async function vitalsFor(db, from, to) {
  const rows =
    (await db
      .prepare('SELECT metric, page, device, bucket, SUM(count) AS count FROM vitals_daily WHERE day >= ?1 AND day < ?2 GROUP BY metric, page, device, bucket')
      .bind(from, to)
      .all())?.results ?? [];
  const pick = (f) => rows.filter(f).map((r) => ({ bucket: Number(r.bucket), count: Number(r.count) }));
  const overall = Object.keys(VITALS).map((metric) => ({
    metric,
    label: VITALS[metric].label,
    mobile: summarise(metric, pick((r) => r.metric === metric && r.device === 'mobile')),
    desktop: summarise(metric, pick((r) => r.metric === metric && r.device === 'desktop')),
  }));
  const byPage = VITAL_PAGES.map((page) => ({ page, lcp: summarise('LCP', pick((r) => r.metric === 'LCP' && r.page === page && r.device === 'mobile')) })).filter((x) => x.lcp);
  return { overall, byPage };
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
  const vitals = await vitalsFor(db, day(lastStart), day(monday));
  return { week: day(monday), range, rows, totals, vitals };
}

const band = (metric, s) => (!s ? '#9aa3b6' : s.p75 <= VITALS[metric].good + 1e-9 ? '#4ade80' : s.p75 <= VITALS[metric].poor + 1e-9 ? '#fbbf24' : '#f87171');
const cell = (metric, s) => (s ? `${vitalFmt(metric, s.p75)} · ${s.good}% good` : '—');

export function renderReport({ range, rows, totals, vitals = { overall: [], byPage: [] } }) {
  const measured = vitals.overall.some((v) => v.mobile || v.desktop);
  const vitalsText = measured
    ? [
        '',
        'Speed, real visitors (75th percentile · share in Google\'s "good" band)',
        ...vitals.overall.map((v) => `${v.label}: phone ${cell(v.metric, v.mobile)} (n=${v.mobile?.n ?? 0}), desktop ${cell(v.metric, v.desktop)}`),
        ...vitals.byPage.map((x) => `  LCP on phone, ${x.page}: ${cell('LCP', x.lcp)} (n=${x.lcp.n})`),
      ]
    : [];
  const text = [
    `New on OTT — week of ${range}`,
    '',
    ...rows.map((r) => `${r.label}: ${r.now} (${change(r.now, r.before)} vs ${r.before})`),
    '',
    ...totals.map(([l, n]) => `${l}: ${n}`),
    ...vitalsText,
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
    `</table>` +
    (measured
      ? `<h2 style="font-size:15px;margin:22px 0 4px">Speed, real visitors</h2>` +
        `<p style="color:#9aa3b6;font-size:12px;margin:0 0 8px">75th percentile, as Google ranks it. Green is Google's "good" band.</p>` +
        `<table style="width:100%;border-collapse:collapse;font-size:14px;background:#12151f;border-radius:12px">` +
        `<tr style="color:#9aa3b6;font-size:12px"><td style="${td}"></td><td style="${td}text-align:right">Phone</td><td style="${td}text-align:right">Desktop</td></tr>` +
        vitals.overall
          .map(
            (v) =>
              `<tr><td style="${td}">${v.label}</td><td style="${td}text-align:right;font-weight:700;color:${band(v.metric, v.mobile)}">${cell(v.metric, v.mobile)}</td>` +
              `<td style="${td}text-align:right;color:${band(v.metric, v.desktop)}">${cell(v.metric, v.desktop)}</td></tr>`,
          )
          .join('') +
        vitals.byPage
          .map((x) => `<tr><td style="${td}color:#9aa3b6;padding-left:22px">LCP on phone · ${x.page}</td><td style="${td}text-align:right;color:${band('LCP', x.lcp)}">${cell('LCP', x.lcp)}</td><td style="${td}text-align:right;color:#9aa3b6">n=${x.lcp.n}</td></tr>`)
          .join('') +
        `</table>`
      : '') +
    `<p style="color:#9aa3b6;font-size:12px;margin-top:20px">Counts only — no cookies, no identifiers. <a style="color:#ffb03a" href="${SITE}">newonott.in</a></p>` +
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
