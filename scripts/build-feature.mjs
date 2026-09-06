#!/usr/bin/env node
/**
 * Posts where the product's own screen is the punchline.
 *
 * The mechanic borrowed here — the one Zepto and its imitators actually run —
 * is that the joke and the demo are the same object. They screenshot their own
 * app with an absurd search; the post is funny *and* it shows you the product
 * working. Nothing is mocked up, which is why it lands: a reader can tell the
 * difference between a designed promise and a real screen.
 *
 * That transfers here better than to most products, because this site answers
 * questions people are already typing. So every post below is a real URL,
 * screenshotted as it actually renders — no invented UI, no faked results, no
 * "coming soon" states dressed up as live ones. If a screenshot shows five
 * Malayalam thrillers, there are five.
 *
 * Two ways to supply the screenshot, and the difference matters:
 *
 *   SHOT=path.png   an image you took of the live site. Right fonts, right
 *                   posters, right week. Use this for anything you post.
 *   (default)       render dist/ here and screenshot it. Same layout, same
 *                   data, same colours — but the typeface will be whatever
 *                   this machine has, because the site loads Inter from Google
 *                   Fonts and a build box usually cannot reach it.
 *
 * Usage:
 *   npm run feature                       # all posts, rendered here
 *   POST=mirzapur npm run feature         # just one
 *   POST=south SHOT=~/south.png npm run feature
 */

import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { resolve, dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BRAND } from './brand.mjs';
import { launchChromium } from './browser.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = resolve(ROOT, 'dist');
const OUT = resolve(ROOT, 'social');
const SITE = (process.env.SITE_URL ?? 'https://newonott.in')
  .replace(/^https?:\/\//, '')
  .replace(/\/$/, '');

const ONLY = process.env.POST;
const SHOT = process.env.SHOT;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * The five posts.
 *
 * `url` is a real path on the real site, including its query string — the
 * filters and searches are the app's own URL state, so a screenshot of one is
 * a screenshot of a thing a reader can reproduce by tapping.
 *
 * Copy lives here rather than being derived: a line is an editorial judgement
 * and there is no data to compute one from. The numbers inside the copy are
 * the exception — where a caption quotes a figure it is one taken from the
 * feed, and it is worth re-checking when the feed moves.
 */
const POSTS = [
  {
    slug: 'mirzapur',
    url: '/ott-release-date/mirzapur-the-movie',
    badge: 'Sabse zyada poocha gaya',
    head: ['Mirzapur kab', 'aayegi *OTT* pe?'],
    sub: 'Abhi tak announce nahi hui. Jis din hogi, ye page khud bata dega — har platform hafte mein do baar check hota hai.',
    caption: `"Mirzapur OTT pe kab aayegi?"

Har din koi na koi poochta hai. Iska ab ek page hai — aur wo page jhooth nahi bolta.

Abhi tak kisi platform ne date announce nahi ki. Toh page yehi likha hai: not announced yet. Koi "expected date" nahi, koi guess nahi. Jis din actually announce hogi, page khud update ho jayega — har platform hafte mein do baar check hota hai.

Aisa har theatrical release ke liye page hai.

🔗 newonott.in — link in bio

Kaunsi movie ka wait kar rahe ho? 👇`,
  },
  {
    slug: 'cast-search',
    /**
     * A name with results *in the week the board is showing*. The board
     * searches one week, not the whole feed — the first version of this post
     * used an actor whose titles were three weeks back and the screenshot came
     * out reading "No matches in this week" under a headline promising the
     * opposite.
     */
    url: '/?q=Arshad%20Warsi',
    badge: 'Chhupa hua feature',
    head: ['Actor ka naam', 'daalo. *Bas*.'],
    sub: 'Search sirf titles nahi dhoondhta — cast aur genre se bhi. Arshad Warsi ki is hafte ki dono releases, ek search mein.',
    caption: `Ek cheez jo shayad tumhe pata nahi.

Search box sirf movie ke naam se nahi chalta. Actor ka naam daalo — poore hafte se uski releases nikal aayengi. Genre daalo — wahi kaam.

Arshad Warsi likha, is hafte ki dono releases mil gayin. Alag-alag platform, ek hi jagah.

No app, no login. Bas type karo.

🔗 newonott.in — link in bio

Kiska naam sabse pehle search karoge? 👇`,
  },
  {
    slug: 'hindi-comedy',
    /**
     * Hindi + Comedy, because that combination actually has rows in the week
     * on screen. Malayalam + Thriller was the first choice and has five across
     * the whole feed but none in the current week — the filter would have been
     * demonstrated by an empty board.
     */
    url: '/hindi?g=Comedy',
    /* "2 taps", not "Do tap" — the badge is uppercased, and DO TAP reads as an
       English instruction rather than Hinglish "two taps". */
    badge: '2 taps',
    head: ['Sirf Hindi.', 'Sirf *comedy*.'],
    sub: 'Language chuno, genre chuno — poora hafta filter ho jaata hai. Har platform, plus theatres.',
    caption: `"Hindi comedy chahiye, aur kuch nahi."

Do tap. Language chuno, genre chuno, ho gaya.

Ye woh cheez hai jo koi bhi OTT app nahi de sakta — kyunki har app sirf apna hi content dikhata hai. Yahan sab platforms ek saath filter hote hain. Theatres bhi.

Malayalam thriller chahiye? Tamil action? Telugu drama? Wahi do tap.

🔗 newonott.in — link in bio

Tumhara combo kya hai? 👇`,
  },
  {
    slug: 'south',
    url: '/south',
    badge: 'Ek number',
    head: ['70 South releases.', '*64* sirf theatre mein.'],
    sub: 'Sirf 6 kisi OTT platform pe. Ye number har mahine badalta hai — aur page apne aap update hota rehta hai.',
    caption: `South ka poora hafta, ek page pe.

Page banate waqt ek cheez pata chali jo humein bhi nahi pata thi: is waqt 70 South releases mein se 64 sirf theatres mein hain. Sirf 6 kisi OTT platform pe pahunchi hain.

Matlab agar tum sirf OTT dekhte ho, toh South ka zyada tar hissa tumse chhoot raha hai.

Tamil 27, Telugu 19, Malayalam 16, Kannada 11 — sab ek page pe, har platform se, theatres ke saath.

🔗 newonott.in/south — link in bio

Tumhari language kaunsi? 👇`,
  },
  {
    slug: 'archive',
    url: '/w/2026-08-28',
    badge: 'Archive',
    head: ['Pichhla hafta', '*miss* ho gaya?'],
    sub: 'Har hafte ka apna page hai. Purana hafta wahin ka wahin rehta hai — kuch delete nahi hota.',
    caption: `Har hafte ka apna page hai.

Zyada tar sites purana content hata deti hain — nayi list aayi, purani gayi. Yahan nahi. Har Friday ka apna permanent page banta hai, aur wahin rehta hai.

Do hafte pehle kya aaya tha? Ek link door.

Isse ek aur cheez hoti hai: ek mahine baad bhi tum dekh sakte ho ki kis hafte kya release hua tha. Koi aur ye nahi rakhta.

🔗 newonott.in — link in bio

Kaunsa hafta check karna chahoge? 👇`,
  },
];

const selected = ONLY ? POSTS.filter((p) => p.slug === ONLY) : POSTS;
if (!selected.length) {
  console.error(`POST must be one of: ${POSTS.map((p) => p.slug).join(', ')}`);
  process.exit(1);
}
if (SHOT && selected.length > 1) {
  console.error('SHOT applies to one post — pass POST=<slug> with it.');
  process.exit(1);
}

const emphasise = (row) => esc(row).replace(/\*([^*]+)\*/g, '<em>$1</em>');

// --- get the screenshot ------------------------------------------------------

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.txt': 'text/plain', '.webmanifest': 'application/manifest+json' };

/** A static server over dist/, so the screenshot is of the built site rather
 *  than a mock of it. Mirrors Cloudflare's directory-index behaviour. */
function serveDist() {
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    for (const candidate of [join(DIST, path), join(DIST, path, 'index.html')]) {
      try {
        if ((await stat(candidate)).isFile()) {
          res.writeHead(200, { 'content-type': MIME[extname(candidate)] ?? 'application/octet-stream' });
          createReadStream(candidate).pipe(res);
          return;
        }
      } catch {
        /* try the next candidate */
      }
    }
    res.writeHead(404).end('not found');
  });
  return new Promise((ok) => server.listen(0, () => ok({ server, port: server.address().port })));
}

await mkdir(OUT, { recursive: true });
const browser = await launchChromium('feature');
const { server, port } = SHOT ? { server: null, port: 0 } : await serveDist();

/** One post: capture the real page, then compose the frame around it. */
async function build(post) {
  let shotDataUri;
  if (SHOT) {
    shotDataUri = `data:image/png;base64,${(await readFile(resolve(SHOT))).toString('base64')}`;
  } else {
    const p = await browser.newPage({ viewport: { width: 440, height: 900 }, deviceScaleFactor: 2 });
    await p.goto(`http://127.0.0.1:${port}${post.url}`, { waitUntil: 'networkidle' });
    await p.evaluate(() => document.fonts.ready);
    // Let the board settle: posters and platform logos resolve after first paint.
    await new Promise((r) => setTimeout(r, 1400));
    /**
     * Refuse to build a post whose screenshot shows nothing.
     *
     * The board searches and filters the week it is displaying, not the whole
     * feed, so a hand-picked query can be correct today and empty next Friday
     * when the week rotates. That already happened once: an actor with two
     * titles three weeks back produced "No matches in this week" under a
     * headline promising his releases. Failing the run is the only way that
     * does not end with it being noticed after posting.
     */
    const empty = await p.evaluate(() => {
      const el = document.querySelector('.empty h3');
      return el ? el.textContent.trim() : null;
    });
    if (empty) {
      throw new Error(
        `${post.slug}: ${post.url} renders an empty state ("${empty}"). ` +
          'The board only searches the week on screen — pick a query with rows in it.',
      );
    }

    shotDataUri = `data:image/png;base64,${(await p.screenshot({ type: 'png' })).toString('base64')}`;
    await p.close();
  }

  /**
   * The device sits low and bleeds off the bottom edge on purpose. A whole
   * phone floating in the middle of a 4:5 frame either shrinks until it reads
   * as an icon or leaves nothing for the copy; bleeding keeps the screenshot
   * large enough to actually see and reads as "there is more here".
   */
  const html = `<!doctype html><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body {
    width:1080px; height:1350px; position:relative; overflow:hidden;
    background:#06070a; color:#f2f4f9; font-family:Inter,system-ui,sans-serif;
    padding:78px 76px 0;
  }
  body::before, body::after {
    content:''; position:absolute; width:1100px; height:1100px; border-radius:50%; pointer-events:none;
  }
  body::before { top:-700px; left:-330px; background:radial-gradient(circle, rgba(255,61,61,.34), transparent 62%); }
  body::after  { bottom:-700px; right:-340px; background:radial-gradient(circle, rgba(126,78,255,.26), transparent 64%); }

  .top { position:relative; display:flex; align-items:center; gap:16px; }
  .mark { width:50px; height:50px; border-radius:15px; display:grid; place-items:center;
          background:linear-gradient(135deg,#ff4d4d,#ffb03a); }
  .mark svg { width:21px; height:21px; fill:#fff; }
  .brand { font-size:32px; font-weight:700; letter-spacing:-.022em; }
  .badge { margin-left:auto; padding:7px 16px; border-radius:999px;
           background:rgba(255,122,61,.14); border:1px solid rgba(255,122,61,.4);
           color:#ff9a5c; font-size:21px; font-weight:700; letter-spacing:.05em; text-transform:uppercase;
           white-space:nowrap; }

  h1 { position:relative; margin-top:44px; font-size:76px; line-height:1.06;
       font-weight:900; letter-spacing:-.05em; }
  h1 span { display:block; white-space:nowrap; }
  h1 em { font-style:normal;
          background:linear-gradient(100deg,#ff4d4d,#ff7a3d 42%,#ffb03a);
          -webkit-background-clip:text; -webkit-text-fill-color:transparent; }
  p { position:relative; margin-top:26px; max-width:860px;
      font-size:30px; line-height:1.42; font-weight:500; color:#b6bdcc; }

  .device {
    position:absolute; left:50%; transform:translateX(-50%); top:492px;
    width:524px; border-radius:34px; padding:9px;
    background:#15171d; border:1px solid rgba(255,255,255,.13);
    box-shadow:0 40px 90px rgba(0,0,0,.55);
  }
  .device img { display:block; width:100%; border-radius:26px; }

  .foot {
    position:absolute; left:0; right:0; bottom:0; height:236px;
    display:flex; flex-direction:column; justify-content:flex-end;
    padding:0 76px 50px;
    /* Transparent for the first third so the screenshot's own facts — the
       thing that makes someone tap — stay readable above the fade. */
    background:linear-gradient(180deg, rgba(6,7,10,0) 0%, rgba(6,7,10,.55) 34%, rgba(6,7,10,.95) 62%, #06070a 82%);
  }
  .url { font-size:56px; font-weight:900; letter-spacing:-.04em;
         background:linear-gradient(100deg,#ffb03a,#ff4d4d);
         -webkit-background-clip:text; -webkit-text-fill-color:transparent; }
  .note { margin-top:10px; font-size:26px; font-weight:500; color:#8d94a4; }
</style>
<div class="top">
  <span class="mark"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></span>
  <span class="brand">${esc(BRAND)}</span>
  <span class="badge">${esc(post.badge)}</span>
</div>
<h1>${post.head.map((row) => `<span>${emphasise(row)}</span>`).join('')}</h1>
<p>${esc(post.sub)}</p>
<div class="device"><img src="${shotDataUri}" alt=""></div>
<div class="foot">
  <div class="url">${esc(SITE)}</div>
  <div class="note">No app. No login. Har Friday update.</div>
</div>`;

  const page = await browser.newPage({ viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);

  /** Shrink the headline until its widest row fits, so a longer line for a
   *  future post gets smaller type instead of running off the frame. */
  const fitted = await page.evaluate(() => {
    const h1 = document.querySelector('h1');
    const rows = [...h1.querySelectorAll('span')];
    const limit = h1.clientWidth;
    let size = parseFloat(getComputedStyle(h1).fontSize);
    while (size > 40 && rows.some((r) => r.scrollWidth > limit)) {
      size -= 2;
      h1.style.fontSize = `${size}px`;
    }
    return size;
  });

  await writeFile(resolve(OUT, `post-${post.slug}.png`), await page.screenshot({ type: 'png' }));
  await writeFile(resolve(OUT, `post-${post.slug}-caption.txt`), `${post.caption}\n`);
  await page.close();
  console.log(`  post-${post.slug}.png  1080x1350  ${fitted}px  ${post.url}`);
}

try {
  for (const post of selected) await build(post);
  console.log(
    SHOT
      ? '\n  screenshot: yours, from the live site'
      : '\n  screenshots rendered from dist/ — layout and data are right, the\n' +
        '  typeface is not (Inter could not be fetched here). Re-run one at a\n' +
        '  time with POST=<slug> SHOT=<your screenshot> before posting.',
  );
} finally {
  await browser.close();
  server?.close();
}
