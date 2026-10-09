#!/usr/bin/env node
/**
 * The week's releases as the artwork, not as a list.
 *
 * `npm run social` already builds a weekly poster and it is typographic — a
 * tidy list of titles, platform chips, the address. It reads well and it asks
 * somebody to read. Asked for a poster-led post instead, and the reason is
 * sound: on a feed, a wall of film artwork is recognised before a single word
 * is, and recognition is the only thing competing with a thumb.
 *
 * So this is the same week, led by the posters. One hero — the biggest title
 * of the week — and a grid of the rest, each with the one fact that decides
 * whether somebody cares: the day, and where.
 *
 * Ranked Indian-first, by the same rule as the rails: origin decides when
 * there is any, language fills the silence, and within that the heat score.
 * A post about "this week" that opens on an import is the complaint that
 * produced the rails fix, and it would be the same mistake in a second place.
 *
 * Two crops, because posting one to both looks careless:
 *   4:5  1080x1350  feed
 *   9:16 1080x1920  stories and status
 *
 * Posters are fetched from TMDB at render time. Where one cannot be had the
 * tile falls back to the title on a brand wash rather than a hole — a poster
 * with a gap in the grid is worse than one with a plain tile in it, and this
 * runs in CI where a single slow image should not fail the week's post.
 *
 * Usage: npm run social:posters
 */

import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BRAND, INSTAGRAM } from './brand.mjs';
import { launchChromium } from './browser.mjs';
import { loadRegistry } from './platform-registry.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'social');
const SITE = (process.env.SITE_URL ?? 'https://newonott.in').replace(/^https?:\/\//, '').replace(/\/$/, '');
const REGION = (process.env.REGIONS ?? 'IN').split(',')[0].trim() || 'IN';
const TODAY = process.env.TODAY ?? new Date().toISOString().slice(0, 10);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const dayOf = (iso) => DAYS[new Date(`${iso}T00:00:00Z`).getUTCDay()];
const dateOf = (iso) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`;

const registry = await loadRegistry();
const pname = new Map(registry.map((p) => [p.id, p.name]));
const servesHere = (id) => registry.find((p) => p.id === id)?.regions.includes(REGION);

const feed = JSON.parse(await readFile(resolve(ROOT, 'public/data/releases.json'), 'utf8'));
const week = feed.weeks.find((w) => w.start <= TODAY && TODAY <= w.end);
if (!week) {
  console.error(`No week in the feed contains ${TODAY}. Nothing has been written.`);
  process.exit(1);
}

/**
 * Indian first — the same test the rails use, kept in step deliberately.
 *
 * Origin decides whenever TMDB has any, because a dub is not a provenance: a
 * British action picture with a Hindi track is not what this audience came
 * for, and treating it as local is precisely the bug the rails had.
 */
const INDIAN = new Set(['hi', 'ta', 'te', 'ml', 'kn', 'bn', 'mr', 'pa', 'gu', 'or', 'ur', 'as']);
const local = (r) => (r.origin?.length ? r.origin.includes('IN') : INDIAN.has(r.languages?.[0] ?? ''));
const best = (a, b) => Number(local(b)) - Number(local(a)) || (b.heat ?? 0) - (a.heat ?? 0);

const inRegion = (r) =>
  r.regions?.includes(REGION) && Boolean(r.posterUrl) && r.platforms?.length;

const rows = (week.releases ?? []).filter(inRegion);
const cinema = rows
  .filter((r) => r.platforms.includes('theatres') && !r.platforms.some((p) => p !== 'theatres'))
  .sort(best);
/* Confirmed only. A platform inferred from a note on a release date is an
   announcement, and putting one on a poster that says "streaming now" is the
   claim that sends somebody to a subscription they did not need. */
const streaming = rows
  .filter((r) => !r.namedBy && r.platforms.some((p) => p !== 'theatres' && servesHere(p)))
  .sort(best);

if (!cinema.length && !streaming.length) {
  console.error('The current week has no releases with artwork. Nothing has been written.');
  process.exit(1);
}

/* The hero is whichever side has the week's biggest title, so a quiet cinema
   week leads on a streaming drop rather than on a film nobody is waiting for. */
const hero = [...cinema, ...streaming].sort(best)[0];

/**
 * Both halves get seats, because the post says "cinemas & on OTT".
 *
 * Straight ranking does not deliver that. Cinema outnumbers confirmed
 * streaming 17 to 3 in a normal week here — theatrical dates are announced
 * weeks ahead while a streaming row only becomes confirmed when a provider
 * actually carries it — so by heat alone the grid came out all cinema and the
 * headline promised something the image did not show.
 *
 * So streaming takes up to a third of the tiles if it has them, cinema fills
 * the rest, and whichever side is short gives its seats back rather than
 * leaving a hole. Interleaved so the two read as one week rather than two
 * blocks.
 */
function seats(count) {
  const pool = { cinema: cinema.filter((r) => r.id !== hero.id), ott: streaming.filter((r) => r.id !== hero.id) };
  const wantOtt = Math.min(pool.ott.length, Math.max(1, Math.round(count / 3)));
  const picked = [...pool.ott.slice(0, wantOtt), ...pool.cinema.slice(0, count - wantOtt)];
  /* Short on one side: top up from the other rather than publish a gap. */
  if (picked.length < count) {
    const used = new Set(picked.map((r) => r.id));
    picked.push(...[...pool.cinema, ...pool.ott].filter((r) => !used.has(r.id)).slice(0, count - picked.length));
  }
  return picked.sort(best);
}

const where = (r) =>
  r.platforms.includes('theatres') && !r.platforms.some((p) => p !== 'theatres')
    ? 'In cinemas'
    : (pname.get(r.platforms.find((p) => p !== 'theatres' && servesHere(p))) ?? 'Streaming');

/* An <img>, not a background-image. A background that fails to load leaves
   the element painted over whatever sits behind it, so the fallback title was
   invisible in exactly the case it exists for. An <img> that fails renders
   nothing and the title underneath shows through. */
const art = (r, cls = '') => `
    <div class="art ${cls}">
      <span class="fallback">${esc(r.title)}</span>
      <img src="${esc(r.posterUrl)}" alt="">
    </div>`;

const tile = (r) => `
  <figure class="tile">${art(r)}
    <figcaption>
      <strong>${esc(r.title)}</strong>
      <span>${esc(where(r))} · ${esc(dateOf(r.releaseDate))}</span>
    </figcaption>
  </figure>`;

const page = (size, tiles) => {
  const { w, h, grid, heroH } = size;
  return `<!doctype html><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800;900&display=swap" rel="stylesheet">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{width:${w}px;height:${h}px;position:relative;overflow:hidden;
       background:#06070a;color:#f2f4f9;font-family:Inter,system-ui,sans-serif;
       display:flex;flex-direction:column;padding:64px 56px;gap:30px}
  /* The same two-corner wash as every other image this project makes, so a
     forwarded screenshot and the page it points at read as one product. */
  body::before,body::after{content:'';position:absolute;width:1100px;height:1100px;border-radius:50%;pointer-events:none}
  body::before{top:-760px;left:-340px;background:radial-gradient(circle,rgba(255,61,61,.30),transparent 62%)}
  body::after{bottom:-800px;right:-360px;background:radial-gradient(circle,rgba(126,78,255,.22),transparent 64%)}

  .top{position:relative;display:flex;align-items:center;gap:15px;flex:none}
  .mark{width:46px;height:46px;border-radius:14px;display:grid;place-items:center;
        background:linear-gradient(135deg,#ff4d4d,#ffb03a);font-weight:900;font-size:23px;color:#fff}
  .brand{font-size:29px;font-weight:700;letter-spacing:-.022em}
  .kicker{margin-left:auto;font-size:21px;font-weight:700;letter-spacing:.13em;color:#ffb03a;text-transform:uppercase}

  h1{position:relative;font-size:${size.h1}px;font-weight:900;letter-spacing:-.035em;line-height:.97;flex:none}
  .foot{flex:none}
  h1 em{font-style:normal;color:#ffb03a}

  .hero{position:relative;display:flex;gap:30px;align-items:stretch;flex:none;height:${heroH}px}
  .hero .fallback{font-size:26px}
  .hero .art{width:${Math.round(heroH / 1.5)}px;flex:none;aspect-ratio:auto;height:${heroH}px}
  .hero .meta{display:flex;flex-direction:column;justify-content:flex-end;gap:14px;padding-bottom:6px;min-width:0}
  .hero .tag{font-size:20px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:#ff6b6b}
  .hero h2{font-size:${size.h2}px;font-weight:900;letter-spacing:-.03em;line-height:1.02}
  .hero p{font-size:26px;font-weight:600;color:#b9c0d0}

  /* The grid takes whatever height is left and divides it, rather than being
     sized by arithmetic that has to be redone every time a row is added. The
     first version computed tile heights from an aspect ratio and overflowed
     the frame by a row; posters crop under object-fit, so letting the box
     decide is both simpler and impossible to get wrong. */
  .grid{position:relative;display:grid;grid-template-columns:repeat(${grid},1fr);
        grid-auto-rows:1fr;gap:22px;flex:1 1 auto;min-height:0}
  .tile{display:flex;flex-direction:column;gap:10px;min-width:0;min-height:0}
  .art{position:relative;flex:1 1 auto;min-height:0;border-radius:18px;overflow:hidden;
       background:linear-gradient(160deg,#1b2033,#10131f);
       box-shadow:0 18px 40px rgba(0,0,0,.45)}
  .art img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block}
  /* Underneath the image, so it shows only where the artwork did not arrive.
     A gap in a poster grid reads as a broken post; a titled tile does not. */
  .fallback{position:absolute;inset:0;display:grid;place-items:center;padding:16px;text-align:center;
            font-size:22px;font-weight:800;color:#7e879c;line-height:1.2}
  figcaption{display:flex;flex-direction:column;gap:2px;min-width:0;flex:none}
  figcaption strong{font-size:22px;font-weight:700;letter-spacing:-.01em;
                    white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  figcaption span{font-size:18px;font-weight:600;color:#9aa3b6;
                  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

  .foot{position:relative;margin-top:auto;display:flex;align-items:baseline;gap:14px;flex:none}
  .foot .url{font-size:30px;font-weight:800;letter-spacing:-.02em}
  .foot .say{font-size:22px;font-weight:600;color:#9aa3b6}
</style>
<div class="top">
  <div class="mark">N</div><div class="brand">${esc(BRAND)}</div>
  <div class="kicker">${esc(dateOf(week.start))} – ${esc(dateOf(week.end))}</div>
</div>
<h1>Out this week<br><em>in cinemas &amp; on OTT</em></h1>
<div class="hero">
  ${art(hero)}
  <div class="meta">
    <div class="tag">Biggest this week</div>
    <h2>${esc(hero.title)}</h2>
    <p>${esc(where(hero))} · ${esc(dayOf(hero.releaseDate))} ${esc(dateOf(hero.releaseDate))}</p>
  </div>
</div>
<div class="grid">${tiles.map(tile).join('')}</div>
<div class="foot"><span class="url">${esc(SITE)}</span><span class="say">every platform, one page</span></div>
`;
};

const SIZES = [
  { name: 'week-posters', w: 1080, h: 1350, grid: 3, heroH: 300, h1: 56, h2: 46, take: 6 },
  { name: 'week-posters-story', w: 1080, h: 1920, grid: 3, heroH: 430, h1: 70, h2: 56, take: 9 },
];

await mkdir(OUT, { recursive: true });
const browser = await launchChromium('week-posters');
try {
  for (const size of SIZES) {
    const tiles = seats(size.take);
    const p = await browser.newPage({
      viewport: { width: size.w, height: size.h },
      deviceScaleFactor: 1,
    });
    await p.setContent(page(size, tiles), { waitUntil: 'networkidle' });
    /* The grid is background-image, which `networkidle` does not wait for on
       its own. Resolved rather than awaited forever: in CI one slow poster
       must not hold the week's post, and the tile behind it already says the
       title. */
    await p.evaluate(
      () =>
        new Promise((done) => {
          const imgs = [...document.images].filter((i) => !i.complete);
          let left = imgs.length;
          if (!left) return done();
          const tick = () => --left <= 0 && done();
          for (const i of imgs) {
            i.addEventListener('load', tick, { once: true });
            i.addEventListener('error', tick, { once: true });
          }
          setTimeout(done, 8000);
        }),
    );
    await writeFile(resolve(OUT, `${size.name}.png`), await p.screenshot({ type: 'png' }));
    await writeFile(
      resolve(OUT, `${size.name}.jpg`),
      await p.screenshot({ type: 'jpeg', quality: 92 }),
    );
    await p.close();
    console.log(`  ${size.name}.png / .jpg   ${size.w}x${size.h}  (hero + ${tiles.length})`);
  }
} finally {
  await browser.close();
}

/*
 * The caption names what is on the image and nothing it cannot support.
 *
 * Counts come from the feed rather than being typed, because a figure typed
 * once goes stale on the next refresh and then the post is lying — the same
 * reason build-feature.mjs is still held out of the posting rotation.
 */
const langs = [...new Set([hero, ...seats(6)].map((r) => r.languages?.[0]).filter(Boolean))];
const LANG_NAME = { hi: 'Hindi', ta: 'Tamil', te: 'Telugu', ml: 'Malayalam', kn: 'Kannada', bn: 'Bengali', mr: 'Marathi', pa: 'Punjabi', en: 'English' };
const caption = `${dateOf(week.start)} – ${dateOf(week.end)} — everything worth knowing about this week. 🎬

${hero.title} is the big one: ${where(hero).toLowerCase()} ${dayOf(hero.releaseDate)} ${dateOf(hero.releaseDate)}.

${cinema.length} in cinemas, ${streaming.length} landing on OTT, across ${langs.map((l) => LANG_NAME[l] ?? l).join(', ')}.

Full list with dates, platforms and where to watch each one — ${SITE}. Updated every single day, so the OTT date appears the day it is announced.

🔗 link in bio

Which one are you watching first? 👇

#NewOnOTT #OTTIndia #OTTReleases #WhatToWatch #KyaDekhein #ThisWeekOnOTT
#NewReleases #IndianCinema #MoviesThisWeek #OTTUpdate #${(INSTAGRAM ?? 'newonott').replace(/[^A-Za-z0-9]/g, '')}
`;
await writeFile(resolve(OUT, 'week-posters-caption.txt'), caption);

console.log(`\n  Week ${week.start} – ${week.end}`);
console.log(`  Hero: ${hero.title} (${where(hero)}, ${hero.releaseDate})`);
console.log(`  ${cinema.length} in cinemas, ${streaming.length} confirmed on OTT`);
console.log(`  social/week-posters-caption.txt`);
