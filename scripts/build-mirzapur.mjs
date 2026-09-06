#!/usr/bin/env node
/**
 * Statement cards for one title's moment.
 *
 * Every other social script here sells the product: a screenshot, a headline
 * about the product, a URL. This one does the opposite, because the format it
 * copies works for the opposite reason. The post that prompted it was a
 * screenshot of somebody's own tweet — a sentence about watching Mirzapur on a
 * laptop in 2018 — and it took 368 shares, far out of proportion to its likes.
 * Nobody shares an advertisement. They share a sentence they would have
 * written themselves.
 *
 * So these are words on a dark field. No device mockup, no feature copy, the
 * URL small at the bottom or absent entirely. The restraint is the mechanic:
 * a card that starts arguing for the site stops being shareable.
 *
 * Slide one of the original is a screenshot of a real, posted tweet, and this
 * script deliberately cannot make one. A fabricated tweet — invented handle,
 * invented like count — is the single thing that would collapse the format,
 * and the real one takes half a minute to produce: post it, screenshot it.
 * What is rendered here is what goes *beside* it, plus the two cards that
 * stand on their own without a tweet at all.
 *
 * Everything factual is read from the built feed rather than typed. The
 * runtime, the certificate and the release date are on the cards, and a card
 * quoting a wrong runtime is worse than no card. For the same reason the
 * "abhi announce nahi hui" cards refuse to render once a streaming date
 * exists — the day that changes, this script fails instead of publishing a
 * sentence that has quietly become false.
 *
 * Usage:
 *   npm run title                       # every card
 *   CARD=runtime npm run title          # one
 *   TITLE=mirzapur-the-movie npm run title
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BRAND } from './brand.mjs';
import { launchChromium } from './browser.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = resolve(ROOT, 'dist');
const OUT = resolve(ROOT, 'social');
const SITE = (process.env.SITE_URL ?? 'https://newonott.in')
  .replace(/^https?:\/\//, '')
  .replace(/\/$/, '');

const SLUG = process.env.TITLE ?? 'mirzapur-the-movie';
const ONLY = process.env.CARD;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** `*word*` marks the one phrase that takes the warm gradient. One per card —
 *  two emphases in a sentence is the same as none. */
const emphasise = (s) => esc(s).replace(/\*([^*]+)\*/g, '<em>$1</em>');

// --- the facts ---------------------------------------------------------------

const feed = JSON.parse(await readFile(resolve(DIST, 'data/releases.json'), 'utf8'));
const film = feed.weeks.flatMap((w) => w.releases).find((r) => r.slug === SLUG);
if (!film) {
  console.error(`No title with slug "${SLUG}" in dist/data/releases.json. Run npm run build first.`);
  process.exit(1);
}

/**
 * In cinemas only, with nowhere to stream it yet — the premise every card on
 * this run depends on. Once a platform picks the film up the feed says so, and
 * a card reading "abhi announce nahi hui" becomes a lie the moment it posts.
 * Failing here is the only version of this that cannot be missed.
 */
const streaming = film.platforms.filter((p) => p !== 'theatres');
const announced = streaming.length > 0;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const d = new Date(`${film.releaseDate}T00:00:00Z`);
const released = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
const hrs = Math.floor(film.runtimeMinutes / 60);
const mins = film.runtimeMinutes % 60;

// --- the cards ---------------------------------------------------------------

/**
 * `kind` picks the layout, and the two are not interchangeable:
 *
 *   'statement'  one sentence, set large, centred. For a card that has to read
 *                as something a person said.
 *   'facts'      a row of figures. For the card whose whole content is data —
 *                setting numbers as prose buries them.
 *
 * `needsTweet` records which of these is a companion image rather than a post.
 * It changes nothing about the render; it is printed at the end so the run
 * tells you what still has to be paired with a screenshot.
 */
const CARDS = [
  {
    slug: 'not-announced',
    kind: 'statement',
    requiresUnannounced: true,
    badge: 'Sabse zyada poochha gaya',
    /**
     * The search query itself, in quotes, then the answer. Written short on
     * purpose: the first draft opened with the full title and the fit pass
     * dropped the sentence to 55px, where it floated in the middle of the
     * frame reading like a caption rather than a statement. Short rows are
     * what keep a statement card large.
     */
    lines: ['"Mirzapur OTT pe', 'kab aayegi?"', '*Abhi pata nahi.*'],
    note: 'Jis din announce hogi, page khud update ho jayega. Guess nahi karte hum.',
    needsTweet: false,
  },
  {
    slug: 'runtime',
    kind: 'facts',
    badge: 'Seat belt baandh lo',
    lines: [`${hrs} ghante ${mins} minute.`, 'Koi *pause button* nahi.'],
    facts: [
      ['Runtime', `${film.runtimeMinutes} min`],
      ['Certificate', film.certification],
      ['In cinemas', released],
      ['Director', film.director],
    ],
    note: 'Bathroom break ka plan pehle se bana lo.',
    needsTweet: true,
  },
  {
    slug: 'group-chat',
    kind: 'list',
    badge: 'Har group mein',
    lines: ['Abhi har friend group', 'mein *chaar* log hain.'],
    items: [
      'Ek jo dekh chuka hai',
      'Ek jo keh raha hai "spoiler mat dena"',
      'Ek jo poochh raha hai "OTT pe kab aayegi"',
      'Aur ek jo abhi tak Season 2 pe atka hai',
    ],
    note: 'Chauthe wale ko tag kar do.',
    needsTweet: false,
  },
  {
    slug: 'then-now',
    kind: 'statement',
    badge: '2018 → 2026',
    lines: [
      'Pehli baar laptop pe,',
      'akele, 2 baje raat ko.',
      'Aaj *theatre* mein.',
    ],
    note: 'Aath saal lag gaye. Lekin pahunch gaye.',
    needsTweet: true,
  },
];

const selected = ONLY ? CARDS.filter((c) => c.slug === ONLY) : CARDS;
if (!selected.length) {
  console.error(`CARD must be one of: ${CARDS.map((c) => c.slug).join(', ')}`);
  process.exit(1);
}
for (const card of selected) {
  if (card.requiresUnannounced && announced) {
    console.error(
      `${card.slug}: ${film.title} now streams on ${streaming.join(', ')}, so this card's premise is false.\n` +
        'Delete the card or rewrite it around the platform it landed on.',
    );
    process.exit(1);
  }
}

// --- render ------------------------------------------------------------------

const shell = (card, body) => `<!doctype html><meta charset="utf-8">
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

  .top { position:relative; flex:none; display:flex; align-items:center; gap:16px; }
  .mark { width:50px; height:50px; border-radius:15px; display:grid; place-items:center;
          background:linear-gradient(135deg,#ff4d4d,#ffb03a); }
  .mark svg { width:21px; height:21px; fill:#fff; }
  .brand { font-size:32px; font-weight:700; letter-spacing:-.022em; }
  .badge { margin-left:auto; padding:7px 17px; border-radius:999px;
           background:rgba(255,122,61,.14); border:1px solid rgba(255,122,61,.4);
           color:#ff9a5c; font-size:20px; font-weight:700; letter-spacing:.05em;
           text-transform:uppercase; white-space:nowrap; }

  /* The sentence owns the frame. Everything else is chrome around it, which is
     why this is the only flexible row and why it is centred rather than
     top-aligned — a statement pinned to the top of a 4:5 reads as a heading. */
  .body { position:relative; flex:1 1 auto; min-height:0;
          display:flex; flex-direction:column; justify-content:center; }
  h1 { font-size:86px; line-height:1.08; font-weight:900; letter-spacing:-.05em; }
  h1 span { display:block; white-space:nowrap; }
  h1 em { font-style:normal;
          background:linear-gradient(100deg,#ff4d4d,#ff7a3d 42%,#ffb03a);
          -webkit-background-clip:text; -webkit-text-fill-color:transparent; }

  .facts { display:grid; grid-template-columns:1fr 1fr; gap:26px; margin-top:56px; }
  .fact { border-radius:22px; padding:26px 28px;
          border:1px solid rgba(255,255,255,.09); background:rgba(255,255,255,.025); }
  .fact dt { font-size:19px; font-weight:800; letter-spacing:.12em; text-transform:uppercase; color:#8d94a4; }
  .fact dd { margin-top:9px; font-size:42px; font-weight:800; letter-spacing:-.03em; }

  ul { list-style:none; margin-top:52px; display:flex; flex-direction:column; gap:22px; }
  li { display:flex; align-items:flex-start; gap:20px;
       font-size:34px; line-height:1.28; font-weight:600; letter-spacing:-.02em; color:#d3d8e2; }
  li b { flex:none; width:42px; height:42px; margin-top:1px; border-radius:50%;
         display:grid; place-items:center; font-size:22px; font-weight:800;
         background:rgba(255,176,58,.14); color:#ffb03a; }

  .foot { position:relative; flex:none; margin-top:44px;
          display:flex; align-items:flex-end; justify-content:space-between; gap:28px; }
  .note { font-size:29px; font-weight:600; line-height:1.35; color:#b6bdcc; max-width:600px; }
  .url { flex:none; font-size:34px; font-weight:900; letter-spacing:-.03em; text-align:right;
         background:linear-gradient(100deg,#ffb03a,#ff4d4d);
         -webkit-background-clip:text; -webkit-text-fill-color:transparent; }
</style>
<div class="top">
  <span class="mark"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></span>
  <span class="brand">${esc(BRAND)}</span>
  <span class="badge">${esc(card.badge)}</span>
</div>
<div class="body">
  <h1>${card.lines.map((row) => `<span>${emphasise(row)}</span>`).join('')}</h1>
  ${body}
</div>
<div class="foot">
  <div class="note">${esc(card.note)}</div>
  <div class="url">${esc(SITE)}</div>
</div>`;

const bodyFor = (card) => {
  if (card.kind === 'facts') {
    return `<dl class="facts">${card.facts
      .map(([k, v]) => `<div class="fact"><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`)
      .join('')}</dl>`;
  }
  if (card.kind === 'list') {
    return `<ul>${card.items
      .map((t, i) => `<li><b>${i + 1}</b><span>${esc(t)}</span></li>`)
      .join('')}</ul>`;
  }
  return '';
};

await mkdir(OUT, { recursive: true });
const browser = await launchChromium('title');
try {
  for (const card of selected) {
    const page = await browser.newPage({ viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 1 });
    await page.setContent(shell(card, bodyFor(card)), { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);

    /** Shrink the sentence until its longest row fits, so rewriting a line for
     *  the next film gets smaller type rather than a row running off the edge. */
    const size = await page.evaluate(() => {
      const h1 = document.querySelector('h1');
      const rows = [...h1.querySelectorAll('span')];
      const limit = h1.clientWidth;
      let px = parseFloat(getComputedStyle(h1).fontSize);
      while (px > 34 && rows.some((r) => r.scrollWidth > limit)) {
        px -= 1;
        h1.style.fontSize = `${px}px`;
      }
      return Math.round(px);
    });

    /**
     * Below this the sentence stops being the card.
     *
     * The fit pass only guarantees the type fits, and it will happily settle
     * at 55px — which is what it did for the first version of the "abhi
     * announce nahi hui" card. Set that small in the middle of a 1080×1350
     * frame, the line read as a caption floating in empty space rather than
     * something a person said, and the whole format depends on the opposite.
     * The fix is always shorter rows, so say that rather than shipping it.
     */
    if (size < 62) {
      throw new Error(
        `${card.slug}: longest row forced the sentence down to ${size}px, which reads as a caption. ` +
          'Break it into shorter rows.',
      );
    }

    /** Measured per element: the background wash is deliberately wider than the
     *  canvas, so measuring the body would fail every card by the same margin. */
    const spill = await page.evaluate(() => {
      const w = document.body.clientWidth;
      const h = document.body.clientHeight;
      let worst = 0;
      for (const el of document.querySelectorAll('h1 span, li, .fact, .note, .url, .badge')) {
        const r = el.getBoundingClientRect();
        worst = Math.max(worst, r.right - w, r.bottom - h, -r.left, -r.top);
      }
      return Math.round(worst);
    });
    if (spill > 1) throw new Error(`${card.slug}: content runs ${spill}px past the frame — shorten a row.`);

    await writeFile(resolve(OUT, `mirzapur-${card.slug}.png`), await page.screenshot({ type: 'png' }));
    await page.close();
    console.log(
      `  mirzapur-${card.slug}.png  1080x1350  ${size}px` +
        (card.needsTweet ? '  — pair with your tweet screenshot' : '  — posts on its own'),
    );
  }
} finally {
  await browser.close();
}

console.log(
  '\n  Cards marked "pair with" are slide 2. Slide 1 is a screenshot of the\n' +
    '  tweet you actually posted — this script will not fake one, because an\n' +
    '  invented tweet is the one thing that breaks the format.\n',
);
