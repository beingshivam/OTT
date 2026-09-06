#!/usr/bin/env node
/**
 * The "what we are, what we aren't" post.
 *
 * Written because a reader asked, politely, whether this was a place she could
 * watch things — and she was reading the old copy correctly. One person asking
 * means many more assumed and left, so the answer belongs in a post rather
 * than only in a reply.
 *
 * Two columns, no screenshot. Every other post here shows the product; this
 * one is about what the product *is*, and putting a UI beside that only gives
 * the eye somewhere else to go. The format is the oldest myth-buster there is
 * because it works: the wrong idea gets named out loud, then corrected.
 *
 * The gratitude is deliberately unquantified. "Tremendous response" on a site
 * a few days old with a couple of hundred visitors is the kind of claim that
 * costs more than it earns — anyone who checks can tell, and the whole point
 * of this post is being believed. Thanking people plainly reads better and
 * cannot age badly.
 *
 * Usage: npm run explain
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BRAND } from './brand.mjs';
import { launchChromium } from './browser.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'social');
const SITE = (process.env.SITE_URL ?? 'https://newonott.in')
  .replace(/^https?:\/\//, '')
  .replace(/\/$/, '');

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Plain Hinglish, short rows. The reader who asked is in her forties and not
 * the audience the meme posts are written for — this one has to work for
 * someone reading carefully rather than scrolling.
 */
/**
 * Nouns, not denials. Under a heading that already reads "Ye hum nahi hain",
 * a row saying "Streaming app nahi hain" beside a ✗ is a double negative —
 * the cross negates a sentence that already negated itself. On a post written
 * for someone who is confused, that is the last thing the copy can afford.
 */
const NOT = [
  'Streaming app',
  'Movie ya show ka player',
  'Subscription service',
  'Login ya account',
];
const IS = [
  'Har hafte ki nayi releases ki poori list',
  'Kaunsi app pe hai — ye batate hain',
  'Theatres mein kya laga hai, wo bhi',
  'Tap karo, seedha usi app pe khul jaata hai',
];

/* Drawn, not typed. A ✓ or ✗ character depends on the rendering machine having
   a font with that glyph, and the emoji equivalents come out flat and grey
   here — the same reason no emoji goes inside any of these images. */
const TICK = '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const CROSS = '<svg viewBox="0 0 24 24"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/></svg>';

const html = `<!doctype html><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body {
    width:1080px; height:1350px; position:relative; overflow:hidden;
    background:#06070a; color:#f2f4f9; font-family:Inter,system-ui,sans-serif;
    display:flex; flex-direction:column; padding:78px 76px 70px;
  }
  body::before, body::after {
    content:''; position:absolute; width:1100px; height:1100px; border-radius:50%; pointer-events:none;
  }
  body::before { top:-700px; left:-330px; background:radial-gradient(circle, rgba(255,61,61,.32), transparent 62%); }
  body::after  { bottom:-720px; right:-340px; background:radial-gradient(circle, rgba(126,78,255,.24), transparent 64%); }

  .top { position:relative; display:flex; align-items:center; gap:16px; flex:none; }
  .mark { width:50px; height:50px; border-radius:15px; display:grid; place-items:center;
          background:linear-gradient(135deg,#ff4d4d,#ffb03a); }
  .mark svg { width:21px; height:21px; fill:#fff; stroke:none; }
  .brand { font-size:32px; font-weight:700; letter-spacing:-.022em; }
  .badge { margin-left:auto; padding:7px 17px; border-radius:999px;
           background:rgba(255,122,61,.14); border:1px solid rgba(255,122,61,.4);
           color:#ff9a5c; font-size:21px; font-weight:700; letter-spacing:.05em;
           text-transform:uppercase; white-space:nowrap; }

  h1 { position:relative; flex:none; margin-top:46px; font-size:80px; line-height:1.05;
       font-weight:900; letter-spacing:-.05em; }
  h1 em { font-style:normal;
          background:linear-gradient(100deg,#ff4d4d,#ff7a3d 42%,#ffb03a);
          -webkit-background-clip:text; -webkit-text-fill-color:transparent; }

  .blocks { position:relative; flex:1 1 auto; min-height:0;
            display:flex; flex-direction:column; justify-content:center; gap:34px; }
  .block { border-radius:26px; padding:30px 32px; border:1px solid rgba(255,255,255,.09);
           background:rgba(255,255,255,.025); }
  .block h2 { font-size:22px; font-weight:800; letter-spacing:.1em; text-transform:uppercase;
              margin-bottom:20px; }
  .block--no h2 { color:#ff7d7d; }
  .block--yes h2 { color:#ffb03a; }
  ul { list-style:none; display:flex; flex-direction:column; gap:15px; }
  li { display:flex; align-items:flex-start; gap:16px;
       font-size:31px; line-height:1.3; font-weight:600; letter-spacing:-.02em; }
  li i { flex:none; width:32px; height:32px; margin-top:3px; border-radius:50%;
         display:grid; place-items:center; }
  li i svg { width:19px; height:19px; fill:none; stroke-width:2.6;
             stroke-linecap:round; stroke-linejoin:round; }
  .block--no li { color:#aeb4c0; }
  .block--no li i { background:rgba(255,77,77,.13); }
  .block--no li i svg { stroke:#ff7d7d; }
  .block--yes li i { background:rgba(255,176,58,.14); }
  .block--yes li i svg { stroke:#ffb03a; }

  .foot { position:relative; flex:none; margin-top:38px;
          display:flex; align-items:flex-end; justify-content:space-between; gap:24px; }
  .url { font-size:54px; font-weight:900; letter-spacing:-.04em;
         background:linear-gradient(100deg,#ffb03a,#ff4d4d);
         -webkit-background-clip:text; -webkit-text-fill-color:transparent; }
  .note { font-size:25px; font-weight:500; color:#8d94a4; text-align:right; max-width:400px;
          line-height:1.4; }
</style>
<div class="top">
  <span class="mark"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></span>
  <span class="brand">${esc(BRAND)}</span>
  <span class="badge">Aap sabka shukriya</span>
</div>

<h1>Hum kya hain,<br>aur kya <em>nahi</em>.</h1>

<div class="blocks">
  <div class="block block--no">
    <h2>Ye hum nahi hain</h2>
    <ul>${NOT.map((t) => `<li><i>${CROSS}</i><span>${esc(t)}</span></li>`).join('')}</ul>
  </div>
  <div class="block block--yes">
    <h2>Ye hum hain</h2>
    <ul>${IS.map((t) => `<li><i>${TICK}</i><span>${esc(t)}</span></li>`).join('')}</ul>
  </div>
</div>

<div class="foot">
  <div class="url">${esc(SITE)}</div>
  <div class="note">No app. No login. Free.</div>
</div>`;

await mkdir(OUT, { recursive: true });
const browser = await launchChromium('explain');
try {
  const p = await browser.newPage({ viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 1 });
  await p.setContent(html, { waitUntil: 'networkidle' });
  await p.evaluate(() => document.fonts.ready);

  /** Nothing may run past the frame — measured per element, because the
   *  background wash is deliberately larger than the canvas. */
  const spill = await p.evaluate(() => {
    const w = document.body.clientWidth;
    const h = document.body.clientHeight;
    let worst = 0;
    for (const el of document.querySelectorAll('h1, li, h2, .url, .note, .badge')) {
      const r = el.getBoundingClientRect();
      worst = Math.max(worst, r.right - w, r.bottom - h, -r.left, -r.top);
    }
    return Math.round(worst);
  });
  if (spill > 1) throw new Error(`Content runs ${spill}px past the frame — shorten a row.`);

  await writeFile(resolve(OUT, 'post-what-we-are.png'), await p.screenshot({ type: 'png' }));
  await p.close();
  console.log('  post-what-we-are.png  1080x1350');
} finally {
  await browser.close();
}

const caption = `Thank you — genuinely.

Site ko launch hue kuch hi din hue hain, aur logon ne use kiya, share kiya, aur sawaal bhi poochhe. Ek sawaal baar-baar aaya, aur wo humari galti thi — humari purani line thi "every platform, one page", jisse laga ki yahan sab kuch dekh sakte ho.

Toh saaf-saaf:

Hum streaming app NAHI hain. Yahan koi movie nahi chalti. Koi subscription nahi, koi login nahi.

Hum ye hain: har hafte ki nayi releases ki poori list — kaunsi film ya show kaunsi app pe aayi hai, aur theatres mein kya laga hai. Tap karo, seedha usi app pe khul jaata hai jahan wo actually hai.

Bas itna. Ek page, jo batata hai ki kya naya hai aur kahan hai.

Jinhone poochha — shukriya. Aapki wajah se site ki language ab clear hai.

🔗 ${SITE} — link in bio

Aur kuch confusing lage toh comment karo, theek kar denge 👇`;

await writeFile(resolve(OUT, 'post-what-we-are-caption.txt'), `${caption}\n`);
console.log('  post-what-we-are-caption.txt');
