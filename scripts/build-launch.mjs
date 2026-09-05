#!/usr/bin/env node
/**
 * The launch creative: profile picture and the first post.
 *
 * A reveal for a utility has one job — make someone feel the problem, then hand
 * them the relief. So this is a three-slide carousel rather than a single
 * image: a carousel earns dwell time, and dwell time is what the feed rewards,
 * but more importantly a problem and its answer cannot land in the same frame.
 * You need the turn.
 *
 *   1  the wall of apps, and the admission that it still tells you nothing
 *   2  the turn — one page
 *   3  the address
 *
 * Deliberately carries no titles from any particular week. A launch post gets
 * screenshotted, re-shared and found weeks later, and a reveal that names
 * September's releases is stale by October. The weekly posters (npm run social)
 * are where the actual content goes.
 *
 * Run once: npm run launch
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
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

// The real registry, so the wall of apps on slide one is the coverage the site
// actually has rather than a list of impressive logos it does not carry.
const registry = await readFile(resolve(ROOT, 'src/data/platforms.ts'), 'utf8');
/**
 * India only, and the count is read rather than written.
 *
 * The first draft listed all eighteen platforms in the registry — including the
 * US-only ones — under a headline that said "nine". The largest text on the
 * slide contradicted the picture beside it, which is the one mistake a launch
 * post cannot make. The audience is Indian, so the wall is what an Indian
 * viewer actually juggles, and the number in the headline counts that same
 * list.
 */
const rowsRe = /\{\s*id:\s*'([^']+)',\s*name:\s*'([^']+)'[\s\S]*?regions:\s*\[([^\]]*)\]/g;
const allRows = [...registry.matchAll(rowsRe)];
const nameById = new Map(allRows.map(([, id, name]) => [id, name]));

/**
 * The wall is a hook, not an inventory.
 *
 * Listing every platform the site covers put twelve chips on the slide under a
 * headline reading "twelve apps" — accurate, and nobody believes it. Nobody
 * pictures themselves juggling twelve subscriptions, so the reader does not
 * recognise their own problem and the slide stops working.
 *
 * Six is the number people see themselves in. These are the six an Indian
 * viewer most likely actually pays for, plus cinemas — which earns its place
 * because it is the other thing you have to check separately, and no
 * OTT-only competitor can show it.
 *
 * Ids rather than strings, resolved through the registry, so a rename in the
 * app reaches the poster and a typo here fails loudly instead of printing a
 * platform that does not exist.
 */
const FEATURED = ['netflix', 'prime', 'jiohotstar', 'appletv', 'sonyliv', 'zee5', 'theatres'];
const wall = FEATURED.map((id) => {
  const name = nameById.get(id);
  if (!name) throw new Error(`Launch slide names '${id}', which is not in the platform registry.`);
  return name;
});

/** The headline counts apps; cinemas is not one, and is the extra beat. */
const appCount = FEATURED.filter((id) => id !== 'theatres').length;
const WORDS = ['zero','one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve'];
const countWord = WORDS[appCount] ?? String(appCount);
const Count = countWord[0].toUpperCase() + countWord.slice(1);

/** Everything the site actually carries, for the caption's reveal. */
const covered = allRows
  .filter(([, , name, regions]) => regions.includes("'IN'") && !/theatre/i.test(name))
  .map(([, , name]) => name);
const coveredWord = WORDS[covered.length] ?? String(covered.length);

const FONTS = `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">`;

const SHELL = (body, extra = '') => `<!doctype html><meta charset="utf-8">
${FONTS}
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body {
    width:1080px; height:1350px; position:relative; overflow:hidden;
    background:#06070a; color:#f2f4f9; font-family:Inter,system-ui,sans-serif;
    display:flex; flex-direction:column; padding:88px 76px;
  }
  body::before, body::after {
    content:''; position:absolute; width:1100px; height:1100px; border-radius:50%; pointer-events:none;
  }
  body::before { top:-700px; left:-320px; background:radial-gradient(circle, rgba(255,61,61,.34), transparent 62%); }
  body::after  { bottom:-760px; right:-340px; background:radial-gradient(circle, rgba(126,78,255,.26), transparent 64%); }
  /**
   * Warm the whole way across, with no blue stop.
   *
   * The first version ran red → gold → blue, which is the site's full accent
   * range and works across a wide element. Clipped to text it does not: over a
   * short word the midpoint lands mid-letter and desaturates, so "one page"
   * rendered with a beige "pa" and a grey "g" and read as a rendering fault
   * rather than a colour choice. On the reveal slide it was worse — the URL's
   * ".in" faded to pale grey, dimming the one string the entire carousel
   * exists to deliver.
   *
   * Red to gold has no muddy midpoint at any length, and it is the same ramp
   * as the play mark, so the wordmark and the words agree.
   */
  .grad { background:linear-gradient(100deg,#ff4d4d,#ff7a3d 42%,#ffb03a);
          -webkit-background-clip:text; -webkit-text-fill-color:transparent; }
  .swipe { position:absolute; bottom:54px; right:76px; font-size:23px; font-weight:600; color:#6a7080; }
  ${extra}
</style>
${body}`;

/* ---------------------------------------------------------------- slide 1 --
   The problem, shown rather than described. Nine platform names filling most
   of the frame is the feeling of the problem; the line underneath only has to
   name it. */
const slide1 = SHELL(
  `<div class="wall">${wall.map((n) => `<span>${esc(n)}</span>`).join('')}</div>
<h1><em class="grad">${Count}</em> apps.<br>Still no idea<br>what's on this week.</h1>
<span class="swipe">Swipe →</span>`,
  /* The chips are the setup and the headline is the punchline, so they have to
     read as one block. Centring the wall in the leftover space put roughly 300
     empty pixels between them and the joke stopped landing — the chips looked
     like decoration floating in the middle of the slide. Bottom-aligned, they
     sit directly above the line they set up, and the empty space collects at
     the top where the glow already lives. */
  `.wall { position:relative; display:flex; flex-wrap:wrap; align-content:flex-end;
            gap:18px 18px; flex:1 1 auto; max-width:930px; padding-bottom:64px; }
   .wall span { padding:16px 28px; border-radius:999px; border:1px solid rgba(255,255,255,.10);
                background:rgba(255,255,255,.03); color:#5d636f;
                font-size:37px; font-weight:600; letter-spacing:-.015em; }
   h1 { position:relative; flex:none; font-size:84px; line-height:1.08;
        font-weight:900; letter-spacing:-.045em; }
   h1 em { font-style:normal; }`,
);

/* ---------------------------------------------------------------- slide 2 --
   The turn. One idea, as large as it will go, because this is the sentence the
   whole product has to be reducible to. */
const slide2 = SHELL(
  `<h1>So we put<br>every release<br>on <em class="grad">one page</em>.</h1>
<p>Every streaming platform. Everything opening in cinemas. Sorted by what people are actually talking about.</p>
<span class="swipe">Swipe →</span>`,
  `h1 { position:relative; margin-top:auto; font-size:96px; line-height:1.04; font-weight:900; letter-spacing:-.05em; }
   h1 em { font-style:normal; }
   p { position:relative; margin-top:36px; margin-bottom:auto; max-width:820px;
       font-size:34px; line-height:1.45; font-weight:500; color:#b6bdcc; }`,
);

/* ---------------------------------------------------------------- slide 3 --
   The address, and the three objections killed before they form. This slide is
   the one that gets screenshotted, so the URL is the largest thing on it. */
const slide3 = SHELL(
  `<div class="lock">
     <span class="mark"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></span>
     <span class="brand">${esc(BRAND)}</span>
   </div>
   <div class="url grad">${esc(SITE)}</div>
   <div class="rules">
     <div><b>No app.</b> It's a web page.</div>
     <div><b>No login.</b> Nothing to sign up for.</div>
     <div><b>Every Friday.</b> Updated before the drops land.</div>
   </div>
   <div class="free">Free. Always.</div>`,
  `.lock { position:relative; display:flex; align-items:center; gap:18px; margin-bottom:auto; }
   .mark { width:66px; height:66px; border-radius:19px; display:grid; place-items:center;
           background:linear-gradient(135deg,#ff4d4d,#ffb03a); }
   .mark svg { width:28px; height:28px; fill:#fff; }
   .brand { font-size:44px; font-weight:700; letter-spacing:-.025em; }
   .url { position:relative; font-size:104px; font-weight:900; letter-spacing:-.05em; line-height:1; }
   .rules { position:relative; margin-top:52px; margin-bottom:auto;
            font-size:33px; line-height:1.85; font-weight:500; color:#8d94a4; }
   .rules b { color:#f2f4f9; font-weight:700; }
   .free { position:relative; font-size:29px; font-weight:600; color:#6a7080; }`,
);

/* ----------------------------------------------------------------- avatar --
   Instagram crops the profile picture to a circle and renders it at about 32px
   in a feed, so the wordmark is unreadable there and only the mark survives.
   The gradient runs to the edges for the same reason: a rounded square inside
   a circular crop loses its corners and reads as a mistake. */
const avatar = `<!doctype html><meta charset="utf-8">
<style>
  * { margin:0; box-sizing:border-box; }
  body { width:640px; height:640px; display:grid; place-items:center;
         background:linear-gradient(135deg,#ff4d4d 8%,#ff7a3d 48%,#ffb03a); }
  svg { width:272px; height:272px; fill:#fff; filter:drop-shadow(0 8px 26px rgba(0,0,0,.22)); }
</style>
<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>`;

await mkdir(OUT, { recursive: true });
const browser = await launchChromium('launch');
try {
  const shots = [
    ['launch-1-problem', slide1, 1080, 1350],
    ['launch-2-solution', slide2, 1080, 1350],
    ['launch-3-reveal', slide3, 1080, 1350],
    ['avatar', avatar, 640, 640],
  ];
  for (const [name, html, w, h] of shots) {
    const p = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    await p.setContent(html, { waitUntil: 'networkidle' });
    await p.evaluate(() => document.fonts.ready);
    await writeFile(resolve(OUT, `${name}.png`), await p.screenshot({ type: 'png' }));
    await p.close();
    console.log(`  ${name}.png  ${w}x${h}`);
  }
} finally {
  await browser.close();
}

/**
 * The caption, built from the same list as the slide.
 *
 * The first draft hardcoded "nine streaming apps" while the image beside it
 * said twelve — the same contradiction that was just fixed on the slide,
 * surviving one file over because the number was typed in two places. Both now
 * come from the registry.
 *
 * The opening line repeats the slide deliberately: only about 125 characters
 * show before Instagram truncates to "…more", so the hook has to be the whole
 * first sentence, and matching the image makes the post read as one thought
 * rather than two.
 */
const caption = `${Count} apps. Still no idea what's on this week.

So we built the thing that should already exist: every new release across ${coveredWord} platforms — ${covered.join(', ')} — plus everything opening in cinemas, on one page.

No app to install. No login. No algorithm deciding what you see. Just the week, sorted by what people are actually talking about, updated every Friday before the drops land.

Free, and staying that way.

🔗 ${SITE} — link in bio

#NewOnOTT #OTTIndia #OTTReleases #WhatToWatch #NewReleases #StreamingIndia
#Netflix #PrimeVideo #JioHotstar #Bollywood #TamilCinema #TeluguCinema #MalayalamCinema
`;
await writeFile(resolve(OUT, 'launch-caption.txt'), caption);

console.log('\nLaunch set written to social/ — 3 carousel slides, avatar, caption.');
