#!/usr/bin/env node
/**
 * The week as a five-slide carousel: the hook, what is streaming now, the big
 * OTT arrival, what is only in cinemas, and a numbered ask.
 *
 * The grid post lists the week; this one sells it. Every title is numbered
 * across the slides so the last one can ask "which number first?" — a reply
 * that costs the reader one keystroke, which is the comment people actually
 * leave.
 *
 * Every fact is read from the feed: title, date, platform, language, cast,
 * and the theatre-to-OTT gap, which is two rows of the same film. Nothing
 * here is typed in by hand except which titles lead.
 *
 *   FEED=public/data/releases.json node scripts/build-weekend-carousel.mjs
 *
 * Posters come through the site's own /img proxy, so this runs anywhere that
 * can reach newonott.in, without needing image.tmdb.org.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChromium } from './browser.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FEED = resolve(ROOT, process.env.FEED ?? 'public/data/releases.json');
const OUT = resolve(ROOT, 'social');
const SITE = 'https://newonott.in';

/* Which titles lead. Editorial, so it is the one thing set by hand. */
const WEEK = process.env.WEEK ?? '2026-11-06';
const STREAMING = ['Haiwaan', "I'm Game", 'Last Man in Tower'];
const ARRIVING = 'Jailer 2';
const CINEMAS = ['Ramayana: Rise of a Legend', 'Mookuthi Amman 2', 'Disco', 'Bouma'];

const feed = JSON.parse(await readFile(FEED, 'utf8'));
const week = feed.weeks.find((w) => w.id === WEEK);
if (!week) throw new Error(`No week ${WEEK} in the feed.`);
const all = feed.weeks.flatMap((w) => w.releases);

const LANG = { hi: 'Hindi', ta: 'Tamil', ml: 'Malayalam', te: 'Telugu', kn: 'Kannada' };
const PLATFORM = {
  prime: ['Prime Video', '#1fb6ff'],
  sonyliv: ['SonyLIV', '#f5f5f5'],
  jiohotstar: ['JioHotstar', '#9b7bff'],
  zee5: ['ZEE5', '#c77dff'],
  netflix: ['Netflix', '#ff3b3b'],
  theatres: ['In cinemas', '#ffb03a'],
};

const day = (iso, opts = { weekday: 'short', day: 'numeric', month: 'short' }) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { ...opts, timeZone: 'UTC' });

/* The row on the OTT side for streaming titles, and the cinema row for the
   theatrical ones — Ramayana opened the week before and is still running. */
const find = (title, platformTest) => {
  const rows = all.filter((r) => r.title === title && platformTest(r));
  const row = rows.sort((a, b) => b.releaseDate.localeCompare(a.releaseDate))[0];
  if (!row) throw new Error(`"${title}" is not in the feed as expected.`);
  return row;
};
const isOtt = (r) => !r.platforms.includes('theatres');
const isCinema = (r) => r.platforms.includes('theatres');

const streaming = STREAMING.map((t) => find(t, isOtt));
const arriving = find(ARRIVING, isOtt);
const arrivingInCinemas = all.find((r) => r.title === ARRIVING && isCinema(r));
const cinemas = CINEMAS.map((t) => find(t, isCinema));

const gapDays = arrivingInCinemas
  ? Math.round((Date.parse(arriving.releaseDate) - Date.parse(arrivingInCinemas.releaseDate)) / 86_400_000)
  : null;

/* Inline every image so the render never waits on the network. */
const cache = new Map();
async function img(url, size) {
  if (!url) return null;
  const path = url.replace(/^https:\/\/image\.tmdb\.org\/t\/p\/w\d+/, `/img/${size}`);
  if (cache.has(path)) return cache.get(path);
  const res = await fetch(`${SITE}${path}`);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  const data = `data:image/jpeg;base64,${Buffer.from(await res.arrayBuffer()).toString('base64')}`;
  cache.set(path, data);
  return data;
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const plat = (r) => PLATFORM[r.platforms[0]] ?? [r.platforms[0], '#fff'];
const lang = (r) => r.languages.map((l) => LANG[l] ?? l).join(', ');
const stars = (r, n = 2) => (r.cast ?? []).slice(0, n).join(' · ');

let n = 0;
const numbered = [];
const num = (r) => {
  n += 1;
  numbered.push({ n, r });
  return n;
};

const head = `<!doctype html><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@500;600;700;800;900&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:1080px;height:1350px;background:#06070a;color:#f2f4f9;font-family:Inter,system-ui,sans-serif;overflow:hidden}
.slide{position:relative;width:1080px;height:1350px;padding:72px;display:flex;flex-direction:column}
.bg{position:absolute;inset:0;background-size:cover;background-position:center}
.scrim{position:absolute;inset:0}
.top{position:relative;display:flex;align-items:center;gap:16px}
.logo{width:46px;height:46px;border-radius:12px;display:grid;place-items:center;
  background:linear-gradient(135deg,#ff4d4d,#ffb03a);font-weight:900;font-size:24px;color:#fff}
.brand{font-size:30px;font-weight:700;letter-spacing:-.02em}
.page{margin-left:auto;font-size:22px;font-weight:800;letter-spacing:.12em;color:#c9cfdb}
.kicker{font-size:24px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#ffb03a}
h1{font-size:118px;font-weight:900;letter-spacing:-.045em;line-height:.92}
h1 em,h2 em{font-style:normal;background:linear-gradient(90deg,#ff5a4d,#ffb03a);-webkit-background-clip:text;color:transparent}
h2{font-size:84px;font-weight:900;letter-spacing:-.04em;line-height:.95}
.sub{font-size:32px;font-weight:600;color:#c9cfdb;line-height:1.3}
.num{display:inline-grid;place-items:center;width:52px;height:52px;border-radius:50%;
  background:#ffb03a;color:#06070a;font-weight:900;font-size:28px;flex:none}
.swipe{font-size:28px;font-weight:800;color:#06070a;background:#fff;border-radius:999px;padding:16px 30px;align-self:flex-start}
.url{font-size:34px;font-weight:900;letter-spacing:-.02em;background:linear-gradient(90deg,#ff5a4d,#ffb03a);-webkit-background-clip:text;color:transparent}
.pill{display:inline-block;font-size:22px;font-weight:800;padding:8px 16px;border-radius:999px;border:2px solid currentColor}
</style>`;

const top = (page) => `<div class="top"><div class="logo">N</div><div class="brand">New on OTT</div>
  <div class="page">${page}</div></div>`;

const range = `${day(week.start, { day: 'numeric' })}–${day(week.end, { day: 'numeric', month: 'short' })}`.toUpperCase();

/* 1 — the hook. Two faces, two places to watch them. */
async function cover() {
  const left = await img(arriving.backdropUrl ?? arriving.posterUrl, 'w780');
  const right = await img(cinemas[0].posterUrl, 'w500');
  return `<div class="slide">
    <div class="bg" style="left:0;right:50%;background-image:url(${left});background-position:72% 30%;background-size:auto 100%"></div>
    <div class="bg" style="left:50%;right:0;background-image:url(${right})"></div>
    <div class="scrim" style="background:linear-gradient(180deg,rgba(6,7,10,.55) 0%,rgba(6,7,10,.05) 22%,rgba(6,7,10,.2) 45%,rgba(6,7,10,.92) 66%,#06070a 80%)"></div>
    ${top(range)}
    <div style="flex:1"></div>
    <div style="position:relative;display:flex;flex-direction:column;gap:26px">
      <div class="kicker">This week · OTT + cinemas</div>
      <h1>Thalaivar on OTT.<br><em>Ramayana</em> on the big screen.</h1>
      <div class="sub">8 big Indian releases this week — and exactly where to watch each one.</div>
      <div class="swipe">Swipe → your weekend, sorted</div>
    </div>
  </div>`;
}

/* 2 — streaming now: three posters, three platforms. */
async function nowStreaming() {
  const tiles = [];
  for (const r of streaming) {
    const [name, colour] = plat(r);
    tiles.push(`<div style="flex:1;display:flex;flex-direction:column;gap:18px">
      <div style="position:relative;aspect-ratio:2/3;border-radius:22px;overflow:hidden;background:#151926 url(${await img(r.posterUrl, 'w500')}) center/cover">
        <span class="num" style="position:absolute;top:14px;left:14px">${num(r)}</span></div>
      <div style="font-size:38px;font-weight:900;letter-spacing:-.02em;line-height:1.05">${esc(r.title)}</div>
      <div style="font-size:21px;font-weight:600;color:#9aa3b6;line-height:1.3">${esc(stars(r))}</div>
      <div><span class="pill" style="color:${colour}">${esc(name)}</span></div>
      <div style="font-size:20px;font-weight:700;color:#c9cfdb">${esc(lang(r))} · ${esc(day(r.releaseDate))}</div>
    </div>`);
  }
  return `<div class="slide" style="background:radial-gradient(120% 60% at 0% 0%,#2a1020 0%,#06070a 60%)">
    ${top('STREAMING NOW')}
    <div style="margin-top:64px;display:flex;flex-direction:column;gap:18px">
      <div class="kicker">Out now · watch tonight</div>
      <h2>Already on your <em>TV.</em></h2>
    </div>
    <div style="margin-top:56px;display:flex;gap:28px">${tiles.join('')}</div>
    <div style="flex:1"></div>
    <div style="display:flex;align-items:center;gap:18px;padding-top:28px;border-top:1px solid #1f2432">
      <div style="font-size:28px;font-weight:800">Next: Thalaivar's OTT date</div>
      <div style="margin-left:auto;font-size:28px;font-weight:900;color:#ffb03a">Swipe →</div>
    </div>
  </div>`;
}

/* 3 — the arrival, full bleed, with the theatre-to-OTT gap as the fact. */
async function arrival() {
  const bg = await img(arriving.backdropUrl ?? arriving.posterUrl, 'w780');
  const poster = await img(arriving.posterUrl, 'w500');
  const [name, colour] = plat(arriving);
  return `<div class="slide">
    <div class="bg" style="background-image:url(${bg});filter:saturate(1.1)"></div>
    <div class="scrim" style="background:linear-gradient(180deg,rgba(6,7,10,.6) 0%,rgba(6,7,10,.15) 25%,rgba(6,7,10,.75) 52%,#06070a 70%)"></div>
    ${top('COMING THURSDAY')}
    <div style="flex:1"></div>
    <div style="position:relative;display:flex;gap:40px;align-items:flex-end">
      <div style="width:300px;flex:none;aspect-ratio:2/3;border-radius:22px;background:url(${poster}) center/cover;box-shadow:0 30px 80px rgba(0,0,0,.7)"></div>
      <div style="display:flex;flex-direction:column;gap:18px;padding-bottom:6px">
        <span class="num">${num(arriving)}</span>
        <h2 style="font-size:100px">${esc(arriving.title)}</h2>
        <div class="sub" style="font-size:28px">${esc(stars(arriving, 3))}</div>
        <div><span class="pill" style="color:${colour}">${esc(name)} · ${esc(day(arriving.releaseDate))}</span></div>
      </div>
    </div>
    ${gapDays ? `<div style="position:relative;margin-top:44px;padding-top:30px;border-top:1px solid #2a2f3d;display:flex;align-items:baseline;gap:22px">
      <div style="font-size:92px;font-weight:900;letter-spacing:-.04em;color:#ffb03a;line-height:1;white-space:nowrap;flex:none">${gapDays} days</div>
      <div style="font-size:28px;font-weight:600;color:#c9cfdb;line-height:1.3">from cinemas (${esc(day(arrivingInCinemas.releaseDate, { day: 'numeric', month: 'short' }))}) to your sofa. Missed it in the theatre? Thursday's sorted.</div>
    </div>` : ''}
  </div>`;
}

/* 4 — only in cinemas: the ones OTT can't give you yet. */
async function inCinemas() {
  const tiles = [];
  for (const r of cinemas) {
    const opens = r.releaseDate > week.start ? `Opens ${day(r.releaseDate)}` : r.releaseDate < week.start ? `Running since ${day(r.releaseDate, { day: 'numeric', month: 'short' })}` : `Out ${day(r.releaseDate)}`;
    tiles.push(`<div style="display:flex;gap:22px;align-items:center;background:#10131c;border:1px solid #1f2432;border-radius:24px;padding:18px">
      <div style="position:relative;width:200px;flex:none;aspect-ratio:2/3;border-radius:14px;background:#151926 url(${await img(r.posterUrl, 'w500')}) center/cover"></div>
      <div style="display:flex;flex-direction:column;gap:10px;min-width:0">
        <span class="num" style="width:44px;height:44px;font-size:24px">${num(r)}</span>
        <div style="font-size:32px;font-weight:900;letter-spacing:-.02em;line-height:1.05">${esc(r.title.replace(/:.*/, ''))}</div>
        <div style="font-size:20px;font-weight:600;color:#9aa3b6;line-height:1.3">${esc(stars(r))}</div>
        <div style="font-size:20px;font-weight:800;color:#ffb03a">${esc(lang(r))} · ${esc(opens)}</div>
      </div>
    </div>`);
  }
  return `<div class="slide" style="background:radial-gradient(110% 55% at 100% 0%,#2b1a05 0%,#06070a 60%)">
    ${top('ONLY IN CINEMAS')}
    <div style="margin-top:64px;display:flex;flex-direction:column;gap:18px">
      <div class="kicker">No OTT date yet</div>
      <h2>Worth the <em>ticket.</em></h2>
    </div>
    <div style="margin-top:48px;display:grid;grid-template-columns:1fr 1fr;gap:22px">${tiles.join('')}</div>
    <div style="flex:1"></div>
    <div style="padding-top:28px;border-top:1px solid #1f2432;font-size:26px;font-weight:600;color:#c9cfdb;line-height:1.35">
      Waiting for OTT? The day a date is announced, it's on <span style="font-weight:900;color:#ffb03a">newonott.in</span>.
    </div>
  </div>`;
}

/* 5 — the ask. Numbers are cheaper to type than opinions. */
function ask() {
  const rows = numbered
    .sort((a, b) => a.n - b.n)
    .map(({ n: i, r }) => {
      const [name, colour] = plat(r);
      return `<div style="display:flex;align-items:center;gap:22px;padding:15px 0;border-bottom:1px solid #1c2130">
        <span class="num" style="width:46px;height:46px;font-size:24px">${i}</span>
        <div style="font-size:34px;font-weight:800;letter-spacing:-.02em;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(r.title.replace(/:.*/, ''))}</div>
        <div style="font-size:24px;font-weight:800;color:${colour}">${esc(name)}</div>
      </div>`;
    });
  return `<div class="slide" style="background:radial-gradient(120% 60% at 50% 100%,#2a1020 0%,#06070a 60%)">
    ${top(range)}
    <div style="margin-top:56px;display:flex;flex-direction:column;gap:16px">
      <h2>Which one <em>first?</em></h2>
      <div class="sub">Comment the number 👇  Send this to the friend who never knows what to watch.</div>
    </div>
    <div style="margin-top:30px">${rows.join('')}</div>
    <div style="flex:1"></div>
    <div style="display:flex;align-items:baseline;gap:20px">
      <div class="url">newonott.in</div>
      <div style="font-size:24px;font-weight:600;color:#9aa3b6">Every release, every platform. Follow for Friday's list.</div>
    </div>
  </div>`;
}

const slides = [await cover(), await nowStreaming(), await arrival(), await inCinemas(), ask()];
const pageCount = slides.length;

await mkdir(OUT, { recursive: true });
const browser = await launchChromium('carousel');
const page = await browser.newPage({ viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 1 });
for (const [i, html] of slides.entries()) {
  await page.setContent(head + html.replace(/<div class="page">(.*?)<\/div>/, `<div class="page">$1 · ${i + 1}/${pageCount}</div>`), { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  const file = resolve(OUT, `week-carousel-${i + 1}.jpg`);
  await page.screenshot({ path: file, type: 'jpeg', quality: 90 });
  console.log(`  ${file}`);
}
await browser.close();

/* The caption, built from the same rows as the slides. */
const line = ({ n: i, r }) => `${i}. ${r.title.replace(/:.*/, '')} — ${plat(r)[0]}${isCinema(r) ? '' : `, ${day(r.releaseDate)}`}`;
const caption = [
  `Thalaivar is coming home, Ramayana is still owning the big screen, and three new films dropped on OTT this Friday. 🍿`,
  '',
  `Your ${day(week.start, { day: 'numeric' })}–${day(week.end, { day: 'numeric', month: 'short' })} watchlist:`,
  '',
  ...numbered.map(line),
  '',
  gapDays ? `${ARRIVING} lands on ${plat(arriving)[0]} ${gapDays} days after it opened in cinemas.` : '',
  '',
  'Which one are you watching first? Comment the number 👇',
  'Save this for the weekend, and send it to the friend who always asks "kya dekhein?"',
  '',
  '🔗 Every release, every platform: newonott.in (link in bio)',
  '',
  '#Jailer2 #Rajinikanth #Ramayana #Haiwaan #ImGame #NewOnOTT #OTTReleases #OTTIndia #WhatToWatch #KyaDekhein #PrimeVideo #SonyLIV #JioHotstar #ZEE5 #TamilCinema #MalayalamCinema #Bollywood',
]
  .filter((l, i, a) => !(l === '' && a[i - 1] === ''))
  .join('\n');
await writeFile(resolve(OUT, 'week-carousel-caption.txt'), `${caption}\n`);
console.log(`\n${caption}`);
