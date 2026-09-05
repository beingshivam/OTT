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

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FEED = resolve(ROOT, 'public/data/releases.json');
const OUT = resolve(ROOT, 'email');

const SITE_URL = (process.env.SITE_URL ?? 'https://newonott.in').replace(/\/$/, '');
const REGION = (process.env.REGIONS ?? 'IN').split(',')[0].trim() || 'IN';

/** How many titles the teaser names before it stops and points at the site. */
const TEASER = 6;

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

const rows = week.releases
  .filter((r) => r.regions.includes(REGION))
  .sort((a, b) => (b.heat ?? 0) - (a.heat ?? 0));

const range = formatRange(week.id);
const top = rows.slice(0, TEASER);
const rest = rows.length - top.length;
const platformCount = new Set(rows.flatMap((r) => r.platforms)).size;
const link = `${SITE_URL}/?w=${week.id}`;

/** "Film · Hindi · Crime" — the three things that decide whether it is for you. */
const KIND = { film: 'Film', series: 'Series', documentary: 'Documentary', reality: 'Reality', anime: 'Anime', special: 'Special' };
function meta(r) {
  const kind = KIND[r.kind] ?? r.kind;
  const genre = (r.genres ?? []).find((g) => g.toLowerCase() !== kind.toLowerCase());
  return [kind, (r.languages ?? []).map(lname).slice(0, 2).join(', '), genre].filter(Boolean).join(' · ');
}

// --- subject and preheader ---------------------------------------------------
// Names two titles rather than a count: "Mirzapur and Dhamaal 4 are out" is a
// reason to open, "30 new releases" is a statistic.
const headline = top.slice(0, 2).map((r) => r.title).join(' and ');
const subject = `${range}: ${headline}${rest > 0 ? ` + ${rows.length - 2} more` : ''}`;
const preheader = `${rows.length} releases across ${platformCount} platforms this week.`;

// --- html --------------------------------------------------------------------
const item = (r) => `
              <tr>
                <td style="padding:0 0 18px 0;">
                  <div style="font:600 17px/1.35 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#14161c;">
                    ${esc(r.title)}
                  </div>
                  <div style="font:400 14px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#6b7280;padding-top:2px;">
                    ${esc(r.platforms.map(pname).join(' · '))} &nbsp;•&nbsp; ${esc(meta(r))}
                  </div>
                </td>
              </tr>`;

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f4f5f7;">
  <!-- Preheader: the grey line beside the subject in most inboxes. Hidden in
       the body itself, which is why it carries its own zero-size styling. -->
  <div style="display:none;font-size:1px;color:#f4f5f7;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">
    ${esc(preheader)}
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f5f7;">
    <tr>
      <td align="center" style="padding:28px 12px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:14px;overflow:hidden;">
          <tr>
            <td style="padding:26px 28px 6px 28px;">
              <div style="font:700 18px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#14161c;">
                ${esc(BRAND)}
              </div>
              <div style="font:400 14px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#6b7280;padding-top:4px;">
                ${esc(range)} &nbsp;•&nbsp; ${rows.length} releases across ${platformCount} platforms
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 28px 0 28px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                ${top.map(item).join('')}
              </table>
            </td>
          </tr>
          ${
            rest > 0
              ? `<tr>
            <td style="padding:0 28px 6px 28px;">
              <div style="font:400 14px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#6b7280;">
                …and ${rest} more, including everything in cinemas.
              </div>
            </td>
          </tr>`
              : ''
          }
          <tr>
            <td style="padding:22px 28px 30px 28px;">
              <!-- The point of the email. Bulletproof enough for Outlook: a
                   table cell with a background, not a styled <button>. -->
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" bgcolor="#14161c" style="border-radius:999px;">
                    <a href="${esc(link)}" style="display:inline-block;padding:13px 26px;font:600 15px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#ffffff;text-decoration:none;border-radius:999px;">
                      See the full week
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:0 28px 26px 28px;border-top:1px solid #e6e8ec;">
              <div style="font:400 12px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#9aa1ad;padding-top:16px;">
                Every new release, every platform, one page — <a href="${esc(SITE_URL)}/" style="color:#6b7280;">${esc(SITE_URL.replace(/^https?:\/\//, ''))}</a><br>
                Ratings and release data from TMDB. This product uses the TMDB API but is not endorsed or certified by TMDB.<br>
                <!-- Most providers substitute their own unsubscribe link for this token; check yours. -->
                {{ unsubscribe }}
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;

// --- plain text --------------------------------------------------------------
// Not an afterthought: it is what some clients show, and what spam filters read
// when the HTML part is all they otherwise have.
const text = [
  `${BRAND} — ${range}`,
  `${rows.length} releases across ${platformCount} platforms.`,
  '',
  ...top.map((r) => `• ${r.title} — ${r.platforms.map(pname).join(' · ')} — ${meta(r)}`),
  ...(rest > 0 ? ['', `…and ${rest} more, including everything in cinemas.`] : []),
  '',
  `See the full week: ${link}`,
  '',
  'Ratings and release data from TMDB. This product uses the TMDB API but is not endorsed or certified by TMDB.',
  '{{ unsubscribe }}',
  '',
].join('\n');

await mkdir(OUT, { recursive: true });
await writeFile(resolve(OUT, 'subject.txt'), `${subject}\n`);
await writeFile(resolve(OUT, 'latest.html'), html);
await writeFile(resolve(OUT, 'latest.txt'), text);

console.log(`Digest for ${range}: "${subject}"`);
console.log(`  ${top.length} titles teased, ${rest} held back, link -> ${link}`);
console.log(`  wrote email/subject.txt, email/latest.html, email/latest.txt`);
