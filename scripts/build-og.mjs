#!/usr/bin/env node
/**
 * Renders public/og.png — the 1200×630 card every link preview shows.
 *
 * This existed as a hand-made image, which meant it still said "firstday" after
 * the site was renamed: every WhatsApp and Slack preview would have carried the
 * wrong brand, and nothing in the build would ever have noticed. So it is
 * generated instead, from the same brand constants and the same platform
 * registry the site itself uses.
 *
 * Not part of `npm run build`, and Playwright is deliberately not a dependency:
 * it needs a browser, it changes about once a year, and neither CI nor the
 * Cloudflare build should pay for Chromium on every install to re-render a file
 * that did not change. Run it by hand after touching src/data/brand.ts.
 *
 *   npm run og
 */

import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BRAND, HEADLINE } from './brand.mjs';
import { launchChromium } from './browser.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'public/og.png');

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * The chips name real platforms, pulled from the registry rather than typed
 * here — so adding or dropping a service is reflected the next time this runs.
 * Theatrical leads, since it is the one row an OTT-only competitor cannot show.
 */
const registry = await readFile(resolve(ROOT, 'src/data/platforms.ts'), 'utf8');
const names = [...registry.matchAll(/\{\s*id:\s*'([^']+)',\s*name:\s*'([^']+)'/g)].map(
  ([, , name]) => name,
);
const theatres = names.find((n) => /theatre/i.test(n));
const chips = [...names.filter((n) => n !== theatres).slice(0, 5), theatres].filter(Boolean);

/**
 * "everything new, everywhere, this week" splits on its own commas into three
 * phrases, the middle one carrying the gradient — the same treatment the
 * wordmark gets on the site. Splitting on spaces instead left the comma
 * attached to the accent word and printed it twice.
 */
const [head, accent, tail] = (() => {
  const parts = HEADLINE.split(',').map((p) => p.trim());
  const sentence = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
  if (parts.length >= 3) return [sentence(parts[0]), parts[1], parts.slice(2).join(', ')];
  return [sentence(parts[0] ?? HEADLINE), '', parts.slice(1).join(', ')];
})();

const html = `<!doctype html><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;700;800&display=swap" rel="stylesheet">
<style>
  * { margin: 0; box-sizing: border-box; }
  body {
    width: 1200px; height: 630px; padding: 64px 76px;
    display: flex; flex-direction: column; justify-content: center; gap: 24px;
    background: #06070a; color: #f2f4f9;
    font-family: Inter, system-ui, sans-serif; overflow: hidden; position: relative;
  }
  /* The same two-corner wash the app and the share card use, so a preview and
     the page it opens read as one product. */
  body::before, body::after {
    content: ''; position: absolute; width: 900px; height: 900px; border-radius: 50%;
    filter: blur(10px); pointer-events: none;
  }
  body::before { top: -560px; left: -220px; background: radial-gradient(circle, rgba(255,61,61,.30), transparent 62%); }
  body::after  { top: -520px; right: -260px; background: radial-gradient(circle, rgba(126,78,255,.26), transparent 62%); }
  .row { display: flex; align-items: center; gap: 20px; position: relative; }
  .mark {
    width: 52px; height: 52px; border-radius: 15px; display: grid; place-items: center;
    background: linear-gradient(135deg, #ff4d4d, #ffb03a);
  }
  .mark svg { width: 22px; height: 22px; fill: #fff; }
  .word { font-size: 40px; font-weight: 700; letter-spacing: -0.02em; }
  h1 {
    position: relative; font-size: 76px; line-height: 1.06; font-weight: 800;
    letter-spacing: -0.035em; max-width: 15ch;
  }
  h1 em {
    font-style: normal;
    /* No blue stop — clipped to text, the ramp through blue desaturates
       mid-word and the tail of the phrase renders grey. */
    background: linear-gradient(100deg, #ff4d4d, #ff7a3d 42%, #ffb03a);
    -webkit-background-clip: text; -webkit-text-fill-color: transparent;
  }
  p { position: relative; font-size: 26px; line-height: 1.45; color: #b6bdcc; max-width: 44ch; }
  .chips { position: relative; display: flex; gap: 12px; flex-wrap: nowrap; }
  .chip {
    padding: 11px 21px; border-radius: 999px; font-size: 19px; font-weight: 700;
    background: rgba(255,255,255,.055); border: 1px solid rgba(255,255,255,.11);
  }
</style>
<div class="row">
  <span class="mark"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></span>
  <span class="word">${esc(BRAND)}</span>
</div>
<h1>${esc(head)},<br>${accent ? `<em>${esc(accent)}</em>, ` : ''}${esc(tail)}.</h1>
<p>Every film, series and show landing across OTT and in theatres. One page, no login.</p>
<div class="chips">${chips.map((c) => `<span class="chip">${esc(c)}</span>`).join('')}</div>
`;

const browser = await launchChromium('og');
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: 'networkidle' });
  // Webfonts can resolve after networkidle; without this the card renders in a
  // fallback face and the wordmark comes out visibly wrong.
  await page.evaluate(() => document.fonts.ready);
  await writeFile(OUT, await page.screenshot({ type: 'png' }));
} finally {
  await browser.close();
}

console.log(`og: wrote public/og.png — 1200×630, "${BRAND}", ${chips.length} platform chips`);
