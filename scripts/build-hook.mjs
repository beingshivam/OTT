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
 * The lines.
 *
 * `head` is one entry per rendered row, so every break is a decision. Left to
 * wrap on its own the first line came out "OTT ka / Google aa / gaya." — a
 * phrase split across rows, which reads as a typesetting accident rather than
 * a choice.
 *
 * *Asterisks* mark the words that take the gradient. Naming them beats letting
 * the ramp fall where it happens to land, and it keeps emphasis independent of
 * where the row breaks are.
 *
 *   1  leans on a brand everyone knows to explain the category in one beat
 *   2  says the same without naming another company's product
 *   3  leads with the question people actually ask out loud
 *   4  the "…hai na" cadence — Indian advertising's oldest reassurance, and it
 *      works here because the product really is the thing you fall back on.
 *      Its sub-line names the five apps the headline counts, so the claim is
 *      specific instead of a round number nobody checks.
 */
const LINES = {
  1: {
    head: ['OTT ka', '*Google*', 'aa gaya.'],
    sub: 'Har platform. Har nayi release. Ek hi page.',
  },
  2: {
    head: ['Sab OTT.', '*Ek page.*', 'Bas.'],
    sub: 'Har Friday, har nayi release — ek hi jagah.',
  },
  3: {
    head: ['Aaj kya', '*dekhein?*'],
    sub: 'Har platform ki nayi release, ek hi page pe.',
  },
  4: {
    head: ['Ab 5 app pe', 'scroll karna band.', '*newonott* hai na.'],
    sub: 'Netflix, Prime, JioHotstar, Apple TV+, ZEE5 — sab ek hi page pe.',
    body: `Netflix kholo — kuch nahi. Prime kholo — kuch nahi. JioHotstar, ZEE5, phir wapas Netflix. Bees minute nikal gaye, dekha kuch bhi nahi.

Isliye sab ek page pe daal diya. Har platform ki nayi release, theatres ki bhi, sorted by what people are actually talking about.`,
  },
};

const which = process.env.LINE ?? '1';
const line = LINES[which];
if (!line) {
  console.error(`LINE must be one of: ${Object.keys(LINES).join(', ')}`);
  process.exit(1);
}

/** Named per line, so rendering a new one does not quietly destroy the last —
 *  these are posted over weeks, not all at once. */
const png = `hook-${which}.png`;
const txt = `hook-${which}-caption.txt`;

/** Escape first, then turn the *markers* into gradient spans — the other order
 *  would let a stray asterisk in copy inject markup. */
const emphasise = (row) => esc(row).replace(/\*([^*]+)\*/g, '<em>$1</em>');
const headline = line.head.join(' ').replace(/\*/g, '');

/** The headline runs as large as it will go, because a forwarded image is read
 *  at thumbnail size before anyone opens it. HEAD_MAX is a starting point, not
 *  a setting — see the fit pass after the render. */
const HEAD_MAX = 132;
const HEAD_MIN = 62;

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
  h1 { position:relative; margin-top:auto; font-size:${HEAD_MAX}px; line-height:.98;
       font-weight:900; letter-spacing:-.055em; }
  /* Each row is its own block and never wraps, so the fit pass can measure the
     widest one and shrink the whole headline until it fits. Without nowrap a
     too-long row would silently re-wrap and reintroduce the accidental breaks
     the explicit rows exist to prevent. */
  h1 span { display:block; white-space:nowrap; }
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
<h1>${line.head.map((row) => `<span>${emphasise(row)}</span>`).join('')}</h1>
<p>${esc(line.sub)}</p>
<div class="foot">
  <div class="url">${esc(SITE)}</div>
  <div class="note">Har Friday update · No app, no login, free.</div>
</div>`;

await mkdir(OUT, { recursive: true });
let fitted = HEAD_MAX;
const browser = await launchChromium('hook');
try {
  const p = await browser.newPage({ viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 1 });
  await p.setContent(html, { waitUntil: 'networkidle' });
  // Webfonts can resolve after networkidle; without this the line renders in a
  // fallback face and the whole thing looks like a draft.
  await p.evaluate(() => document.fonts.ready);

  /**
   * Shrink the headline until the longest row fits.
   *
   * A fixed size only works while every line is about as short as the first
   * one. "Ab 5 app pe / scroll karna band. / newonott hai na." is twice as
   * wide, and at a hardcoded 132px its middle row ran off the canvas — where
   * it would have been noticed after posting, not before. Measuring is the
   * only version of this that stays correct for a line nobody has written yet.
   *
   * Done here rather than with CSS because there is no CSS for "as large as
   * fits", and a viewport-unit guess is the same hardcoded number wearing a
   * different hat.
   */
  fitted = await p.evaluate(
    ([max, min]) => {
      const h1 = document.querySelector('h1');
      const rows = [...h1.querySelectorAll('span')];
      const limit = h1.clientWidth;
      let size = max;
      // 2px steps: finer than the eye can tell at this scale, and it caps the
      // loop at ~35 iterations.
      while (size > min && rows.some((r) => r.scrollWidth > limit)) {
        size -= 2;
        h1.style.fontSize = `${size}px`;
      }
      return size;
    },
    [HEAD_MAX, HEAD_MIN],
  );

  await writeFile(resolve(OUT, png), await p.screenshot({ type: 'png' }));
} finally {
  await browser.close();
}

console.log(`  ${png}  1080x1350  ${fitted}px  "${headline}"`);
if (fitted === HEAD_MIN) {
  console.warn(`  ⚠  headline hit the ${HEAD_MIN}px floor — it may still overflow. Shorten a row.`);
}

/**
 * The caption stays Hinglish too. Switching to English under a Hinglish image
 * reads as a translation of the joke, which kills it.
 */
const DEFAULT_BODY = `Har hafte 100+ nayi releases aati hain — Netflix, Prime Video, JioHotstar, Apple TV+, SonyLIV, ZEE5 aur baaki sab pe. Dhoondhne mein jitna time jaata hai, utne mein aadhi movie khatam.

Isliye sab kuch ek page pe daal diya. Theatres ki releases bhi. Sorted by what people are actually talking about.`;

const caption = `${headline}

${line.body ?? DEFAULT_BODY}

No app. No login. Har Friday update. Free.

🔗 ${SITE} — link in bio

#NewOnOTT #OTTIndia #OTTReleases #KyaDekhein #WhatToWatch #StreamingIndia
#Netflix #PrimeVideo #JioHotstar #Bollywood #TamilCinema #TeluguCinema #MalayalamCinema
`;
await writeFile(resolve(OUT, txt), caption);

console.log(`\nWritten to social/ — ${png}, ${txt}`);
