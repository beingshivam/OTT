#!/usr/bin/env node
/**
 * Writes the week's email from the feed the site already builds from.
 *
 * The thing most likely to kill a weekly newsletter is not the writing, it is
 * having to do the writing every week. Two good Fridays and one busy one and
 * the habit is gone — so the draft assembles itself alongside the refresh, and
 * sending becomes paste-and-schedule.
 *
 * It is deliberately a teaser rather than the whole calendar. The email's job
 * is to get someone back to the site, and an email that lists all thirty
 * releases has already done the site's job badly. Six titles, a count of what
 * is left, and a link.
 *
 * Email is not the web: no external stylesheet survives, Gmail strips <style>
 * in some clients, and a dark palette gets force-inverted into mud by others.
 * So this is inline-styled, table-laid-out, light-themed and image-light — it
 * has to render in Gmail, Outlook and Apple Mail, not just look good in a
 * browser.
 *
 * Outputs email/subject.txt, email/latest.html and email/latest.txt.
 * Usage: npm run digest
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BRAND } from './brand.mjs';
import { INDIAN_LANGUAGES, estimateFor, gapPairs, windowStats } from '../src/lib/ott-estimate.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FEED = resolve(ROOT, 'public/data/releases.json');
const OUT = resolve(ROOT, 'email');

const SITE_URL = (process.env.SITE_URL ?? 'https://newonott.in').replace(/\/$/, '');
const REGION = (process.env.REGIONS ?? 'IN').split(',')[0].trim() || 'IN';


const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function formatRange(weekId) {
  const a = new Date(`${weekId}T00:00:00Z`);
  const b = new Date(a.getTime() + 6 * 86_400_000);
  const left =
    a.getUTCMonth() === b.getUTCMonth()
      ? String(a.getUTCDate())
      : `${a.getUTCDate()} ${MONTHS[a.getUTCMonth()]}`;
  return `${left}–${b.getUTCDate()} ${MONTHS[b.getUTCMonth()]}`;
}

const feed = JSON.parse(await readFile(FEED, 'utf8'));

// Human names, read from the app's registry so the email cannot drift from the
// site it is advertising.
const registry = await readFile(resolve(ROOT, 'src/data/platforms.ts'), 'utf8');
const platformName = new Map(
  [...registry.matchAll(/\{\s*id:\s*'([^']+)',\s*name:\s*'([^']+)'/g)].map(([, id, n]) => [id, n]),
);
const languageName = new Map(
  [
    ...(registry.match(/LANGUAGES[^{]*\{([\s\S]*?)\n\};/) ?? ['', ''])[1].matchAll(
      /(\w+):\s*'([^']+)'/g,
    ),
  ].map(([, code, n]) => [code, n]),
);
const pname = (id) => platformName.get(id) ?? id;
const lname = (c) => languageName.get(c) ?? c.toUpperCase();

// The week the site itself would open on: this one if stocked, else the nearest.
const DAY = 86_400_000;
const now = new Date();
const base = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
const currentWeek = new Date(base.getTime() - ((base.getUTCDay() + 2) % 7) * DAY)
  .toISOString()
  .slice(0, 10);

const stocked = feed.weeks.filter((w) => w.releases.some((r) => r.regions.includes(REGION)));
const week =
  stocked.find((w) => w.id === currentWeek) ??
  stocked.reduce(
    (best, w) =>
      Math.abs(Date.parse(w.id) - Date.parse(currentWeek)) <
      Math.abs(Date.parse(best.id) - Date.parse(currentWeek))
        ? w
        : best,
    stocked[0],
  );

if (!week) {
  console.error('No stocked week in the feed — refusing to write an empty digest.');
  process.exit(1);
}

const local = (r) => (r.origin?.length ? r.origin.includes('IN') : INDIAN_LANGUAGES.has(r.languages?.[0] ?? ''));
/* Indian titles lead, then everything else, each by attention: this list is
   for an Indian inbox, and a global-popularity sort led with Spanish and
   French series on 13 Nov. */
const byInterest = (a, b) => Number(local(b)) - Number(local(a)) || (b.heat ?? 0) - (a.heat ?? 0);
const rows = week.releases.filter((r) => r.regions.includes(REGION) && r.posterUrl);
const streaming = rows.filter((r) => r.platforms.some((p) => p !== 'theatres')).sort(byInterest);
const cinemas = rows.filter((r) => r.platforms.every((p) => p === 'theatres')).sort(byInterest);

const range = formatRange(week.id);
const STREAM_N = 6;
const CINEMA_N = 3;
const topStream = streaming.slice(0, STREAM_N);
const topCinema = cinemas.slice(0, CINEMA_N);
const rest = rows.length - topStream.length - topCinema.length;
const platformCount = new Set(rows.flatMap((r) => r.platforms).filter((p) => p !== 'theatres')).size;
const link = `${SITE_URL}/w/${week.id}`;

/* The expected OTT window for the films in cinemas — the one thing in this
   email nobody else sends. Same rule as the title pages. */
const archive = JSON.parse(await readFile(resolve(ROOT, 'data/archive.json'), 'utf8').catch(() => '{"titles":[]}')).titles;
const ottWindows = windowStats(gapPairs(Array.isArray(archive) ? archive : Object.values(archive)));
const shortDate = (iso) => {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
};

const KIND = { film: 'Film', series: 'Series', documentary: 'Documentary', reality: 'Reality', anime: 'Anime', special: 'Special' };
function meta(r) {
  const kind = KIND[r.kind] ?? r.kind;
  return [kind, (r.languages ?? []).map(lname).slice(0, 2).join(', ')].filter(Boolean).join(' · ');
}
const page = (r) => (r.slug ? `${SITE_URL}/ott-release-date/${r.slug}` : link);
const poster = (r) => {
  const m = String(r.posterUrl ?? '').match(/\/w\d+\/([A-Za-z0-9_-]+\.(?:jpg|jpeg|png))$/);
  return m ? `${SITE_URL}/img/w154/${m[1]}` : null;
};

// --- subject and preheader ---------------------------------------------------
// Names two titles rather than a count: "Mirzapur and Dhamaal 4 are out" is a
// reason to open, "30 new releases" is a statistic.
const lead = [...topStream, ...topCinema].sort(byInterest).slice(0, 2).map((r) => r.title);
const subject = `${range}: ${lead.join(' and ')}${rows.length > 2 ? ` + ${rows.length - 2} more` : ''}`;
const preheader = `${streaming.length} new on OTT and ${cinemas.length} in cinemas this week — and when the big ones reach OTT.`;

// --- html --------------------------------------------------------------------
/* The site's look, as the alert emails have it (worker/mail.js): near-black,
   the orange play mark, amber accents, posters. Tables and inline styles, with
   colours as attributes too, because that is what renders the same everywhere. */
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const BG = '#06070a', CARD = '#10131c', LINE = '#1f2432', TEXT = '#f2f4f9', MUTED = '#9aa3b6', AMBER = '#ffb03a';

const row = (r, note) => {
  const img = poster(r);
  return `
          <tr><td style="padding:0 0 14px 0;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
              ${img ? `<td width="62" style="width:62px;vertical-align:top;padding-right:14px;"><a href="${esc(page(r))}"><img src="${esc(img)}" width="62" alt="" style="display:block;width:62px;height:auto;border-radius:8px;border:0;"></a></td>` : ''}
              <td style="vertical-align:top;">
                <a href="${esc(page(r))}" style="font:700 17px/1.3 ${FONT};color:${TEXT};text-decoration:none;">${esc(r.title)}</a>
                <div style="font:400 14px/1.5 ${FONT};color:${MUTED};padding-top:3px;">${esc(meta(r))}</div>
                <div style="font:700 14px/1.5 ${FONT};color:${AMBER};padding-top:2px;">${esc(note)}</div>
              </td>
            </tr></table>
          </td></tr>`;
};
const streamNote = (r) =>
  `${r.platforms.filter((p) => p !== 'theatres').map(pname).join(' · ')}${r.releaseDate ? ` · ${shortDate(r.releaseDate)}` : ''}`;
const cinemaNote = (r) => {
  const est = estimateFor(r, ottWindows);
  return est ? `In cinemas · OTT expected around ${shortDate(est.likely)}` : `In cinemas from ${shortDate(r.releaseDate)}`;
};

const section = (title, list, note) =>
  list.length
    ? `
        <tr><td style="padding:6px 0 14px;font:800 12px/1 ${FONT};letter-spacing:1.6px;text-transform:uppercase;color:${AMBER};">${esc(title)}</td></tr>
        ${list.map((r) => row(r, note(r))).join('')}`
    : '';

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<title>${esc(subject)}</title>
</head>
<body style="margin:0;padding:0;background:${BG};" bgcolor="${BG}">
<div style="display:none;font-size:1px;color:${BG};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${BG}" style="background:${BG};">
<tr><td align="center" style="padding:28px 12px;">
  <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px;">
    <tr><td style="padding:0 4px 18px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        <td style="vertical-align:middle;padding-right:10px;"><a href="${SITE_URL}/"><img src="${SITE_URL}/icon-192.png" width="34" height="34" alt="" style="display:block;width:34px;height:34px;border-radius:9px;border:0;"></a></td>
        <td style="vertical-align:middle;font:700 19px/1 ${FONT};color:${TEXT};"><a href="${SITE_URL}/" style="color:${TEXT};text-decoration:none;">${esc(BRAND)}</a></td>
      </tr></table>
    </td></tr>
    <tr><td bgcolor="${CARD}" style="background:${CARD};border:1px solid ${LINE};border-radius:18px;padding:24px 22px 8px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr><td style="font:800 26px/1.15 ${FONT};color:${TEXT};letter-spacing:-0.4px;padding-bottom:6px;">This week, ${esc(range)}</td></tr>
        <tr><td style="font:400 15px/1.5 ${FONT};color:${MUTED};padding-bottom:20px;">${streaming.length} new on OTT across ${platformCount} platforms, ${cinemas.length} in cinemas.</td></tr>
        ${section('New on OTT this week', topStream, streamNote)}
        ${section('In cinemas now', topCinema, cinemaNote)}
        ${rest > 0 ? `<tr><td style="font:400 14px/1.5 ${FONT};color:${MUTED};padding:2px 0 16px;">…and ${rest} more on the full list.</td></tr>` : ''}
        <tr><td style="padding:4px 0 20px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
            <td bgcolor="${AMBER}" style="border-radius:999px;background:${AMBER};background-image:linear-gradient(90deg,#ff5a4d,#ffb03a);">
              <a href="${esc(link)}" style="display:inline-block;padding:13px 22px;font:800 15px/1 ${FONT};color:#111111;text-decoration:none;border-radius:999px;">See the full week &rarr;</a>
            </td>
          </tr></table>
        </td></tr>
      </table>
    </td></tr>
    <tr><td style="padding:20px 6px 0;font:400 13px/1.6 ${FONT};color:${MUTED};">
      <a href="${SITE_URL}/" style="color:${TEXT};text-decoration:none;font-weight:700;">newonott.in</a>
      &nbsp;·&nbsp; Every new release, every platform, one page.
      &nbsp;·&nbsp; <a href="https://www.instagram.com/newonott.in/" style="color:${MUTED};">Instagram</a>
    </td></tr>
    <tr><td style="padding:8px 6px 0;font:400 12px/1.6 ${FONT};color:#6b7385;">
      You're getting this because you subscribed at newonott.in. {{ unsubscribe }}<br>
      Release data from TMDB. This product uses the TMDB API but is not endorsed or certified by TMDB.
    </td></tr>
  </table>
</td></tr>
</table>
</body>
</html>
`;

// --- plain text --------------------------------------------------------------
const text = [
  `${BRAND} — ${range}`,
  `${streaming.length} new on OTT, ${cinemas.length} in cinemas.`,
  '',
  ...(topStream.length ? ['NEW ON OTT THIS WEEK', ...topStream.map((r) => `• ${r.title} — ${streamNote(r)} — ${meta(r)}`), ''] : []),
  ...(topCinema.length ? ['IN CINEMAS NOW', ...topCinema.map((r) => `• ${r.title} — ${cinemaNote(r)}`), ''] : []),
  ...(rest > 0 ? [`…and ${rest} more.`, ''] : []),
  `See the full week: ${link}`,
  '',
  'Release data from TMDB. This product uses the TMDB API but is not endorsed or certified by TMDB.',
  '{{ unsubscribe }}',
  '',
].join('\n');

await mkdir(OUT, { recursive: true });
await writeFile(resolve(OUT, 'subject.txt'), `${subject}\n`);
await writeFile(resolve(OUT, 'latest.html'), html);
await writeFile(resolve(OUT, 'latest.txt'), text);
/* Which week this is, so the Worker sends each week once (worker/newsletter.js). */
await writeFile(resolve(OUT, 'meta.json'), `${JSON.stringify({ weekId: week.id, builtAt: new Date().toISOString() })}\n`);

console.log(`Digest for ${range}: "${subject}"`);
console.log(`  ${topStream.length} streaming + ${topCinema.length} in cinemas featured, ${rest} more on the site`);
console.log(`  wrote email/subject.txt, latest.html, latest.txt, meta.json`);
