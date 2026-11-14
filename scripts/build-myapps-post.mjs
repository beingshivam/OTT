#!/usr/bin/env node
/**
 * One image announcing ★ My apps and "New on your apps" — a single post.
 *
 * Three real phone screens from the live site (social/features/myapps-*.png),
 * in the order a reader meets them: pick your apps, see what's new on them,
 * see what's coming to them.
 *
 *   CHROMIUM_PATH=/opt/pw-browsers/chromium node scripts/build-myapps-post.mjs
 */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChromium } from './browser.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const uri = async (p, type = 'image/png') => `data:${type};base64,${(await readFile(resolve(ROOT, p))).toString('base64')}`;
const shot = {
  pick: await uri('social/features/myapps-picker.png'),
  row: await uri('social/features/myapps-row.png'),
  soon: await uri('social/features/myapps-coming.png'),
};
const logo = await uri('public/icon-192.png');

const phone = (src, n, label, sub, tilt, lift, hero = false) => `
  <div style="display:flex;flex-direction:column;align-items:center;gap:14px;${hero ? 'z-index:2' : ''}">
    <div style="height:${hero ? 590 : 590}px;display:flex;align-items:flex-start">
    <div style="width:${hero ? 300 : 262}px;height:${hero ? 580 : 516}px;border-radius:42px;border:9px solid #1c2030;background:#0b0c10;overflow:hidden;
      box-shadow:0 36px 90px rgba(0,0,0,.75),0 0 0 2px ${hero ? 'rgba(255,176,58,.65)' : '#2a2f3d'}${hero ? ',0 0 70px rgba(255,176,58,.22)' : ''};
      transform:translateY(${lift}px) rotate(${tilt}deg)">
      <img src="${src}" style="display:block;width:100%;height:auto">
    </div>
    </div>
    <div style="text-align:center;max-width:310px;">
      <div style="font-size:26px;font-weight:900;letter-spacing:-.02em;line-height:1.1;white-space:nowrap">
        <span style="display:inline-grid;place-items:center;width:38px;height:38px;border-radius:50%;background:#ffb03a;color:#06070a;font-size:22px;margin-right:8px;vertical-align:3px">${n}</span>${label}</div>
      <div style="font-size:19px;font-weight:600;color:#9aa3b6;margin-top:6px;line-height:1.3">${sub}</div>
    </div>
  </div>`;

const html = `<!doctype html><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@500;600;700;800;900&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:1080px;height:1350px;background:#06070a;color:#f2f4f9;font-family:Inter,system-ui,sans-serif;overflow:hidden}
.grad{background:linear-gradient(90deg,#ffb03a,#ff5a4d);-webkit-background-clip:text;color:transparent}
.pill{display:inline-flex;align-items:center;gap:10px;font-size:21px;font-weight:700;color:#d6dbe6;background:#12151f;border:1px solid #232838;padding:10px 18px;border-radius:999px}
</style>
<div style="position:relative;width:1080px;height:1350px;overflow:hidden">
  <div style="position:absolute;inset:0;background:radial-gradient(60% 38% at 50% 58%,rgba(255,176,58,.16),transparent 70%),radial-gradient(80% 30% at 50% 0%,rgba(255,90,77,.10),transparent 70%)"></div>

  <div style="position:relative;padding:60px 64px 0">
    <div style="display:flex;align-items:center;gap:14px">
      <img src="${logo}" style="width:48px;height:48px;border-radius:12px">
      <div style="font-size:31px;font-weight:800;letter-spacing:-.02em">New on OTT</div>
      <div style="margin-left:auto;font-size:21px;font-weight:800;letter-spacing:.14em;color:#06070a;background:#ffb03a;padding:9px 16px;border-radius:999px">★ NEW</div>
    </div>
    <div style="margin-top:30px;font-size:92px;font-weight:900;letter-spacing:-.05em;line-height:.93">
      Stop checking 5 apps.<br><span class="grad">See only yours.</span>
    </div>
    <div style="margin-top:20px;font-size:27px;font-weight:600;color:#aab2c3;line-height:1.35">
      Pick the OTT apps you pay for — get one row of what's new on them, and what's coming.
    </div>
  </div>

  <div style="position:absolute;left:0;right:0;top:440px;display:flex;justify-content:center;align-items:flex-start;gap:30px">
    ${phone(shot.pick, 1, 'Pick your apps', 'Once. No login.', -4, 40)}
    ${phone(shot.row, 2, "What's new", 'Only on your apps', 0, 0, true)}
    ${phone(shot.soon, 3, "What's coming", 'The next 7 days', 4, 40)}
  </div>

  <div style="position:absolute;left:64px;right:64px;bottom:112px;display:flex;justify-content:center;gap:12px">
    <span class="pill">🔔 Alert when it streams</span>
    <span class="pill">📅 Expected OTT date</span>
    <span class="pill">📬 Friday list</span>
  </div>
  <div style="position:absolute;left:64px;right:64px;bottom:44px;display:flex;align-items:center;justify-content:space-between">
    <div style="font-size:44px;font-weight:900;letter-spacing:-.02em" class="grad">newonott.in</div>
    <div style="font-size:24px;font-weight:700;color:#c9cfdb">Free · Link in bio</div>
  </div>
</div>`;

const browser = await launchChromium('myapps-post');
const page = await browser.newPage({ viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 1 });
await page.setContent(html, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: resolve(ROOT, 'social/myapps-post.jpg'), type: 'jpeg', quality: 92 });
await browser.close();

const caption = `Netflix. Prime. Hotstar. Checking each one for what's new? Not anymore. ⭐

New on newonott.in — ★ My apps:

1️⃣ Pick the OTT apps you actually pay for (once, no login)
2️⃣ Your homepage now opens with "New on your apps" — everything that landed on them this week, with a count per app
3️⃣ Flip to "Coming" for what's arriving on your apps in the next 7 days
👉 Tap any app to see only that app

Also live:
🔔 Notify me — get an alert the day a film hits OTT
📅 Expected OTT date for every film still in cinemas
📬 The Friday list in your inbox

All free. Try it 👉 newonott.in (link in bio)

Which apps do you pay for? Drop them below 👇

#NewOnOTT #OTTIndia #OTTReleases #OTTUpdates #WhatToWatch #NewOnNetflix #PrimeVideo #JioHotstar #SonyLIV #ZEE5 #Netflix #Bollywood #TamilCinema #TeluguCinema #MalayalamCinema`;
await writeFile(resolve(ROOT, 'social/myapps-post-caption.txt'), `${caption}\n`);
console.log('wrote social/myapps-post.jpg and social/myapps-post-caption.txt');
