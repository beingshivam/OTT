#!/usr/bin/env node
/**
 * One image announcing what is new on New on OTT — for a single-post launch.
 *
 * Three real screens side by side (social/features/screen-*.png), not
 * mock-ups: the expected OTT date on a live title page, the alert email as it
 * landed in Gmail, and the Friday list as it now looks. The headline is the
 * question every film fan types.
 *
 *   CHROMIUM_PATH=/opt/pw-browsers/chromium node scripts/build-launch-post.mjs
 */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChromium } from './browser.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const uri = async (p, type = 'image/png') => `data:${type};base64,${(await readFile(resolve(ROOT, p))).toString('base64')}`;
const screens = {
  page: await uri('social/features/screen-page.png'),
  mail: await uri('social/features/screen-mail.png'),
  digest: await uri('social/features/screen-digest.png'),
};
const logo = await uri('public/icon-192.png');
const backdrop = await uri('social/features/ramayana-backdrop.jpg', 'image/jpeg');

/* Screens are shown at full width and top-aligned, never cropped at the
   sides: they are real phone screenshots and should read as one. */
const phone = (src, label, sub, tilt, lift) => `
  <div style="display:flex;flex-direction:column;align-items:center;gap:22px">
    <div style="height:640px;display:flex;align-items:flex-start">
    <div style="width:292px;height:600px;border-radius:40px;border:9px solid #1c2030;background:#0b0c10;overflow:hidden;
      box-shadow:0 36px 80px rgba(0,0,0,.7),0 0 0 2px #2a2f3d;transform:translateY(${lift}px) rotate(${tilt}deg)">
      <img src="${src}" style="display:block;width:100%;height:auto">
    </div>
    </div>
    <div style="text-align:center;max-width:300px">
      <div style="font-size:29px;font-weight:900;letter-spacing:-.02em;line-height:1.1">${label}</div>
      <div style="font-size:20px;font-weight:600;color:#9aa3b6;margin-top:6px;line-height:1.3">${sub}</div>
    </div>
  </div>`;

const html = `<!doctype html><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@500;600;700;800;900&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:1080px;height:1350px;background:#06070a;color:#f2f4f9;font-family:Inter,system-ui,sans-serif;overflow:hidden}
.grad{background:linear-gradient(90deg,#ff5a4d,#ffb03a);-webkit-background-clip:text;color:transparent}
</style>
<div style="position:relative;width:1080px;height:1350px;overflow:hidden">
  <div style="position:absolute;inset:0;background:url(${backdrop}) center 20%/cover;opacity:.28;filter:blur(2px)"></div>
  <div style="position:absolute;inset:0;background:linear-gradient(180deg,rgba(6,7,10,.55) 0%,#06070a 46%)"></div>
  <div style="position:absolute;inset:0;background:radial-gradient(70% 40% at 50% 100%,rgba(255,90,77,.18),transparent 70%)"></div>

  <div style="position:relative;padding:64px 64px 0;display:flex;flex-direction:column;gap:18px">
    <div style="display:flex;align-items:center;gap:14px">
      <img src="${logo}" style="width:48px;height:48px;border-radius:12px">
      <div style="font-size:31px;font-weight:800;letter-spacing:-.02em">New on OTT</div>
      <div style="margin-left:auto;font-size:21px;font-weight:800;letter-spacing:.14em;color:#06070a;background:#ffb03a;padding:9px 16px;border-radius:999px">NEW</div>
    </div>
    <div style="margin-top:22px;font-size:84px;font-weight:900;letter-spacing:-.045em;line-height:.95">
      Never ask <span class="grad">"OTT pe kab aayegi?"</span> again.
    </div>
  </div>

  <div style="position:absolute;left:0;right:0;top:470px;display:flex;justify-content:center;gap:30px">
    ${phone(screens.page, 'Expected OTT date', 'On every film still in cinemas', -3, 30)}
    ${phone(screens.mail, 'Alert when it streams', 'Phone notification or email', 0, 0)}
    ${phone(screens.digest, 'The Friday list', 'This week, in your inbox', 3, 30)}
  </div>

  <div style="position:absolute;left:64px;right:64px;bottom:52px;display:flex;align-items:center;justify-content:space-between">
    <div style="font-size:44px;font-weight:900;letter-spacing:-.02em" class="grad">newonott.in</div>
    <div style="font-size:24px;font-weight:700;color:#c9cfdb">Free · Link in bio</div>
  </div>
</div>`;

const browser = await launchChromium('launch-post');
const page = await browser.newPage({ viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 1 });
await page.setContent(html, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: resolve(ROOT, 'social/launch-post.jpg'), type: 'jpeg', quality: 92 });
await browser.close();

const caption = `Never ask "OTT pe kab aayegi?" again. 🍿

New on newonott.in:

📅 Expected OTT date — every film still in cinemas now shows when it's likely to hit OTT, measured from how long real films took
🔔 Alert the day it streams — tap Notify me (or drop your email) on any film, and we'll tell you the day it lands
📬 The Friday list — what's new on OTT, what's in cinemas, and when the big ones reach OTT, in your inbox every Friday

All free. No app, no login.

🔗 newonott.in — link in bio

#NewOnOTT #OTTReleaseDate #OTTIndia #OTTUpdates #KabAayegi #WhatToWatch #Netflix #PrimeVideo #JioHotstar #SonyLIV #ZEE5 #Bollywood #TamilCinema #TeluguCinema #MalayalamCinema`;
await writeFile(resolve(ROOT, 'social/launch-post-caption.txt'), `${caption}\n`);
console.log('wrote social/launch-post.jpg and social/launch-post-caption.txt');
