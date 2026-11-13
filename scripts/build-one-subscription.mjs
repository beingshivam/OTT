#!/usr/bin/env node
/**
 * "Ek hi subscription. Kaunsa?" — a seven-slide OTT carousel.
 *
 * Everyone in India is paying for too many apps and borrowing passwords for the
 * rest, so the question lands: if you could keep only one this weekend, which?
 * Each platform gets one slide and its single biggest new Indian title, and the
 * last slide asks for a vote by letter (P / N / S / J / Z) — one keystroke, and
 * a fight in the comments is the best distribution a post can get.
 *
 * Titles, dates, platforms, cast, runtime and director are read from the feed,
 * or from the archive when a title has aged out of the feed but is still
 * streaming. The one-line pitch per film is editorial and written from its
 * synopsis.
 *
 *   node scripts/build-one-subscription.mjs
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChromium } from './browser.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FEED = resolve(ROOT, process.env.FEED ?? 'public/data/releases.json');
const ARCHIVE = resolve(ROOT, process.env.ARCHIVE ?? 'data/archive.json');
const OUT = resolve(ROOT, 'social');
const SITE = 'https://newonott.in';
const TODAY = process.env.TODAY ?? new Date().toISOString().slice(0, 10);

const PICKS = [
  { platform: 'prime', letter: 'P', title: 'Jailer 2', pitch: 'Thalaivar goes undercover as a driver to protect his family.' },
  { platform: 'netflix', letter: 'N', title: 'Daayra', pitch: 'A cop with a record of staged encounters, cornered by Kareena.' },
  { platform: 'sonyliv', letter: 'S', title: 'Haiwaan', pitch: 'Saif and Akshay in a Priyadarshan revenge thriller.', posterBg: true },
  { platform: 'jiohotstar', letter: 'J', title: "I'm Game", pitch: 'Dulquer as a gambler who trusts luck more than life.' },
  { platform: 'zee5', letter: 'Z', title: 'Last Man in Tower', pitch: 'Manoj Bajpayee as the one man who won’t go along with his building.' },
];

const PLATFORM = {
  prime: { name: 'Prime Video', colour: '#1fb6ff', glow: '#0b3a55' },
  netflix: { name: 'Netflix', colour: '#ff3b3b', glow: '#4a0b0b' },
  sonyliv: { name: 'SonyLIV', colour: '#f2f2f2', glow: '#2b2b33' },
  jiohotstar: { name: 'JioHotstar', colour: '#a68bff', glow: '#22134d' },
  zee5: { name: 'ZEE5', colour: '#d08bff', glow: '#3a0f52' },
};
const LANG = { hi: 'Hindi', ta: 'Tamil', ml: 'Malayalam', te: 'Telugu', kn: 'Kannada', bn: 'Bengali' };

/* Each app's real icon, from the same list the site's platform chips use. */
const LOGOS = JSON.parse(await readFile(resolve(ROOT, 'public/data/logos.json'), 'utf8'));

const feed = JSON.parse(await readFile(FEED, 'utf8'));
const archive = JSON.parse(await readFile(ARCHIVE, 'utf8')).titles;
const archived = Array.isArray(archive) ? archive : Object.values(archive);
const feedRows = feed.weeks.flatMap((w) => w.releases);

/* The streaming row for a title on a platform: the feed first, then the
   archive — a film that arrived last Friday can age out of the feed while it
   is still very much on the service. */
function rowFor({ title, platform }) {
  const onIt = (r) => r.title === title && r.platforms.includes(platform);
  const row =
    feedRows.filter(onIt).find((r) => !r.platforms.includes('theatres')) ??
    archived.filter(onIt).sort((a, b) => (b.lastSeen ?? '').localeCompare(a.lastSeen ?? ''))[0] ??
    feedRows.find(onIt);
  if (!row) throw new Error(`"${title}" is not on ${platform} in the feed or the archive.`);
  return row;
}

/* When it reached the platform. A feed row that is theatres+OTT carries the
   cinema date, so the OTT arrival is read from the archive's OTT row. */
function arrivedOn(row, platform) {
  if (!row.platforms.includes('theatres')) return row.releaseDate;
  const ott = archived.find((r) => r.title === row.title && r.platforms.includes(platform) && !r.platforms.includes('theatres'));
  return ott?.releaseDate ?? null;
}

const day = (iso) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const runtime = (m) => (m ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : null);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const cache = new Map();
async function img(url, size) {
  if (!url) return null;
  const path = url.replace(/^https:\/\/image\.tmdb\.org\/t\/p\/w\d+/, `/img/${size}`);
  if (!cache.has(path)) {
    const res = await fetch(`${SITE}${path}`);
    if (!res.ok) throw new Error(`${path}: ${res.status}`);
    const mime = path.endsWith('.png') ? 'image/png' : 'image/jpeg';
    cache.set(path, `data:${mime};base64,${Buffer.from(await res.arrayBuffer()).toString('base64')}`);
  }
  return cache.get(path);
}

const picks = PICKS.map((p) => {
  const row = rowFor(p);
  const arrived = arrivedOn(row, p.platform);
  if (!LOGOS[p.platform]) throw new Error(`No logo for ${p.platform} in public/data/logos.json.`);
  return { ...p, row, arrived, ...PLATFORM[p.platform] };
});
for (const p of picks) p.icon = await img(LOGOS[p.platform], 'w300');
const icon = (p, size, radius = 0.22) =>
  `<img src="${p.icon}" style="width:${size}px;height:${size}px;border-radius:${Math.round(size * radius)}px;flex:none;display:block;box-shadow:0 10px 30px rgba(0,0,0,.45),0 0 0 1px rgba(255,255,255,.12)">`;

const head = `<!doctype html><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@500;600;700;800;900&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:1080px;height:1350px;background:#06070a;color:#f2f4f9;font-family:Inter,system-ui,sans-serif;overflow:hidden}
.slide{position:relative;width:1080px;height:1350px;padding:72px;display:flex;flex-direction:column;overflow:hidden}
.top{position:relative;display:flex;align-items:center;gap:16px;z-index:2}
.logo{width:46px;height:46px;border-radius:12px;display:grid;place-items:center;
  background:linear-gradient(135deg,#ff4d4d,#ffb03a);font-weight:900;font-size:24px;color:#fff}
.brand{font-size:30px;font-weight:700;letter-spacing:-.02em}
.page{margin-left:auto;font-size:22px;font-weight:800;letter-spacing:.12em;color:#c9cfdb}
.kicker{font-size:26px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#ffb03a}
h1{font-size:132px;font-weight:900;letter-spacing:-.05em;line-height:.9}
h2{font-size:92px;font-weight:900;letter-spacing:-.045em;line-height:.92}
.grad{background:linear-gradient(90deg,#ff5a4d,#ffb03a);-webkit-background-clip:text;color:transparent}
.sub{font-size:32px;font-weight:600;color:#c9cfdb;line-height:1.3}
.chip{display:inline-flex;align-items:center;gap:10px;font-size:22px;font-weight:800;padding:9px 18px;border-radius:999px;background:#ffffff14;color:#e7eaf2}
.letter{display:grid;place-items:center;width:64px;height:64px;border-radius:18px;font-size:38px;font-weight:900;color:#06070a;flex:none}
</style>`;

const top = (label) =>
  `<div class="top"><div class="logo">N</div><div class="brand">New on OTT</div><div class="page">${label}</div></div>`;

/* 1 — the hook: five posters, five apps, one choice. */
async function cover() {
  const strips = [];
  for (const [i, p] of picks.entries()) {
    strips.push(`<div style="flex:1;display:flex;flex-direction:column;gap:14px;transform:translateY(${[30, 0, 40, 10, 50][i]}px)">
      <div style="aspect-ratio:2/3;border-radius:20px;background:#151926 url(${await img(p.row.posterUrl, 'w500')}) center/cover;box-shadow:0 24px 60px rgba(0,0,0,.6)"></div>
      <div style="display:flex;flex-direction:column;align-items:center;gap:10px">${icon(p, 72)}
        <div style="font-size:20px;font-weight:800;color:#e7eaf2;text-align:center">${esc(p.name)}</div></div>
    </div>`);
  }
  return `<div class="slide" style="background:radial-gradient(90% 50% at 50% 0%,#2a1020 0%,#06070a 70%)">
    ${top('THIS WEEKEND')}
    <div style="margin-top:56px;display:flex;flex-direction:column;gap:20px;position:relative;z-index:2">
      <div class="kicker">Ek hi subscription. Kaunsa?</div>
      <h1>You can keep <span class="grad">only one.</span></h1>
      <div class="sub">5 apps. 5 big new Indian films. Your wallet allows one.</div>
    </div>
    <div style="margin-top:50px;display:flex;gap:16px">${strips.join('')}</div>
    <div style="flex:1"></div>
    <div style="display:flex;flex-direction:column;gap:12px;padding:26px 30px;border-radius:24px;background:#ffffff0d;border:1px solid #ffffff1a;margin-bottom:34px">
      <div style="font-size:22px;font-weight:800;letter-spacing:.14em;color:#ffb03a">THE RULES</div>
      <div style="font-size:30px;font-weight:700;line-height:1.3">One app for the whole weekend. No switching. No borrowed passwords. 😤</div>
    </div>
    <div style="display:flex;align-items:center;justify-content:space-between;position:relative;z-index:2">
      <div style="font-size:30px;font-weight:800">Swipe, then vote in the comments</div>
      <div style="font-size:30px;font-weight:900;color:#ffb03a">→</div>
    </div>
  </div>`;
}

/* 2–6 — one platform per slide, the case for keeping it. */
async function platformSlide(p, i) {
  const r = p.row;
  /* A backdrop is usually the better wide shot; where it is a dull still, the
     poster, blurred and enlarged, carries the slide instead. */
  const bg = p.posterBg || !r.backdropUrl ? await img(r.posterUrl, 'w500') : await img(r.backdropUrl, 'w780');
  const poster = await img(r.posterUrl, 'w500');
  const when = p.arrived ? (p.arrived === TODAY ? 'Out today' : p.arrived > TODAY ? `From ${day(p.arrived)}` : `Streaming since ${day(p.arrived)}`) : 'Streaming now';
  const facts = [r.languages.map((l) => LANG[l] ?? l).join(', '), runtime(r.runtimeMinutes), r.director ? `Dir. ${r.director}` : null].filter(Boolean);
  return `<div class="slide">
    <div style="position:absolute;inset:${p.posterBg ? '-40px' : '0'};background:url(${bg}) center/cover;${p.posterBg ? 'filter:blur(18px) saturate(1.2)' : ''}"></div>
    <div style="position:absolute;inset:0;background:linear-gradient(180deg,rgba(6,7,10,.75) 0%,rgba(6,7,10,.2) 22%,rgba(6,7,10,.55) 42%,#06070a 62%)"></div>
    <div style="position:absolute;inset:0;background:radial-gradient(80% 40% at 0% 100%,${p.glow}cc,transparent 70%)"></div>
    ${top(`OPTION ${i + 1} OF 5`)}
    <div style="margin-top:40px;position:relative;display:flex;align-items:center;gap:20px">
      ${icon(p, 96)}
      <div style="display:flex;flex-direction:column;gap:6px">
        <div style="font-size:60px;font-weight:900;letter-spacing:-.03em;line-height:1">Keep ${esc(p.name)}</div>
        <div style="font-size:22px;font-weight:800;letter-spacing:.12em;color:#c9cfdb">VOTE <span style="color:#06070a;background:${p.colour};border-radius:8px;padding:2px 10px;margin-left:4px">${p.letter}</span></div>
      </div>
    </div>
    <div style="flex:1"></div>
    <div style="position:relative;display:flex;gap:40px;align-items:flex-end">
      <div style="width:300px;flex:none;aspect-ratio:2/3;border-radius:22px;background:#151926 url(${poster}) center/cover;box-shadow:0 30px 80px rgba(0,0,0,.7)"></div>
      <div style="display:flex;flex-direction:column;gap:18px;min-width:0;padding-bottom:4px">
        <div class="kicker" style="color:${p.colour};font-size:22px">${esc(when)}</div>
        <h2>${esc(r.title)}</h2>
        <div style="font-size:28px;font-weight:700;color:#e7eaf2;line-height:1.25">${esc((r.cast ?? []).slice(0, 2).join(' · '))}</div>
        <div style="display:flex;flex-wrap:wrap;gap:10px">${facts.map((f) => `<span class="chip">${esc(f)}</span>`).join('')}</div>
      </div>
    </div>
    <div style="position:relative;margin-top:40px;padding-top:30px;border-top:1px solid #2a2f3d;font-size:36px;font-weight:700;line-height:1.3;letter-spacing:-.01em">
      <span style="color:${p.colour}">For:</span> ${esc(p.pitch)}
    </div>
  </div>`;
}

/* 7 — the vote. */
async function vote() {
  const rows = [];
  for (const p of picks) {
    rows.push(`<div style="display:flex;align-items:center;gap:24px;padding:18px 0;border-bottom:1px solid #1c2130">
      <div style="width:56px;height:56px;border-radius:50%;display:grid;place-items:center;flex:none;
        background:#ffb03a;color:#06070a;font-size:30px;font-weight:900">${p.letter}</div>
      ${icon(p, 84)}
      <div style="width:66px;flex:none;aspect-ratio:2/3;border-radius:10px;background:#151926 url(${await img(p.row.posterUrl, 'w500')}) center/cover"></div>
      <div style="display:flex;flex-direction:column;gap:4px;min-width:0">
        <div style="font-size:36px;font-weight:900;letter-spacing:-.02em">${esc(p.name)}</div>
        <div style="font-size:24px;font-weight:600;color:#9aa3b6">${esc(p.row.title)} · ${esc((p.row.cast ?? [])[0] ?? '')}</div>
      </div>
    </div>`);
  }
  return `<div class="slide" style="background:radial-gradient(110% 55% at 50% 100%,#2a1020 0%,#06070a 60%)">
    ${top('YOUR CALL')}
    <div style="margin-top:52px;display:flex;flex-direction:column;gap:16px">
      <h2>Comment <span class="grad">one letter.</span></h2>
      <div class="sub">P, N, S, J or Z 👇 Most votes gets its own post on Monday.</div>
    </div>
    <div style="margin-top:26px">${rows.join('')}</div>
    <div style="flex:1"></div>
    <div style="font-size:28px;font-weight:700;color:#e7eaf2;margin-bottom:22px">Tag the friend whose password you're using 👀</div>
    <div style="display:flex;align-items:baseline;gap:20px">
      <div class="grad" style="font-size:36px;font-weight:900;letter-spacing:-.02em">newonott.in</div>
      <div style="font-size:24px;font-weight:600;color:#9aa3b6">Every new release, every platform.</div>
    </div>
  </div>`;
}

const slides = [await cover(), ...(await Promise.all(picks.map(platformSlide))), await vote()];

await mkdir(OUT, { recursive: true });
const browser = await launchChromium('one-subscription');
const page = await browser.newPage({ viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 1 });
for (const [i, html] of slides.entries()) {
  await page.setContent(head + html.replace(/<div class="page">(.*?)<\/div>/, `<div class="page">$1 · ${i + 1}/${slides.length}</div>`), { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  const file = resolve(OUT, `one-sub-${i + 1}.jpg`);
  await page.screenshot({ path: file, type: 'jpeg', quality: 90 });
  console.log(`  ${file}`);
}
await browser.close();

const caption = [
  'Ek hi subscription rakh sakte ho is weekend. Kaunsa? 🤔',
  '',
  ...picks.map((p) => `${p.letter} — ${p.name}: ${p.row.title} (${(p.row.cast ?? [])[0]})`),
  '',
  'Comment ONE letter 👇 Most votes gets its own post on Monday.',
  'And tag the friend whose password you’re using 👀',
  '',
  '🔗 Every new release on every platform: newonott.in (link in bio)',
  '',
  '#NewOnOTT #OTTIndia #OTTReleases #WhatToWatch #KyaDekhein #Jailer2 #Daayra #Haiwaan #ImGame #LastManInTower #PrimeVideo #Netflix #SonyLIV #JioHotstar #ZEE5 #Rajinikanth #KareenaKapoorKhan #DulquerSalmaan',
].join('\n');
await writeFile(resolve(OUT, 'one-sub-caption.txt'), `${caption}\n`);
console.log(`\n${caption}`);
for (const p of picks) console.log(`  ${p.letter} ${p.row.title}: arrived ${p.arrived ?? '?'} (row ${p.row.id ?? ''})`);
