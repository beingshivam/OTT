#!/usr/bin/env node
/**
 * The explainer story: seven 9:16 frames, in order.
 *
 * A feed post has to work in one frame, so it can only carry one idea. A story
 * is the opposite — it is the one place where someone has already agreed to sit
 * through several frames, which makes it the right shape for "what is this and
 * why would I open it".
 *
 * The arc is deliberately not a feature list. Frames 1 and 2 are the problem
 * and the answer, because nobody taps through a feature list for a product they
 * have not yet agreed has a point. Features only start at frame 3, once the
 * reader has a reason to care what the thing does. The last frame does one job:
 * ask for the tap.
 *
 * Every claim here is a feature that actually ships — the board and poster
 * views, trending sort, the platform/type/language/genre filters, search across
 * titles, cast and genres, the detail sheet's trailer, cast, rating and
 * certificate, the share-the-week image, and the Friday calendar reminder.
 * A story that promises a filter the site does not have costs more trust than
 * the extra line buys.
 *
 * Usage: npm run story
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BRAND } from './brand.mjs';
import { launchChromium } from './browser.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'social/story');
const SITE = (process.env.SITE_URL ?? 'https://newonott.in')
  .replace(/^https?:\/\//, '')
  .replace(/\/$/, '');

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const emphasise = (s) => esc(s).replace(/\*([^*]+)\*/g, '<em class="grad">$1</em>');

/**
 * The frames.
 *
 * `kicker` is the small line above the headline, `head` the headline itself
 * (with *gradient* markers), `sub` the explanation, and `list` the optional
 * three-item rundown. Written as data so the order can be changed or a frame
 * dropped without touching layout code.
 */
const FRAMES = [
  {
    kicker: 'Har Friday, har ghar',
    head: 'Kya *dekhein*?',
    sub: 'Netflix. Prime. JioHotstar. ZEE5. Phir wapas Netflix. Bees minute nikal gaye aur dekha kuch bhi nahi.',
  },
  {
    kicker: 'Iska ek page hai',
    head: '*New on OTT*',
    sub: `Har platform ki nayi release, plus theatres mein kya laga hai — sab ek hi page pe. Har Friday subah update, drops land hone se pehle.`,
  },
  {
    kicker: 'Feature 1',
    head: 'Poora hafta, *ek screen* mein',
    sub: 'Platform ke hisaab se laga hua — Netflix, Prime, JioHotstar, Apple TV+, SonyLIV, ZEE5 aur baaki sab, plus In Theatres. Endless scroll nahi. Ek nazar.',
  },
  {
    kicker: 'Feature 2',
    head: 'Sabse upar *sabse zyada* buzz',
    sub: 'Yahan koi algorithm tumhe woh nahi dikha raha jo platform push karna chahta hai. Ye sirf is hafte ki actual charcha hai. Top rated aur A–Z bhi ek tap door.',
  },
  {
    kicker: 'Feature 3',
    head: 'Sirf Hindi? Sirf movies? *Sirf Netflix?*',
    sub: 'Do tap mein filter. Platform, type, language, genre. Aur search sirf titles nahi — cast aur genre se bhi dhoondh leta hai.',
  },
  {
    kicker: 'Feature 4',
    head: 'Aur bhi *kaafi kuch*',
    list: [
      'Kisi bhi title pe tap — trailer, cast, rating, certificate, sab wahin',
      'Poore hafte ka image ek tap mein, seedha group chat ke liye',
      '"Remind me every Friday" — calendar mein reminder, apne aap',
    ],
  },
  {
    kicker: 'Bas itna hi',
    head: `*${SITE}*`,
    sub: 'No app to install. No login. No ads. Free, aur free hi rahega.',
    cta: true,
  },
];

/**
 * Instagram draws its own chrome over the top and bottom of a story — the
 * profile row and progress bars up top, the reply box and share buttons below —
 * and a link sticker usually sits in the lower third. Content inside these
 * margins is content nothing covers.
 */
const SAFE_TOP = 300;
const SAFE_BOTTOM = 380;

const frameHtml = (f, i) => `<!doctype html><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body {
    width:1080px; height:1920px; position:relative; overflow:hidden;
    background:#06070a; color:#f2f4f9; font-family:Inter,system-ui,sans-serif;
    display:flex; flex-direction:column;
    padding:${SAFE_TOP}px 84px ${SAFE_BOTTOM}px;
  }
  body::before, body::after {
    content:''; position:absolute; width:1200px; height:1200px; border-radius:50%; pointer-events:none;
  }
  body::before { top:-560px; left:-360px; background:radial-gradient(circle, rgba(255,61,61,.34), transparent 62%); }
  body::after  { bottom:-620px; right:-380px; background:radial-gradient(circle, rgba(126,78,255,.26), transparent 64%); }

  .top { position:relative; display:flex; align-items:center; gap:16px; flex:none; }
  .mark { width:54px; height:54px; border-radius:16px; display:grid; place-items:center;
          background:linear-gradient(135deg,#ff4d4d,#ffb03a); }
  .mark svg { width:23px; height:23px; fill:#fff; }
  .wordmark { font-size:33px; font-weight:700; letter-spacing:-.022em; }
  /* The counter sets the expectation that this ends. A story with no visible
     end gets tapped through; one that says 3/7 gets watched. */
  .count { margin-left:auto; font-size:27px; font-weight:700; color:#6a7080;
           font-variant-numeric:tabular-nums; }

  .body { position:relative; flex:1 1 auto; min-height:0;
          display:flex; flex-direction:column; justify-content:center; }
  .kicker { font-size:30px; font-weight:700; letter-spacing:.16em; text-transform:uppercase;
            color:#ff8a4d; margin-bottom:34px; }
  h1 { font-size:${f.cta ? 92 : 96}px; line-height:1.04; font-weight:900; letter-spacing:-.05em; }
  .grad { font-style:normal;
          background:linear-gradient(100deg,#ff4d4d,#ff7a3d 42%,#ffb03a);
          -webkit-background-clip:text; -webkit-text-fill-color:transparent; }
  p { margin-top:44px; font-size:41px; line-height:1.45; font-weight:500; color:#b6bdcc; }

  ul { margin-top:52px; list-style:none; display:flex; flex-direction:column; gap:38px; }
  li { display:flex; gap:26px; font-size:37px; line-height:1.38; font-weight:500; color:#c2c9d6; }
  li::before { content:''; flex:none; width:15px; height:15px; margin-top:16px; border-radius:50%;
               background:linear-gradient(135deg,#ff4d4d,#ffb03a); }

  .foot { position:relative; flex:none; font-size:32px; font-weight:600; color:#7d8494; }
  .swipe { position:relative; flex:none; margin-top:26px; font-size:34px; font-weight:700; color:#ff8a4d; }
</style>
<div class="top">
  <span class="mark"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></span>
  <span class="wordmark">${esc(BRAND)}</span>
  <span class="count">${i + 1}/${FRAMES.length}</span>
</div>
<div class="body">
  <div class="kicker">${esc(f.kicker)}</div>
  <h1>${emphasise(f.head)}</h1>
  ${f.sub ? `<p>${emphasise(f.sub)}</p>` : ''}
  ${f.list ? `<ul>${f.list.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
</div>
${
  f.cta
    ? /* Points down, and the copy tells you where to put the sticker rather
         than assuming. An arrow aimed at empty space because the sticker ended
         up somewhere else is worse than no arrow. */
      `<div class="foot">Abhi khol ke dekho — 10 second lagenge.</div>
       <div class="swipe">Tap the link ↓</div>`
    : `<div class="foot">${esc(SITE)}</div>`
}`;

await mkdir(OUT, { recursive: true });
const browser = await launchChromium('story');
try {
  for (const [i, f] of FRAMES.entries()) {
    const p = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
    await p.setContent(frameHtml(f, i), { waitUntil: 'networkidle' });
    await p.evaluate(() => document.fonts.ready);

    /**
     * Shrink the headline until it fits its column.
     *
     * These headlines are copy that will get edited, and a frame is 1080px
     * wide with 84px of margin each side. Measuring means a longer rewrite
     * gets smaller type instead of running off the edge, where it would only
     * be noticed once the story was live.
     */
    await p.evaluate(() => {
      const h1 = document.querySelector('h1');
      const holder = h1.parentElement;
      let size = parseFloat(getComputedStyle(h1).fontSize);
      while (size > 52 && h1.scrollWidth > holder.clientWidth) {
        size -= 2;
        h1.style.fontSize = `${size}px`;
      }
    });

    /** Nothing may run past the safe area — measured per element, because the
     *  background wash is deliberately larger than the frame. */
    const spill = await p.evaluate(() => {
      const w = document.body.clientWidth;
      const h = document.body.clientHeight;
      let worst = 0;
      for (const el of document.querySelectorAll('h1, p, li, .kicker, .foot, .swipe')) {
        const r = el.getBoundingClientRect();
        worst = Math.max(worst, r.right - w, r.bottom - h, -r.left, -r.top);
      }
      return Math.round(worst);
    });
    if (spill > 1) throw new Error(`Frame ${i + 1} runs ${spill}px past its safe area — shorten a line.`);

    const name = `story-${i + 1}.png`;
    await writeFile(resolve(OUT, name), await p.screenshot({ type: 'png' }));
    await p.close();
    console.log(`  ${name}  1080x1920  ${f.kicker}`);
  }
} finally {
  await browser.close();
}

console.log(`\n${FRAMES.length} frames in social/story/. Post in order, link sticker on the last one.`);
