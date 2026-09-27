#!/usr/bin/env node
/**
 * Three more posts a week, with their numbers read rather than typed.
 *
 * The account needs three posts a week and only one asset could supply them:
 * the weekly poster, which rebuilds from the feed every Friday. Everything else
 * in social/ is fixed creative that gets used up — two weeks of stock, then one
 * post a week.
 *
 * The obvious fix was to recycle the product-screenshot posts, since the
 * screenshot is of a live page and refreshes itself. That was wrong, and it is
 * the reason this file exists. Their captions are prose in build-feature.mjs
 * with the figures typed into them, so the picture updated and the words did
 * not:
 *
 *   post-south claims   70 South releases, 64 theatre-only, Tamil 27
 *   the feed says       96 South releases, 79 theatre-only, Tamil 36
 *
 * Publishing a wrong number about our own catalogue, in our own voice, costs
 * more than posting less often — so those are held back, and these replace
 * them. Every figure below is computed from the same rows the image lists. The
 * copy cannot drift from the picture because neither is written down.
 *
 * Three angles, chosen because each answers a different question and each one's
 * answer genuinely changes week to week:
 *
 *   south     the biggest under-served audience on the site, and the one the
 *             catalogue work this month was all about
 *   cinemas   what is NOT on streaming yet, which is the single most common
 *             thing people get wrong — a reader complained about exactly this,
 *             having seen a platform badge on a film that had not landed
 *   landed    what actually became watchable at home this week, which is the
 *             question the site exists to answer
 *
 * Usage: npm run angles
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChromium } from './browser.mjs';
import { card, esc } from './social-card.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'social');
const SITE = (process.env.SITE_URL ?? 'https://newonott.in').replace(/^https?:\/\//, '').replace(/\/$/, '');
const REGION = (process.env.REGIONS ?? 'IN').split(',')[0].trim() || 'IN';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY = 86_400_000;

const feed = JSON.parse(await readFile(resolve(ROOT, 'public/data/releases.json'), 'utf8'));

const registry = await readFile(resolve(ROOT, 'src/data/platforms.ts'), 'utf8');
const platforms = new Map(
  [...registry.matchAll(/\{\s*id:\s*'([^']+)',\s*name:\s*'([^']+)'[\s\S]*?accent:\s*'([^']+)'/g)].map(
    ([, id, name, accent]) => [id, { name, accent }],
  ),
);
const pname = (id) => platforms.get(id)?.name ?? id;
const paccent = (id) => platforms.get(id)?.accent ?? '#8d94a4';

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
  console.error('No stocked week in the feed — nothing to post. Nothing has been written.');
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

const SOUTH = { ta: 'Tamil', te: 'Telugu', ml: 'Malayalam', kn: 'Kannada' };
const isSouth = (r) => (r.languages ?? []).some((l) => SOUTH[l]);
const onlyCinema = (r) => (r.platforms ?? []).length === 1 && r.platforms[0] === 'theatres';
const streaming = (r) => (r.platforms ?? []).some((p) => p !== 'theatres');

/** "Tamil 36, Telugu 27" — built from the rows, never from memory. */
const breakdown = (list) => {
  const per = new Map();
  for (const r of list) for (const l of r.languages ?? []) if (SOUTH[l]) per.set(l, (per.get(l) ?? 0) + 1);
  return [...per.entries()]
    .sort((x, y) => y[1] - x[1])
    .map(([l, n]) => `${SOUTH[l]} ${n}`)
    .join(', ');
};

const HASHTAGS = [
  '#NewOnOTT #OTTIndia #OTTReleases #WhatToWatch #KyaDekhein',
  '#Netflix #PrimeVideo #JioHotstar #TamilCinema #TeluguCinema #MalayalamCinema #Bollywood',
].join('\n');

/** A title and where to watch it, as one line of caption. */
const line = (r) => `• ${r.title} — ${r.platforms?.length ? pname(r.platforms[0]) : 'in cinemas'}`;

const south = rows.filter(isSouth);
const cinema = rows.filter(onlyCinema);
const landed = rows.filter(streaming);

/**
 * Every angle states the arithmetic it is built on, so a reader can check the
 * claim against the list beside it. A post that says "most" where it could say
 * "79 of 96" is choosing to be less useful and less believable at once.
 */
const ANGLES = [
  {
    slug: 'south',
    list: south,
    enough: 4,
    headline: 'South, this<br><em>week</em>.',
    standfirst: () => `${south.length} releases · ${breakdown(south)}`,
    caption: () => {
      const stuck = south.filter(onlyCinema).length;
      return [
        `South ka poora hafta — ${range}`,
        '',
        ...south.slice(0, 6).map(line),
        south.length > 6 ? `+ ${south.length - 6} more.` : null,
        '',
        `${breakdown(south)} — sab ek page pe, har platform se, theatres ke saath.`,
        stuck
          ? `${stuck} of these ${south.length} are still only in theatres, so if you only watch OTT you are missing most of them.`
          : `All ${south.length} are streaming somewhere.`,
        '',
        `🔗 ${SITE}/south — link in bio`,
        '',
        'Tumhari language kaunsi? 👇',
        '',
        HASHTAGS,
      ]
        .filter((l) => l !== null)
        .join('\n');
    },
  },
  {
    slug: 'cinemas',
    list: cinema,
    enough: 4,
    headline: 'Not on OTT<br><em>yet</em>.',
    standfirst: () => `${cinema.length} of ${rows.length} this week are cinema-only`,
    caption: () =>
      [
        `Abhi tak kisi OTT pe nahi — ${range}`,
        '',
        ...cinema.slice(0, 6).map((r) => `• ${r.title}`),
        cinema.length > 6 ? `+ ${cinema.length - 6} more.` : null,
        '',
        `${cinema.length} of this week's ${rows.length} releases are in theatres only. Har hafte log inhe OTT pe dhoondte hain aur milta kuch nahi.`,
        'Jis din koi OTT pe aayegi, page apne aap update ho jaayega — aur date wahin dikhegi.',
        '',
        `🔗 ${SITE} — link in bio`,
        '',
        'Inme se kaunsi ka wait kar rahe ho? 👇',
        '',
        HASHTAGS,
      ]
        .filter((l) => l !== null)
        .join('\n'),
  },
  {
    slug: 'landed',
    list: landed,
    enough: 4,
    headline: 'Streaming<br><em>now</em>.',
    standfirst: () => `${landed.length} landed on ${new Set(landed.flatMap((r) => r.platforms)).size} platforms`,
    caption: () =>
      [
        `Ye sab ab ghar pe dekh sakte ho — ${range}`,
        '',
        ...landed.slice(0, 6).map(line),
        landed.length > 6 ? `+ ${landed.length - 6} more.` : null,
        '',
        'Har platform ek hi page pe. No app, no login, har Friday update.',
        '',
        `🔗 ${SITE} — link in bio`,
        '',
        'Aaj raat kya dekh rahe ho? 👇',
        '',
        HASHTAGS,
      ]
        .filter((l) => l !== null)
        .join('\n'),
  },
];

/* Instagram's tallest feed crop, which is the only one these are for — the
   weekly poster already covers stories and WhatsApp. */
const SIZE = { name: 'angle', w: 1080, h: 1350, items: 8, title: 40, head: 92 };

await mkdir(OUT, { recursive: true });
const browser = await launchChromium('angles');
const made = [];
try {
  for (const angle of ANGLES) {
    /*
     * A thin week is a real week, and a post listing two titles under a
     * headline promising a roundup looks like a broken build. Skipped with a
     * reason rather than published thin — the planner simply has one fewer
     * option, which it already handles.
     */
    if (angle.list.length < angle.enough) {
      console.log(`  · ${angle.slug}: only ${angle.list.length} this week, skipped`);
      continue;
    }

    const list = angle.list.slice(0, SIZE.items);
    const rest = angle.list.length - list.length;
    const html = card({
      size: SIZE,
      kicker: range,
      headline: angle.headline,
      standfirst: angle.standfirst(),
      rows: list.map((r) => ({
        label: r.title,
        note: r.platforms?.length ? pname(r.platforms[0]) : 'In cinemas',
        accent: paccent(r.platforms?.[0] ?? 'theatres'),
      })),
      more: rest > 0 ? `+ ${rest} more on the site` : '',
      footnote: 'Every Friday. No app, no login.',
      site: SITE,
    });

    const p = await browser.newPage({ viewport: { width: SIZE.w, height: SIZE.h }, deviceScaleFactor: 1 });
    await p.setContent(html, { waitUntil: 'networkidle' });
    // Webfonts can resolve after networkidle; without this the card renders in
    // the fallback face about one run in five.
    await p.evaluate(() => document.fonts.ready);
    await writeFile(resolve(OUT, `angle-${angle.slug}.png`), await p.screenshot({ type: 'png' }));
    await writeFile(resolve(OUT, `angle-${angle.slug}-caption.txt`), `${angle.caption()}\n`);
    await p.close();

    made.push({ slug: angle.slug, n: angle.list.length });
    console.log(`  angle-${angle.slug}.png  ${SIZE.w}x${SIZE.h}  ${angle.list.length} titles`);
  }
} finally {
  await browser.close();
}

console.log(`\n${made.length} angle(s) for ${range}, every figure computed from the feed.`);
if (!made.length) {
  console.log('Nothing had enough titles this week. That is a quiet week, not an error.');
}
