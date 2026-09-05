#!/usr/bin/env node
/**
 * Weekly social posters, built from the same feed as the site.
 *
 * The thing this product competes with is a release calendar people already
 * forward on WhatsApp — so the poster does not advertise the site, it *is* the
 * week, with the address on it. Nobody forwards an ad; plenty of people forward
 * a list their group chat was about to ask for. The utility has to be on the
 * image itself or the post does no work.
 *
 * Two sizes because posting one crop to both looks careless:
 *   4:5  1080x1350  Instagram feed — the tallest crop the feed allows, so it
 *                   takes the most screen on a scroll
 *   9:16 1080x1920  Stories, Reels covers, WhatsApp status
 *
 * Regenerate every week: the titles change, so the post is never the same
 * creative twice, and a returning viewer sees new information rather than the
 * same banner again.
 *
 * Usage: npm run social
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BRAND } from './brand.mjs';
import { launchChromium } from './browser.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'social');
const SITE = (process.env.SITE_URL ?? 'https://newonott.in').replace(/^https?:\/\//, '').replace(/\/$/, '');
const REGION = (process.env.REGIONS ?? 'IN').split(',')[0].trim() || 'IN';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const feed = JSON.parse(await readFile(resolve(ROOT, 'public/data/releases.json'), 'utf8'));

// Names and brand colours from the app's own registry, so a poster can never
// show a platform the site does not.
const registry = await readFile(resolve(ROOT, 'src/data/platforms.ts'), 'utf8');
const platforms = new Map(
  [...registry.matchAll(/\{\s*id:\s*'([^']+)',\s*name:\s*'([^']+)'[\s\S]*?accent:\s*'([^']+)'/g)].map(
    ([, id, name, accent]) => [id, { name, accent }],
  ),
);
const pname = (id) => platforms.get(id)?.name ?? id;
const paccent = (id) => platforms.get(id)?.accent ?? '#8d94a4';

const DAY = 86_400_000;
const now = new Date();
const base = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
const currentWeek = new Date(base.getTime() - ((base.getUTCDay() + 2) % 7) * DAY).toISOString().slice(0, 10);

const stocked = feed.weeks.filter((w) => w.releases.some((r) => r.regions.includes(REGION)));
const week =
  stocked.find((w) => w.id === currentWeek) ??
  stocked.reduce(
    (best, w) =>
      Math.abs(Date.parse(w.id) - Date.parse(currentWeek)) < Math.abs(Date.parse(best.id) - Date.parse(currentWeek))
        ? w
        : best,
    stocked[0],
  );
if (!week) {
  console.error('No stocked week in the feed — nothing to post.');
  process.exit(1);
}

const rows = week.releases
  .filter((r) => r.regions.includes(REGION))
  .sort((a, b) => (b.heat ?? 0) - (a.heat ?? 0));

const a = new Date(`${week.id}T00:00:00Z`);
const b = new Date(a.getTime() + 6 * DAY);
const range =
  a.getUTCMonth() === b.getUTCMonth()
    ? `${a.getUTCDate()}–${b.getUTCDate()} ${MONTHS[b.getUTCMonth()]}`
    : `${a.getUTCDate()} ${MONTHS[a.getUTCMonth()]} – ${b.getUTCDate()} ${MONTHS[b.getUTCMonth()]}`;

const platformCount = new Set(rows.flatMap((r) => r.platforms)).size;

/**
 * How many titles each crop can carry before the type has to shrink past the
 * point where it reads in a feed at thumbnail size. Fewer, bigger, legible
 * beats a complete list nobody can read.
 */
const SIZES = [
  // Instagram feed. 4:5 is the tallest crop the feed allows, so it takes the
  // most screen on a scroll.
  { name: 'instagram-4x5', w: 1080, h: 1350, items: 8, title: 40, head: 92 },
  // WhatsApp chat. A 9:16 gets aggressively cropped in the message thumbnail
  // and the URL is what gets cut, so forwards get a square that cannot lose it.
  { name: 'whatsapp-1x1', w: 1080, h: 1080, items: 6, title: 40, head: 84 },
  // Stories, Reels covers, WhatsApp status.
  { name: 'story-9x16', w: 1080, h: 1920, items: 11, title: 42, head: 104 },
];

function page({ w, h, items, title, head }) {
  const list = rows.slice(0, items);
  const rest = rows.length - list.length;

  return `<!doctype html><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body {
    width:${w}px; height:${h}px; position:relative; overflow:hidden;
    background:#06070a; color:#f2f4f9;
    font-family:Inter,system-ui,sans-serif;
    display:flex; flex-direction:column;
    padding:${Math.round(h * 0.062)}px 72px;
  }
  /* The same two-corner wash as the site and the share card, so a poster and
     the page it points at read as one product. */
  body::before, body::after {
    content:''; position:absolute; width:1100px; height:1100px; border-radius:50%; pointer-events:none;
  }
  body::before { top:-680px; left:-300px; background:radial-gradient(circle, rgba(255,61,61,.34), transparent 62%); }
  body::after  { bottom:-780px; right:-320px; background:radial-gradient(circle, rgba(126,78,255,.26), transparent 64%); }

  .top { display:flex; align-items:center; gap:16px; position:relative; }
  .mark { width:44px; height:44px; border-radius:13px; display:grid; place-items:center;
          background:linear-gradient(135deg,#ff4d4d,#ffb03a); }
  .mark svg { width:19px; height:19px; fill:#fff; }
  .brand { font-size:31px; font-weight:700; letter-spacing:-.02em; }
  .week { margin-left:auto; font-size:23px; font-weight:700; letter-spacing:.13em;
          text-transform:uppercase; color:#8d94a4; }

  h1 { position:relative; flex:none; margin-top:${Math.round(h * 0.038)}px;
       font-size:${head}px; line-height:1.02; font-weight:900; letter-spacing:-.045em; }
  /* Warm the whole way, no blue stop. Clipped to a short word the red→gold→blue
     ramp desaturates mid-letter: "week." came out with a grey "k" and a grey
     full stop, which reads as a broken render rather than a colour choice. Same
     ramp as the play mark, so wordmark and headline agree. */
  h1 em { font-style:normal;
          background:linear-gradient(100deg,#ff4d4d,#ff7a3d 42%,#ffb03a);
          -webkit-background-clip:text; -webkit-text-fill-color:transparent; }
  .count { position:relative; margin-top:20px; font-size:27px; font-weight:500; color:#b6bdcc; }

  /* The list absorbs whatever is left rather than being sized by a guess.
     Computing row padding as a fraction of the canvas overflowed the footer off
     the bottom — and the footer carries the URL, which is the only thing the
     post is actually for. */
  ul { position:relative; list-style:none; margin-top:${Math.round(h * 0.035)}px;
       flex:1 1 auto; min-height:0; display:flex; flex-direction:column; }
  li { flex:1 1 0; min-height:0; display:flex; align-items:center; gap:16px;
       border-bottom:1px solid rgba(255,255,255,.08); }
  li:last-child { border-bottom:0; }
  .dot { width:11px; height:11px; border-radius:50%; flex:none; }
  .t { font-size:${title}px; font-weight:700; letter-spacing:-.028em; flex:1;
       white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .p { font-size:${Math.round(title * 0.62)}px; font-weight:650; flex:none; }

  .more { position:relative; flex:none; margin-top:20px; font-size:26px; font-weight:500; color:#7d8494; }

  .foot { position:relative; flex:none; margin-top:${Math.round(h * 0.028)}px; padding-top:28px;
          border-top:1px solid rgba(255,255,255,.12); }
  .url { font-size:${Math.round(head * 0.56)}px; font-weight:800; letter-spacing:-.035em;
         background:linear-gradient(100deg,#ffb03a,#ff4d4d); -webkit-background-clip:text;
         -webkit-text-fill-color:transparent; }
  .kicker { margin-top:12px; font-size:25px; font-weight:500; color:#8d94a4; }
</style>
<div class="top">
  <span class="mark"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></span>
  <span class="brand">${esc(BRAND)}</span>
  <span class="week">${esc(range)}</span>
</div>

<h1>Out this<br><em>week</em>.</h1>
<div class="count">${rows.length} releases · ${platformCount} platforms · one page</div>

<ul>
  ${list
    .map(
      (r) => `<li>
    <span class="dot" style="background:${paccent(r.platforms[0])}"></span>
    <span class="t">${esc(r.title)}</span>
    <span class="p" style="color:${paccent(r.platforms[0])}">${esc(pname(r.platforms[0]))}</span>
  </li>`,
    )
    .join('\n  ')}
</ul>
${rest > 0 ? `<div class="more">+ ${rest} more, including everything in cinemas</div>` : ''}

<div class="foot">
  <div class="url">${esc(SITE)}</div>
  <div class="kicker">Every Friday. No app, no login.</div>
</div>
`;
}

await mkdir(OUT, { recursive: true });
const browser = await launchChromium('social');
try {
  for (const size of SIZES) {
    const p = await browser.newPage({ viewport: { width: size.w, height: size.h }, deviceScaleFactor: 1 });
    await p.setContent(page(size), { waitUntil: 'networkidle' });
    // Webfonts can resolve after networkidle; without this the poster renders in
    // a fallback face and the whole thing looks like a draft.
    await p.evaluate(() => document.fonts.ready);
    await writeFile(resolve(OUT, `${size.name}.png`), await p.screenshot({ type: 'png' }));
    await p.close();
    console.log(`  ${size.name}.png  ${size.w}x${size.h}  ${size.items} titles`);
  }
} finally {
  await browser.close();
}

/**
 * The words, generated with the pictures.
 *
 * Writing a fresh caption every week is the same chore that kills newsletters,
 * and a recycled one reads as a recycled post. Both are built from the same
 * week the posters show, so the titles named in the copy are the titles on the
 * image.
 */
const named = rows.slice(0, 5).map((r) => `${r.title} (${pname(r.platforms[0])})`);
const caption = [
  `Out this week — ${range}`,
  '',
  ...rows.slice(0, 5).map((r) => `• ${r.title} — ${pname(r.platforms[0])}`),
  '',
  `+ ${rows.length - 5} more, including everything in cinemas.`,
  `Every platform on one page. No app, no login, updated every Friday.`,
  '',
  `🔗 ${SITE} (link in bio)`,
  '',
  // Broad tags get you nothing at this follower count; specific ones are where
  // a small account actually surfaces. Kept to a dozen for the same reason.
  '#NewOnOTT #OTTReleases #WhatToWatch #OTTIndia #NewReleases',
  '#Netflix #PrimeVideo #JioHotstar #Bollywood #TamilCinema #TeluguCinema #Malayalam',
  '',
].join('\n');

// Short on purpose: long messages do not get forwarded.
const whatsapp = [
  `*Out this week* — ${range}`,
  '',
  ...rows.slice(0, 3).map((r) => `• ${r.title} — ${pname(r.platforms[0])}`),
  '',
  `+ ${rows.length - 3} more across ${platformCount} platforms, plus everything in cinemas.`,
  `All on one page 👇`,
  `https://${SITE}`,
  '',
].join('\n');

await writeFile(resolve(OUT, 'caption.txt'), caption);
await writeFile(resolve(OUT, 'whatsapp.txt'), whatsapp);

console.log(`\nPosters for ${range}: ${rows.length} releases, ${platformCount} platforms`);
console.log(`Leading with: ${named.slice(0, 3).join(', ')}`);
console.log(`\nsocial/ — instagram-4x5.png, whatsapp-1x1.png, story-9x16.png, caption.txt, whatsapp.txt`);
