#!/usr/bin/env node
/**
 * One post about one title, built from what the site already knows about it.
 *
 * The weekly angles cover the week. This covers the moment a single film is
 * the thing everyone is typing into a search box — a sequel landing, a finale
 * opening — which is when the account has the most to gain and the most to get
 * wrong.
 *
 * It leads with the franchise rather than the film, because that is the
 * question people actually have. "Drishyam: The Conclusion" opened in cinemas
 * today, and the Malayalam "Drishyam 3" has been on Prime since May: two
 * different films, one name, and nobody can tell which is which from a search
 * result. A list of every film in the series with where each one streams
 * answers in one image what six tabs would not.
 *
 * WHAT IT REFUSES TO SAY. A post about a cinema release is one phrasing away
 * from claiming the film is streaming, and that is the complaint this site
 * has already had from a reader once. So:
 *
 *   - the status line comes from the platforms on the row, never from a
 *     template, and a theatrical-only title is labelled "in cinemas";
 *   - no OTT date is predicted. The window tracker has three observations,
 *     all South Indian, against its own threshold of five for a range — so
 *     there is no honest Hindi forecast to make and none is made;
 *   - a rating is only printed above the same vote floor the site uses to
 *     grey one out, so the post cannot be more confident than the page.
 *
 * Usage: npm run post:title -- drishyam-the-conclusion
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChromium } from './browser.mjs';
import { card } from './social-card.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'social');
const SITE = (process.env.SITE_URL ?? 'https://newonott.in').replace(/^https?:\/\//, '').replace(/\/$/, '');

/** Mirrors lib/score.ts. Below this a score is noise and the site greys it. */
const TMDB_MIN_VOTES = 50;

const slugify = (s) =>
  String(s).toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-');

const wanted = process.argv.slice(2).filter((a) => !a.startsWith('--'))[0];
if (!wanted) {
  console.error('Usage: npm run post:title -- <slug>\nNothing has been written.');
  process.exit(1);
}

const registry = await readFile(resolve(ROOT, 'src/data/platforms.ts'), 'utf8');
const platforms = new Map(
  [...registry.matchAll(/\{\s*id:\s*'([^']+)',\s*name:\s*'([^']+)'[\s\S]*?accent:\s*'([^']+)'/g)].map(
    ([, id, name, accent]) => [id, { name, accent }],
  ),
);
const pname = (id) => platforms.get(id)?.name ?? id;
const paccent = (id) => platforms.get(id)?.accent ?? '#8d94a4';

/* The archive rather than the feed: it holds the back catalogue too, which is
   where the earlier films in a series live once their week has rolled by. */
const archive = JSON.parse(await readFile(resolve(ROOT, 'data/archive.json'), 'utf8'));
const rows = archive.titles ?? archive.releases ?? archive;

const subject = rows.find((r) => slugify(r.title) === wanted || slugify(r.title).startsWith(wanted));
if (!subject) {
  console.error(`No title matching "${wanted}" in the archive. Nothing has been written.`);
  process.exit(1);
}

/**
 * The rest of the series.
 *
 * Matched on the first word of the title, which is crude and right for the
 * shape of Indian franchise naming — Drishyam, Drishyam 2, Drishyam 3,
 * Drishyam: The Conclusion all share it. Sorted oldest first so the image
 * reads as a timeline and the newest thing is the one at the bottom, next to
 * the line about where it is.
 */
const stem = subject.title.split(/[\s:]+/)[0].toLowerCase();
const family = rows
  .filter((r) => r.title.split(/[\s:]+/)[0].toLowerCase() === stem)
  .filter((r) => r.releaseDate)
  .sort((a, b) => String(a.releaseDate).localeCompare(String(b.releaseDate)));

/* Where a film is, in the words the row supports. A title with no streaming
   platform is in cinemas, and must never be described any other way. */
const whereFor = (r) => {
  const streaming = (r.platforms ?? []).filter((p) => p !== 'theatres');
  if (streaming.length) return { label: pname(streaming[0]), accent: paccent(streaming[0]) };
  return { label: 'In cinemas', accent: paccent('theatres') };
};

const streamingNow = family.filter((r) => (r.platforms ?? []).some((p) => p !== 'theatres'));
const subjectStreaming = (subject.platforms ?? []).some((p) => p !== 'theatres');

/* Every earlier film on one service is a fact worth printing and is not a
   forecast. Computed, so it is simply absent when it is not true. */
const everyEarlierOn = (() => {
  const earlier = family.filter((r) => r.id !== subject.id && (r.platforms ?? []).some((p) => p !== 'theatres'));
  if (earlier.length < 2) return null;
  const sets = earlier.map((r) => new Set((r.platforms ?? []).filter((p) => p !== 'theatres')));
  const shared = [...sets[0]].filter((p) => sets.every((s) => s.has(p)));
  return shared.length ? { id: shared[0], count: earlier.length } : null;
})();

const SIZE = { name: 'title-post', w: 1080, h: 1350, items: 8, title: 40, head: 92 };
const lang = (subject.languages ?? [])[0];
const LANG_NAMES = { hi: 'Hindi', ml: 'Malayalam', ta: 'Tamil', te: 'Telugu', kn: 'Kannada', en: 'English' };

const headline = subjectStreaming
  ? `${subject.title.split(/[\s:]+/)[0]} is<br><em>streaming</em>.`
  : `${subject.title.split(/[\s:]+/)[0]} is<br><em>in cinemas</em>.`;

const standfirst = subjectStreaming
  ? `${whereFor(subject).label} · the whole series, one page`
  : `Out ${new Date(subject.releaseDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} · not on any OTT platform yet`;

const list = family.slice(-SIZE.items).map((r) => {
  const w = whereFor(r);
  const yr = String(r.releaseDate).slice(0, 4);
  const l = (r.languages ?? [])[0];
  return {
    label: `${r.title}${l && l !== lang ? ` (${LANG_NAMES[l] ?? l})` : ''} · ${yr}`,
    note: w.label,
    accent: w.accent,
  };
});

await mkdir(OUT, { recursive: true });
const browser = await launchChromium('title-post');
const slug = slugify(subject.title);
try {
  const html = card({
    size: SIZE,
    kicker: 'Where to watch',
    headline,
    standfirst,
    rows: list,
    more: '',
    footnote: 'Updated the day it lands. No app, no login.',
    site: SITE,
  });
  const p = await browser.newPage({ viewport: { width: SIZE.w, height: SIZE.h }, deviceScaleFactor: 1 });
  await p.setContent(html, { waitUntil: 'networkidle' });
  await p.evaluate(() => document.fonts.ready);
  await writeFile(resolve(OUT, `title-${slug}.png`), await p.screenshot({ type: 'png' }));
  /* Instagram's publishing API rejects PNG. */
  await writeFile(resolve(OUT, `title-${slug}.jpg`), await p.screenshot({ type: 'jpeg', quality: 92 }));
  await p.close();
} finally {
  await browser.close();
}

/* The caption. Every claim below is read off the rows above it. */
const langName = LANG_NAMES[lang] ?? lang;
const others = streamingNow
  .filter((r) => r.id !== subject.id)
  .map((r) => `• ${r.title} (${String(r.releaseDate).slice(0, 4)}) — ${whereFor(r).label}`);

const caption = [
  subjectStreaming
    ? `${subject.title} ab stream ho rahi hai.`
    : `${subject.title} aaj cinemas mein hai — OTT pe nahi.`,
  '',
  subjectStreaming
    ? `Dekh lo ${whereFor(subject).label} pe.`
    : `Har hafte log poochhte hain "OTT pe kab aayegi". Abhi tak kisi platform ne date announce nahi ki — aur jis din karega, page apne aap update ho jaayega.`,
  '',
  'Poori series kahan hai:',
  /*
   * Every service, not just the first.
   *
   * The card names one because it has 1080 pixels and a row to fit it in. A
   * caption has no such excuse, and the abbreviation reads as a contradiction
   * the moment the line below says all the earlier films share a service: a
   * list showing JioHotstar, MX Player, MX Player followed by "all four are on
   * Prime" looks wrong even though both are true. Two true statements that
   * appear to disagree cost more trust than the longer line costs attention.
   */
  ...family.map((r) => {
    const l = (r.languages ?? [])[0];
    const tag = l && l !== lang ? ` (${LANG_NAMES[l] ?? l})` : '';
    const on = (r.platforms ?? []).filter((p) => p !== 'theatres');
    const where = on.length ? on.map(pname).join(' / ') : 'In cinemas';
    return `• ${r.title}${tag} ${String(r.releaseDate).slice(0, 4)} — ${where}`;
  }),
  '',
  /* The one genuinely surprising fact in the set, and the reason the post
     exists: two films, one name, different answers. */
  streamingNow.length && !subjectStreaming
    ? `Dhyaan se — ${streamingNow[streamingNow.length - 1].title}${
        (streamingNow[streamingNow.length - 1].languages ?? [])[0] !== lang
          ? ` (${LANG_NAMES[(streamingNow[streamingNow.length - 1].languages ?? [])[0]] ?? ''})`
          : ''
      } already streaming hai. Alag film hai. Yehi confusion sabse zyada hota hai.`
    : null,
  everyEarlierOn
    ? `Series ki baaki ${everyEarlierOn.count} filmein ${pname(everyEarlierOn.id)} pe hain.`
    : null,
  '',
  `🔗 ${SITE} — link in bio`,
  '',
  subjectStreaming ? 'Dekh li? 👇' : 'Theatre ja rahe ho ya OTT ka wait? 👇',
  '',
  `#${subject.title.split(/[\s:]+/)[0]} #NewOnOTT #OTTIndia #OTTReleases #KyaDekhein #WhatToWatch`,
  `#${langName}Cinema #Bollywood #PrimeVideo #Netflix #JioHotstar #OTTUpdate`,
]
  .filter((l) => l !== null)
  .join('\n');

await writeFile(resolve(OUT, `title-${slug}-caption.txt`), `${caption}\n`);

console.log(`\n  title-${slug}.png / .jpg   1080x1350   ${family.length} films in the series`);
if (!subjectStreaming) {
  console.log('  Labelled "in cinemas". No OTT date is claimed and none is forecast —');
  console.log('  the window tracker has 3 observations against its own threshold of 5.');
}
console.log(`\n  social/title-${slug}-caption.txt`);
