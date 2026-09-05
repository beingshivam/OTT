#!/usr/bin/env node
/**
 * One image, one line, no titles.
 *
 * The weekly poster (npm run social) sells the week and goes stale in seven
 * days. The launch carousel (npm run launch) needs three slides and a swipe.
 * This is the third shape: a single frame carrying one Hinglish line, the kind
 * of thing that gets screenshotted and forwarded on its own — which means it
 * has to work with no caption, no swipe and no context.
 *
 * Hinglish because the audience thinks in it. "OTT ka Google aa gaya" does in
 * five words what the English carousel needs three slides for: it names a
 * category everyone already understands and claims the same job in it. A
 * translated English line would need a sentence to say the same thing, and a
 * sentence does not survive a WhatsApp forward.
 *
 * 4:5 — the tallest crop Instagram's feed allows, so it takes the most screen
 * on a scroll, and it survives a WhatsApp chat thumbnail better than 9:16,
 * which crops from the bottom and eats the URL.
 *
 * Usage: npm run hook          (the default line)
 *        LINE=2 npm run hook   (one of the alternates below)
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
 * The line, and its alternates.
 *
 * `hi` is the word that takes the gradient — the one the eye lands on. Keeping
 * it separate from the rest of the line means the emphasis is a decision rather
 * than a guess about where the ramp happens to fall.
 *
 * 1 is the default and leans on a brand everyone knows to explain the category
 * in one beat. 2 says the same thing without naming anyone else's product,
 * which is the version to use if leaning on Google ever feels like the wrong
 * borrow. 3 leads with the question people actually ask out loud, which tests
 * differently — worth trying once the first has run.
 */
const LINES = {
  1: { before: 'OTT ka', hi: 'Google', after: 'aa gaya.', sub: 'Har platform. Har nayi release. Ek hi page.' },
  2: { before: 'Sab OTT.', hi: 'Ek page.', after: 'Bas.', sub: 'Har Friday, har nayi release — ek hi jagah.' },
  3: { before: 'Aaj kya', hi: 'dekhein?', after: '', sub: 'Har platform ki nayi release, ek hi page pe.' },
};
const line = LINES[process.env.LINE ?? '1'];
if (!line) {
  console.error(`LINE must be one of: ${Object.keys(LINES).join(', ')}`);
  process.exit(1);
}

/** The headline is three short words, so it can run very large — and it should.
 *  A forwarded image is read at thumbnail size before it is opened, and the
 *  line has to survive that. */
const html = `<!doctype html><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body {
    width:1080px; height:1350px; position:relative; overflow:hidden;
    background:#06070a; color:#f2f4f9; font-family:Inter,system-ui,sans-serif;
    display:flex; flex-direction:column; padding:84px 76px;
  }
  /* Same two-corner wash as the site, the share card and the posters, so a
     forwarded image and the page it points at read as one product. */
  body::before, body::after {
    content:''; position:absolute; width:1100px; height:1100px; border-radius:50%; pointer-events:none;
  }
  body::before { top:-700px; left:-320px; background:radial-gradient(circle, rgba(255,61,61,.34), transparent 62%); }
  body::after  { bottom:-760px; right:-340px; background:radial-gradient(circle, rgba(126,78,255,.26), transparent 64%); }

  .top { position:relative; display:flex; align-items:center; gap:16px; }
  .mark { width:52px; height:52px; border-radius:15px; display:grid; place-items:center;
          background:linear-gradient(135deg,#ff4d4d,#ffb03a); }
  .mark svg { width:22px; height:22px; fill:#fff; }
  .brand { font-size:34px; font-weight:700; letter-spacing:-.022em; }

  /* margin-top:auto pushes the block off the wordmark and lets the line sit
     optically centred, with the footer holding the bottom. */
  h1 { position:relative; margin-top:auto; font-size:132px; line-height:.98;
       font-weight:900; letter-spacing:-.055em; }
  /* Warm the whole way across. Clipped to a short word, a ramp that passes
     through blue desaturates mid-letter and reads as a broken render. */
  em { font-style:normal;
       background:linear-gradient(100deg,#ff4d4d,#ff7a3d 42%,#ffb03a);
       -webkit-background-clip:text; -webkit-text-fill-color:transparent; }
  p { position:relative; margin-top:40px; margin-bottom:auto; max-width:840px;
      font-size:37px; line-height:1.4; font-weight:500; color:#b6bdcc; }

  .foot { position:relative; padding-top:34px; border-top:1px solid rgba(255,255,255,.12); }
  .url { font-size:62px; font-weight:900; letter-spacing:-.04em;
         background:linear-gradient(100deg,#ffb03a,#ff4d4d);
         -webkit-background-clip:text; -webkit-text-fill-color:transparent; }
  .note { margin-top:12px; font-size:29px; font-weight:500; color:#7d8494; }
</style>
<div class="top">
  <span class="mark"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></span>
  <span class="brand">${esc(BRAND)}</span>
</div>
<!-- One part per line, every break explicit. Left to wrap on its own the
     default line came out "OTT ka / Google aa / gaya.", which splits a phrase
     across lines and reads as a typesetting accident. Breaking on the parts
     also leaves the gradient word alone on its line, which is where the eye
     should land anyway. -->
<h1>${[line.before, `<em>${esc(line.hi)}</em>`, line.after]
  .filter(Boolean)
  .map((part) => (part.startsWith('<em>') ? part : esc(part)))
  .join('<br>')}</h1>
<p>${esc(line.sub)}</p>
<div class="foot">
  <div class="url">${esc(SITE)}</div>
  <div class="note">Har Friday update · No app, no login, free.</div>
</div>`;

await mkdir(OUT, { recursive: true });
const browser = await launchChromium('hook');
try {
  const p = await browser.newPage({ viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 1 });
  await p.setContent(html, { waitUntil: 'networkidle' });
  // Webfonts can resolve after networkidle; without this the line renders in a
  // fallback face and the whole thing looks like a draft.
  await p.evaluate(() => document.fonts.ready);
  await writeFile(resolve(OUT, 'hook.png'), await p.screenshot({ type: 'png' }));
} finally {
  await browser.close();
}

const headline = [line.before, line.hi, line.after].filter(Boolean).join(' ');
console.log(`  hook.png  1080x1350  "${headline}"`);

/**
 * The caption stays Hinglish too. Switching to English under a Hinglish image
 * reads as a translation of the joke, which kills it.
 */
const caption = `${headline}

Har hafte 100+ nayi releases aati hain — Netflix, Prime Video, JioHotstar, Apple TV+, SonyLIV, ZEE5 aur baaki sab pe. Dhoondhne mein jitna time jaata hai, utne mein aadhi movie khatam.

Isliye sab kuch ek page pe daal diya. Theatres ki releases bhi. Sorted by what people are actually talking about.

No app. No login. Har Friday update. Free.

🔗 ${SITE} — link in bio

#NewOnOTT #OTTIndia #OTTReleases #KyaDekhein #WhatToWatch #StreamingIndia
#Netflix #PrimeVideo #JioHotstar #Bollywood #TamilCinema #TeluguCinema #MalayalamCinema
`;
await writeFile(resolve(OUT, 'hook-caption.txt'), caption);

console.log(`\nWritten to social/ — hook.png, hook-caption.txt`);
