#!/usr/bin/env node
/**
 * Three posts that are not posters.
 *
 * The hook images (npm run hook) are all the same shape: big line, sub-line,
 * URL. Three of those in a row read as one advertiser talking, and the thing
 * people forward is never an advertiser talking — it is something that looks
 * like it came from a phone rather than from a brand.
 *
 * So each of these borrows a format the audience already reads without being
 * asked to:
 *
 *   receipt   a screen-time card. The joke is arithmetic — the minutes add up
 *             and the payoff is the zero at the bottom. Nobody argues with a
 *             number they recognise from their own phone.
 *   chat      a group chat. This is the native visual language of Indian
 *             social, and the format is self-forwarding: the post *is* the
 *             conversation people are about to have.
 *   roast     the self-roast card. It works because the reader supplies the
 *             punchline about themselves, and the caption asks them to type it
 *             in the comments.
 *
 * All three end on the same address, and none of them is about the product
 * until the last line. A post that opens with the product is an ad; a post
 * that opens with the reader's Tuesday night is a joke they happen to be in.
 *
 * Deliberately carries no titles from any particular week — these are evergreen
 * and can be reposted. The weekly poster (npm run social) is where content goes.
 *
 * Usage: npm run memes
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

const FONTS = `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">`;

/** The wordmark, small and top-left on every one of these. Present so a
 *  screenshot is attributable, small so the post does not open by announcing
 *  itself as an ad. */
const TOP = `<div class="top">
  <span class="mark"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></span>
  <span class="brand">${esc(BRAND)}</span>
</div>`;

const FOOT = (note) => `<div class="foot">
  <div class="url">${esc(SITE)}</div>
  <div class="note">${esc(note)}</div>
</div>`;

const SHELL = (body, extra = '') => `<!doctype html><meta charset="utf-8">
${FONTS}
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body {
    width:1080px; height:1350px; position:relative; overflow:hidden;
    background:#06070a; color:#f2f4f9; font-family:Inter,system-ui,sans-serif;
    display:flex; flex-direction:column; padding:80px 76px;
  }
  /* Same two-corner wash as the site and every other image, so a forwarded
     screenshot and the page it points at read as one product. */
  body::before, body::after {
    content:''; position:absolute; width:1100px; height:1100px; border-radius:50%; pointer-events:none;
  }
  body::before { top:-720px; left:-330px; background:radial-gradient(circle, rgba(255,61,61,.32), transparent 62%); }
  body::after  { bottom:-780px; right:-350px; background:radial-gradient(circle, rgba(126,78,255,.24), transparent 64%); }

  .top { position:relative; display:flex; align-items:center; gap:15px; flex:none; }
  .mark { width:48px; height:48px; border-radius:14px; display:grid; place-items:center;
          background:linear-gradient(135deg,#ff4d4d,#ffb03a); }
  .mark svg { width:20px; height:20px; fill:#fff; }
  .brand { font-size:31px; font-weight:700; letter-spacing:-.022em; }

  /* No blue stop: clipped to text a ramp through blue desaturates mid-letter
     and reads as a broken render. */
  .grad { background:linear-gradient(100deg,#ff4d4d,#ff7a3d 42%,#ffb03a);
          -webkit-background-clip:text; -webkit-text-fill-color:transparent; }

  .foot { position:relative; flex:none; margin-top:auto; padding-top:32px;
          border-top:1px solid rgba(255,255,255,.12); }
  .url { font-size:60px; font-weight:900; letter-spacing:-.04em;
         background:linear-gradient(100deg,#ffb03a,#ff4d4d);
         -webkit-background-clip:text; -webkit-text-fill-color:transparent; }
  .note { margin-top:11px; font-size:28px; font-weight:500; color:#7d8494; }
  ${extra}
</style>
${body}`;

/* ---------------------------------------------------------------- receipt --
   A screen-time card, because everyone has seen their own and flinched.

   The minutes are summed in code rather than typed. A card whose numbers do
   not add up is the one thing a screenshot-and-mock audience will always
   catch, and being wrong about arithmetic in a post about wasted time would
   hand them the joke. */
const APPS = [
  ['Netflix', 18],
  ['Prime Video', 9],
  ['JioHotstar', 7],
  ['ZEE5', 5],
  ['Netflix (phir se)', 3],
];
const total = APPS.reduce((sum, [, mins]) => sum + mins, 0);

const receipt = SHELL(
  `${TOP}
   <h1>Aaj ka<br><em class="grad">screen time</em></h1>
   <ul>
     ${APPS.map(([name, mins]) => `<li><span>${esc(name)}</span><b>${mins} min</b></li>`).join('')}
   </ul>
   <div class="sum">
     <div class="row"><span>Total scroll</span><b>${total} min</b></div>
     <div class="row row--punch"><span>Actually dekha</span><b class="grad">0 min</b></div>
   </div>
   ${FOOT('Har platform ek page pe. No app, no login, free.')}`,
  `h1 { position:relative; flex:none; margin-top:44px; font-size:86px; line-height:1.02;
        font-weight:900; letter-spacing:-.05em; }
   h1 em { font-style:normal; }
   ul { position:relative; flex:none; list-style:none; margin-top:44px; }
   li { display:flex; align-items:center; justify-content:space-between;
        padding:19px 0; border-bottom:1px solid rgba(255,255,255,.07);
        font-size:38px; font-weight:600; color:#9aa1b0; letter-spacing:-.02em; }
   li b { font-weight:700; color:#c8cedb; font-variant-numeric:tabular-nums; }
   .sum { position:relative; flex:none; margin-top:34px; }
   .row { display:flex; align-items:baseline; justify-content:space-between;
          font-size:42px; font-weight:700; color:#c8cedb; letter-spacing:-.025em; }
   /* The zero is the whole post, so it gets the size the headline would get
      anywhere else. */
   .row--punch { margin-top:20px; font-size:66px; font-weight:900; color:#f2f4f9;
                 letter-spacing:-.04em; }
   .row b { font-variant-numeric:tabular-nums; }`,
);

/* ------------------------------------------------------------------- chat --
   A group chat, because that is where this decision actually gets made and
   because a chat screenshot is the one thing that gets forwarded back into a
   chat without anyone deciding to "share" it.

   Generic bubbles on purpose — no other app's colours, logo or trade dress.
   The format reads as a chat from the shape alone, and imitating a specific
   messenger would put someone else's brand on our post for no extra joke. */
const THREAD = [
  ['in', 'kuch acha bata'],
  ['out', 'netflix pe dekh'],
  ['in', 'wahi purani cheezein aa rahi hain'],
  ['out', 'prime?'],
  ['in', 'bhai 20 min se yahi kar raha hoon'],
  ['out', 'newonott.in khol'],
  ['out', 'saari nayi releases ek page pe'],
  /**
   * No emoji inside the image.
   *
   * The renderer has no colour emoji font, so a 😭 comes out as a flat
   * monochrome glyph that reads as a missing character — and the fix is not to
   * install a font, because the same image gets viewed on devices that draw
   * emoji differently anyway. Emoji stay in the captions, which are text and
   * render on the reader's own phone.
   */
  ['in', 'ye pehle kyun nahi bataya yaar'],
];

const chat = SHELL(
  `${TOP}
   <div class="thread">
     ${THREAD.map(([side, text]) => `<div class="b b--${side}">${esc(text)}</div>`).join('')}
   </div>
   ${FOOT('Har Friday update. No app, no login, free.')}`,
  /* margin-bottom keeps the last bubble off the footer rule. Without it the
     thread grew until it touched the divider and the post looked cropped. */
  `.thread { position:relative; flex:1 1 auto; min-height:0; margin:40px 0 40px;
             display:flex; flex-direction:column; justify-content:center; gap:17px; }
   .b { max-width:74%; padding:24px 30px; font-size:37px; line-height:1.32;
        font-weight:500; letter-spacing:-.018em; }
   /* Asymmetric radii do the work a tail would: the flat corner points at its
      sender, so the two sides read as two people without any chrome. */
   .b--in  { align-self:flex-start; background:#191c24; color:#e4e8f0;
             border-radius:26px 26px 26px 7px; }
   .b--out { align-self:flex-end; text-align:left; color:#12070a;
             background:linear-gradient(120deg,#ffb352,#ff8a4d);
             border-radius:26px 26px 7px 26px; font-weight:600; }`,
);

/* ------------------------------------------------------------------ roast --
   The self-roast card. The reader supplies the punchline about themselves,
   which is why the caption's job is to ask them to type it in the comments.

   Hera Pheri because the comfort rewatch has to be one specific title everyone
   recognises instantly — a generic "purani movie" is nobody's, and the whole
   effect depends on the reader thinking "that is literally me". */
const roast = SHELL(
  `${TOP}
   <h1>
     <span>Toxic trait:</span>
     <span>40 minute scroll,</span>
     <span>phir wapas <em class="grad">Hera Pheri</em>.</span>
   </h1>
   <p>Taste ka problem nahi hai.<br>Dhoondhne ka hai.</p>
   ${FOOT('Har platform ki nayi release, ek page pe.')}`,
  `h1 { position:relative; flex:none; margin-top:auto; font-size:82px; line-height:1.08;
        font-weight:900; letter-spacing:-.045em; }
   h1 em { font-style:normal; }
   /* Rows are explicit and never wrap, so the fit pass can size them. Left to
      wrap, the last row broke as "phir wapas Hera / Pheri." — splitting the
      film title, which is the one string on the slide that has to land whole. */
   h1 span { display:block; white-space:nowrap; }
   /* Broken by hand for the same reason: wrapped naturally this sub-line left
      "hai." orphaned on a row of its own. */
   p { position:relative; flex:none; margin-top:38px; margin-bottom:auto;
       font-size:38px; line-height:1.4; font-weight:500; color:#b6bdcc; }`,
);

/* ---------------------------------------------------------------- captions --
   Every caption ends on a question.

   Reach on this platform follows comments, and a caption that stops after the
   joke gets likes — which do almost nothing. The ask has to be answerable in
   three words while standing in a queue, so it is always "name a thing you
   already have an opinion about", never "what do you think of our product". */
const TAGS = `#NewOnOTT #OTTIndia #OTTReleases #KyaDekhein #WhatToWatch #StreamingIndia
#Netflix #PrimeVideo #JioHotstar #Bollywood #TamilCinema #TeluguCinema #MalayalamCinema`;

const POSTS = [
  {
    name: 'meme-1-receipt',
    html: receipt,
    caption: `${total} minute scroll. 0 minute dekha.

Ye tumhari galti nahi hai. Har app chahta hai ki tum uske andar hi ghoomte raho — isliye har ek apna alag "New" section dikhata hai, aur kisi ko nahi pata ki baaki chaar pe kya aaya.

Humne sabko ek page pe daal diya. Netflix, Prime, JioHotstar, Apple TV+, SonyLIV, ZEE5 aur baaki sab — plus theatres. Sorted by what people are actually talking about.

No app. No login. Har Friday update. Free.

🔗 ${SITE} — link in bio

Sach batao — aaj kitna scroll kiya? 👇

${TAGS}`,
  },
  {
    name: 'meme-2-chat',
    html: chat,
    caption: `Har group chat mein exactly yahi hota hai.

"Kuch acha bata" se lekar "chalo kal dekhte hain" tak — 20 minute, 5 apps, aur end mein wahi purani movie.

Isliye ek page banaya: har platform ki nayi release, theatres ki bhi, ek jagah. Koi app nahi, koi login nahi, har Friday update. Free.

🔗 ${SITE} — link in bio

Tag karo us dost ko jo 45 minute lagata hai decide karne mein 👇

${TAGS}`,
  },
  {
    name: 'meme-3-roast',
    html: roast,
    caption: `Toxic trait: 40 minute scroll karna, phir wapas Hera Pheri laga dena.

Baat ye hai — problem taste ka nahi hai. Har hafte 100+ nayi releases aati hain. Bas woh 6 alag apps mein bikhri hui hain, aur koi ek jagah nahi batati ki aaya kya hai.

Ab batati hai. Har platform, har nayi release, plus theatres — ek page pe. No app, no login, har Friday update. Free.

🔗 ${SITE} — link in bio

Batao, tumhara comfort rewatch kya hai? 👇

${TAGS}`,
  },
];

await mkdir(OUT, { recursive: true });
const browser = await launchChromium('memes');
try {
  for (const post of POSTS) {
    const p = await browser.newPage({ viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 1 });
    await p.setContent(post.html, { waitUntil: 'networkidle' });
    // Webfonts can resolve after networkidle; without this everything renders
    // in a fallback face and the whole set looks like a draft.
    await p.evaluate(() => document.fonts.ready);

    /**
     * Shrink a headline built from explicit rows until the widest one fits.
     *
     * There is no CSS for "as large as fits", and a hardcoded size only holds
     * while nobody edits the copy. Measuring means a longer line later gets
     * smaller type instead of running off the frame.
     */
    await p.evaluate(() => {
      const h1 = document.querySelector('h1');
      const rows = h1 ? [...h1.querySelectorAll('span')] : [];
      if (!rows.length) return;
      const limit = h1.clientWidth;
      let size = parseFloat(getComputedStyle(h1).fontSize);
      while (size > 48 && rows.some((r) => r.scrollWidth > limit)) {
        size -= 2;
        h1.style.fontSize = `${size}px`;
      }
    });

    /**
     * Nothing may run past the canvas.
     *
     * These layouts are hand-sized, and a line edited later — a longer app
     * name, one more chat bubble — would overflow silently and only be noticed
     * after posting. Cheaper to fail the run than to find out in the feed.
     *
     * Measured per content element, not with body.scrollWidth: the background
     * wash is two 1100px circles deliberately hung off the edges, so the
     * document is *always* larger than the frame and scrollWidth reports the
     * decoration rather than the copy. The first version of this check failed
     * every post by exactly the offsets in those two rules.
     */
    const spill = await p.evaluate(() => {
      const w = document.body.clientWidth;
      const h = document.body.clientHeight;
      const worst = { name: '', over: 0 };
      // Leaf-ish elements only: a flex parent can report a box wider than its
      // own children when a child is centred, which is not overflow.
      for (const el of document.querySelectorAll('h1, p, li, .b, .row, .url, .note, .brand')) {
        const r = el.getBoundingClientRect();
        const over = Math.max(r.right - w, r.bottom - h, -r.left, -r.top);
        if (over > worst.over) {
          worst.over = Math.round(over);
          worst.name = (el.textContent ?? '').trim().slice(0, 40);
        }
      }
      return worst;
    });
    if (spill.over > 1) {
      throw new Error(`${post.name}: "${spill.name}" runs ${spill.over}px past the canvas — shorten it.`);
    }

    await writeFile(resolve(OUT, `${post.name}.png`), await p.screenshot({ type: 'png' }));
    await writeFile(resolve(OUT, `${post.name}-caption.txt`), `${post.caption}\n`);
    await p.close();
    console.log(`  ${post.name}.png  1080x1350  + caption`);
  }
} finally {
  await browser.close();
}

console.log('\nThree posts written to social/. Post them days apart, not together.');
