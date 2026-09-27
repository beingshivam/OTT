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
import { card, SIZES } from './social-card.mjs';

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

function page({ w, h, items, title, head, name }) {
  const list = rows.slice(0, items);
  const rest = rows.length - list.length;
  return card({
    size: { w, h, items, title, head, name },
    kicker: range,
    headline: "Out this<br><em>week</em>.",
    standfirst: `${rows.length} releases · ${platformCount} platforms · one page`,
    rows: list.map((r) => ({ label: r.title, note: pname(r.platforms[0]), accent: paccent(r.platforms[0]) })),
    more: rest > 0 ? `+ ${rest} more, including everything in cinemas` : "",
    footnote: "Every Friday. No app, no login.",
    site: SITE,
  });
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
