#!/usr/bin/env node
/**
 * A launch post for one page, built around a real screenshot of it.
 *
 * The hook and meme posts argue for the product in words. This one shows it,
 * which is the only format that answers "is this actually any good" before
 * someone taps a link — and for a page like /south, the screenshot is the
 * pitch: the language split and the platform split are visible in it.
 *
 * Two ways to get the screenshot, and the difference matters:
 *
 *   SHOT=path.png   use an image you took. Preferred, and the only version
 *                   that is a screenshot of the *live site* — right fonts,
 *                   right posters, right week.
 *   (default)       render dist/ locally and screenshot it. Structurally
 *                   accurate — same layout, same data, same colours — but the
 *                   typeface will be whatever the machine has, because the
 *                   site loads Inter from Google Fonts and a build box
 *                   usually cannot reach it. Fine for judging the design,
 *                   wrong for publishing.
 *
 * Usage:
 *   npm run feature                          # /south, rendered here
 *   SHOT=~/south.png npm run feature         # /south, your screenshot
 *   PAGE=/web-series SHOT=… npm run feature  # any other page
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

const PAGE = process.env.PAGE ?? '/south';
const SHOT = process.env.SHOT;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * The copy, per page.
 *
 * Kept beside the script rather than derived, because a launch line is an
 * editorial judgement and there is no data to compute it from. Falls back to
 * something honest and generic so a new page still produces a usable post.
 */
const COPY = {
  '/south': {
    badge: 'New page',
    head: ['South ka poora hafta,', 'ek *page* pe.'],
    sub: 'Tamil, Telugu, Malayalam, Kannada — movies aur shows, har platform se. Theatres bhi.',
  },
  '/web-series': {
    badge: 'New page',
    head: ['Sirf web series,', 'ek *page* pe.'],
    sub: 'Har platform ki nayi series — Netflix, Prime, JioHotstar, SonyLIV, ZEE5 aur baaki sab.',
  },
};
const copy = COPY[PAGE] ?? {
  badge: 'New page',
  head: [`${PAGE.replace('/', '')} —`, 'ek *page* pe.'],
  sub: 'Har platform ki nayi release, ek hi jagah. Har Friday update.',
};

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

const browser = await launchChromium('feature');
let shotDataUri;
let live = false;

try {
  if (SHOT) {
    const buf = await readFile(resolve(SHOT));
    shotDataUri = `data:image/png;base64,${buf.toString('base64')}`;
    live = true;
  } else {
    const { server, port } = await serveDist();
    try {
      const p = await browser.newPage({ viewport: { width: 440, height: 900 }, deviceScaleFactor: 2 });
      await p.goto(`http://127.0.0.1:${port}${PAGE}`, { waitUntil: 'networkidle' });
      await p.evaluate(() => document.fonts.ready);
      // Let the board settle: posters and logos resolve after first paint.
      await new Promise((r) => setTimeout(r, 1200));
      const buf = await p.screenshot({ type: 'png' });
      shotDataUri = `data:image/png;base64,${buf.toString('base64')}`;
      await p.close();
    } finally {
      server.close();
    }
  }

  // --- compose the post ------------------------------------------------------

  /**
   * The device sits low and runs off the bottom edge on purpose. A whole phone
   * floating in the middle of a 4:5 frame either has to be small enough to
   * read as an icon or leaves nothing for the copy; letting it bleed keeps the
   * screenshot large enough to actually see, and reads as "there is more here"
   * rather than "this is all of it".
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
           color:#ff9a5c; font-size:22px; font-weight:700; letter-spacing:.06em; text-transform:uppercase; }

  h1 { position:relative; margin-top:44px; font-size:76px; line-height:1.06;
       font-weight:900; letter-spacing:-.05em; }
  h1 span { display:block; white-space:nowrap; }
  h1 em { font-style:normal;
          background:linear-gradient(100deg,#ff4d4d,#ff7a3d 42%,#ffb03a);
          -webkit-background-clip:text; -webkit-text-fill-color:transparent; }
  p { position:relative; margin-top:26px; max-width:840px;
      font-size:31px; line-height:1.42; font-weight:500; color:#b6bdcc; }

  /* The screenshot, in a frame quiet enough not to compete with it. */
  .device {
    position:absolute; left:50%; transform:translateX(-50%); top:492px;
    width:524px; border-radius:34px; padding:9px;
    background:#15171d; border:1px solid rgba(255,255,255,.13);
    box-shadow:0 40px 90px rgba(0,0,0,.55);
  }
  .device img { display:block; width:100%; border-radius:26px; }

  /* Fades the screenshot into the canvas so the cut-off edge reads as a
     deliberate crop, and gives the URL something to sit on. */
  .foot {
    position:absolute; left:0; right:0; bottom:0; height:236px;
    display:flex; flex-direction:column; justify-content:flex-end;
    padding:0 76px 50px;
    /* Stays transparent for the first third so the screenshot's own facts —
       the language and platform splits, which are the reason to tap — are
       still readable above the fade rather than buried by it. */
    background:linear-gradient(180deg, rgba(6,7,10,0) 0%, rgba(6,7,10,.55) 34%, rgba(6,7,10,.95) 62%, #06070a 82%);
  }
  .url { font-size:58px; font-weight:900; letter-spacing:-.04em;
         background:linear-gradient(100deg,#ffb03a,#ff4d4d);
         -webkit-background-clip:text; -webkit-text-fill-color:transparent; }
  .note { margin-top:10px; font-size:27px; font-weight:500; color:#8d94a4; }
</style>
<div class="top">
  <span class="mark"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></span>
  <span class="brand">${esc(BRAND)}</span>
  <span class="badge">${esc(copy.badge)}</span>
</div>
<h1>${copy.head.map((row) => `<span>${emphasise(row)}</span>`).join('')}</h1>
<p>${esc(copy.sub)}</p>
<div class="device"><img src="${shotDataUri}" alt=""></div>
<div class="foot">
  <div class="url">${esc(SITE)}${esc(PAGE)}</div>
  <div class="note">No app. No login. Har Friday update.</div>
</div>`;

  const page = await browser.newPage({ viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);

  /** Shrink the headline until its widest row fits, so a longer line for a
   *  future page gets smaller type instead of running off the frame. */
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

  await mkdir(OUT, { recursive: true });
  const name = `feature${PAGE.replace(/\//g, '-')}.png`;
  await writeFile(resolve(OUT, name), await page.screenshot({ type: 'png' }));
  await page.close();

  console.log(`  ${name}  1080x1350  headline ${fitted}px`);
  console.log(
    live
      ? '  screenshot: yours, from the live site'
      : '  screenshot: rendered from dist/ — layout and data are right, the\n' +
        '              typeface is not (Inter could not be fetched here).\n' +
        '              Re-run with SHOT=<your screenshot> before posting.',
  );
} finally {
  await browser.close();
}
