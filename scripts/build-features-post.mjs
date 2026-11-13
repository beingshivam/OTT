#!/usr/bin/env node
/**
 * The launch carousel for "expected OTT date" and "notify me when it streams".
 *
 * Five slides: the hook (the question every film fan types), the expected
 * date on a real page, the windows by language (the shareable fact), the
 * alert on a real phone, and an ask the site can actually keep — comment a
 * film, get its expected OTT date back.
 *
 * The product shots are real screenshots (social/features/*.png), taken on an
 * iPhone on 13 Nov, not mock-ups. The windows are measured from the archive
 * at build time, so the numbers on slide 3 are the ones the site uses.
 *
 *   CHROMIUM_PATH=/opt/pw-browsers/chromium node scripts/build-features-post.mjs
 */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChromium } from './browser.mjs';
import { gapPairs, windowStats } from '../src/lib/ott-estimate.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const A = (f) => resolve(ROOT, 'social/features', f);
const OUT = resolve(ROOT, 'social');

const uri = async (path, type) => `data:${type};base64,${(await readFile(path)).toString('base64')}`;
const img = {
  page: await uri(A('page.png'), 'image/png'),
  form: await uri(A('form.png'), 'image/png'),
  mail: await uri(A('mail.png'), 'image/png'),
  backdrop: await uri(A('ramayana-backdrop.jpg'), 'image/jpeg'),
  poster: await uri(A('ramayana-poster.jpg'), 'image/jpeg'),
  logo: await uri(resolve(ROOT, 'public/icon-192.png'), 'image/png'),
};

const archive = JSON.parse(await readFile(resolve(ROOT, 'data/archive.json'), 'utf8')).titles;
const stats = windowStats(gapPairs(Array.isArray(archive) ? archive : Object.values(archive)));
const LANGS = [
  ['hi', 'Hindi'],
  ['ml', 'Malayalam'],
  ['ta', 'Tamil'],
  ['te', 'Telugu'],
];
const windows = LANGS.filter(([c]) => stats.byLanguage[c]).map(([c, name]) => ({ name, ...stats.byLanguage[c] }));
const films = stats.all?.n ?? windows.reduce((n, w) => n + w.n, 0);
const weeks = (d) => (d % 7 === 0 ? `${d / 7} weeks` : `${d} days`);

const head = `<!doctype html><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@500;600;700;800;900&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:1080px;height:1350px;background:#06070a;color:#f2f4f9;font-family:Inter,system-ui,sans-serif;overflow:hidden}
.slide{position:relative;width:1080px;height:1350px;padding:72px;display:flex;flex-direction:column;overflow:hidden}
.top{position:relative;z-index:2;display:flex;align-items:center;gap:16px}
.top img{width:48px;height:48px;border-radius:12px}
.brand{font-size:31px;font-weight:800;letter-spacing:-.02em}
.page{margin-left:auto;font-size:22px;font-weight:800;letter-spacing:.12em;color:#c9cfdb}
.kicker{font-size:25px;font-weight:800;letter-spacing:.15em;text-transform:uppercase;color:#ffb03a}
h1{font-size:112px;font-weight:900;letter-spacing:-.05em;line-height:.92}
h2{font-size:80px;font-weight:900;letter-spacing:-.045em;line-height:.95}
.grad{background:linear-gradient(90deg,#ff5a4d,#ffb03a);-webkit-background-clip:text;color:transparent}
.sub{font-size:33px;font-weight:600;color:#c9cfdb;line-height:1.32}
.phone{border-radius:44px;border:10px solid #1c2030;background:#0b0c10;overflow:hidden;box-shadow:0 40px 90px rgba(0,0,0,.65),0 0 0 2px #2a2f3d}
.phone img{display:block;width:100%}
.pill{display:inline-flex;align-items:center;gap:12px;font-size:28px;font-weight:800;padding:16px 26px;border-radius:999px;background:linear-gradient(90deg,#ff5a4d,#ffb03a);color:#111}
</style>`;

const top = (label) =>
  `<div class="top"><img src="${img.logo}"><div class="brand">New on OTT</div><div class="page">${label}</div></div>`;

const slides = [
  /* 1 — the hook: the sentence every film fan has typed. */
  `<div class="slide">
    <div style="position:absolute;inset:0;background:url(${img.backdrop}) center/cover"></div>
    <div style="position:absolute;inset:0;background:linear-gradient(180deg,rgba(6,7,10,.55) 0%,rgba(6,7,10,.2) 30%,rgba(6,7,10,.85) 58%,#06070a 74%)"></div>
    ${top('NEW FEATURE')}
    <div style="flex:1"></div>
    <div style="position:relative;display:flex;flex-direction:column;gap:26px">
      <div class="kicker">Stop searching</div>
      <h1>"OTT pe kab <span class="grad">aayegi?"</span></h1>
      <div class="sub">Every film in cinemas now shows its expected OTT date — and we'll ping you the day it actually streams.</div>
      <div><span class="pill">Swipe to see how →</span></div>
    </div>
  </div>`,

  /* 2 — the expected date, on the real page. */
  `<div class="slide" style="background:radial-gradient(120% 60% at 0% 0%,#2a1020 0%,#06070a 60%)">
    ${top('1 · EXPECTED DATE')}
    <div style="margin-top:46px;display:flex;flex-direction:column;gap:16px">
      <div class="kicker">On every film in cinemas</div>
      <h2>When it'll <span class="grad">hit OTT.</span></h2>
      <div class="sub" style="font-size:29px">Not a rumour — measured from how long ${films} real Indian films actually took.</div>
    </div>
    <div style="margin-top:44px;display:flex;justify-content:center">
      <div class="phone" style="width:740px"><img src="${img.page}"></div>
    </div>
  </div>`,

  /* 3 — the shareable fact. */
  `<div class="slide" style="background:radial-gradient(110% 55% at 100% 0%,#2b1a05 0%,#06070a 60%)">
    ${top('THE DATA')}
    <div style="margin-top:56px;display:flex;flex-direction:column;gap:16px">
      <div class="kicker">Cinema → OTT, typically</div>
      <h2>How long till <span class="grad">OTT?</span></h2>
    </div>
    <div style="margin-top:56px;display:flex;flex-direction:column;gap:34px">
      ${windows
        .map(
          (w) => `<div>
        <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:12px">
          <div style="font-size:44px;font-weight:800;letter-spacing:-.02em">${w.name}</div>
          <div style="font-size:44px;font-weight:900;color:#ffb03a">${weeks(w.median)}</div>
        </div>
        <div style="height:26px;border-radius:999px;background:#151926;overflow:hidden">
          <div style="height:100%;width:${Math.round((w.median / 60) * 100)}%;border-radius:999px;background:linear-gradient(90deg,#ff5a4d,#ffb03a)"></div>
        </div>
      </div>`,
        )
        .join('')}
    </div>
    <div style="flex:1"></div>
    <div style="display:flex;align-items:center;gap:26px;padding:26px 30px;border-radius:26px;background:#10131c;border:1px solid #1f2432">
      <img src="${img.poster}" style="width:92px;border-radius:12px;flex:none">
      <div style="display:flex;flex-direction:column;gap:8px">
        <div style="font-size:21px;font-weight:800;letter-spacing:.12em;color:#ffb03a">FOR EXAMPLE</div>
        <div style="font-size:31px;font-weight:800;line-height:1.25">Ramayana: in cinemas 5 Nov →<br>expected on OTT around 31 Dec</div>
      </div>
    </div>
    <div style="margin-top:22px;font-size:22px;font-weight:600;color:#9aa3b6;line-height:1.4">Median gap between cinema release and OTT premiere, across ${films} Indian films tracked by newonott.in. Save this.</div>
  </div>`,

  /* 4 — the alert, on a real phone. */
  `<div class="slide" style="background:radial-gradient(120% 60% at 50% 0%,#14203a 0%,#06070a 60%)">
    ${top('2 · ALERTS')}
    <div style="margin-top:46px;display:flex;flex-direction:column;gap:16px">
      <div class="kicker">Tap once. Forget it.</div>
      <h2>We'll ping you the day it <span class="grad">streams.</span></h2>
    </div>
    <div style="position:relative;margin-top:40px;flex:1">
      <div class="phone" style="position:absolute;left:0;top:0;width:620px"><img src="${img.form}"></div>
      <div class="phone" style="position:absolute;right:10px;top:285px;width:380px;transform:rotate(2.5deg)"><img src="${img.mail}"></div>
      <div style="position:absolute;left:20px;top:330px;width:440px;display:flex;flex-direction:column;gap:22px">
        <div style="font-size:30px;font-weight:800;line-height:1.3">1. Open any film still in cinemas</div>
        <div style="font-size:30px;font-weight:800;line-height:1.3">2. Tap <span style="color:#ffb03a">Notify me</span> — or drop your email</div>
        <div style="font-size:30px;font-weight:800;line-height:1.3">3. Get one alert the day it lands on OTT</div>
      </div>
    </div>
    <div class="sub" style="position:relative;font-size:27px">Phone notification on Android · email on iPhone · one alert, no spam.</div>
  </div>`,

  /* 5 — the ask, and one the site can keep. */
  `<div class="slide" style="background:radial-gradient(110% 55% at 50% 100%,#2a1020 0%,#06070a 60%)">
    ${top('YOUR TURN')}
    <div style="flex:1"></div>
    <div style="display:flex;flex-direction:column;gap:28px">
      <h1 style="font-size:104px">Waiting for a film to hit <span class="grad">OTT?</span></h1>
      <div class="sub" style="font-size:36px">Comment its name 👇<br>We'll reply with its expected OTT date.</div>
    </div>
    <div style="flex:1"></div>
    <div style="display:flex;flex-direction:column;gap:14px;padding:30px 34px;border-radius:28px;background:#10131c;border:1px solid #1f2432">
      <div style="font-size:26px;font-weight:700;color:#9aa3b6">Or check it yourself — and turn on alerts:</div>
      <div style="font-size:52px;font-weight:900;letter-spacing:-.02em" class="grad">newonott.in</div>
      <div style="font-size:24px;font-weight:600;color:#9aa3b6">Link in bio · every new release, every platform</div>
    </div>
  </div>`,
];

const browser = await launchChromium('features-post');
const page = await browser.newPage({ viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 1 });
for (const [i, html] of slides.entries()) {
  await page.setContent(head + html.replace(/<div class="page">(.*?)<\/div>/, `<div class="page">$1 · ${i + 1}/${slides.length}</div>`), { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: resolve(OUT, `features-${i + 1}.jpg`), type: 'jpeg', quality: 90 });
}
await browser.close();

const caption = [
  '"OTT pe kab aayegi?" — you don\'t have to keep searching any more. 🍿',
  '',
  'New on newonott.in:',
  '',
  '📅 Expected OTT date on every film still in cinemas — measured from how long real films took, not rumours',
  `🔔 "Notify me when it streams" — one tap, and we'll ping you the day it lands (phone notification on Android, email on iPhone)`,
  '',
  'How long films take to reach OTT right now:',
  ...windows.map((w) => `• ${w.name}: ${weeks(w.median)}`),
  '',
  'Waiting for a film? Comment its name 👇 we\'ll reply with its expected OTT date.',
  'Save this for the next time someone asks "OTT pe kab aayegi?"',
  '',
  '🔗 newonott.in (link in bio)',
  '',
  '#NewOnOTT #OTTReleaseDate #OTTIndia #OTTUpdates #KabAayegi #WhatToWatch #Ramayana #PrimeVideo #Netflix #JioHotstar #SonyLIV #ZEE5 #Bollywood #TamilCinema #TeluguCinema #MalayalamCinema',
].join('\n');
await writeFile(resolve(OUT, 'features-caption.txt'), `${caption}\n`);
console.log(caption);
