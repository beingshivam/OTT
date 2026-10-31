#!/usr/bin/env node
/**
 * One film, the whole frame.
 *
 * Every other image this project makes is a grid — the week as tiles, the
 * month as tiles, a franchise as a list. That shape is right when the post is
 * about a set of things and wrong when it is about one, and a release like
 * Ramayana: Rise of a Legend is the second kind. Asked for a post that
 * "matches Ramayan's aura", and a 227px tile in a four-column grid is the
 * opposite of aura however good the artwork is.
 *
 * So: the poster at full width, a scrim, and almost no words. The restraint
 * is the design. A film whose poster carries Ram with the bow and Hanuman in
 * a cosmic wash does not need this account's adjectives on top of it, and the
 * fastest way to make something look small is to explain why it is big.
 *
 * The type is the one real departure from house style. Inter is what every
 * other card uses and it is right for a release calendar; it is not right for
 * an epic, and a serif cut for inscriptions is — the lettering convention
 * this genre has used since the artwork for Ben-Hur. So the title is Cinzel
 * and everything that has to be read quickly underneath it stays Inter.
 *
 * WHAT IT REFUSES TO SAY, which matters more here than usual, because this is
 * the loudest post the account will make this month:
 *
 *   - Every fact is read from the row: the date, the runtime, the
 *     certificate, the language, the director, the cast. Nothing is typed.
 *   - No OTT date is predicted or implied. Nobody has announced one and the
 *     window tracker has no Hindi observations to forecast from.
 *   - Advance booking is not in the feed and this script cannot know it, so
 *     it is never claimed on its own: BOOKING=1 says the operator has checked.
 *     A booking line that appeared automatically would eventually appear on a
 *     film with no bookings open.
 *
 * Usage: npm run post:epic -- "Ramayana"
 *        BOOKING=1 npm run post:epic -- "Ramayana"
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BRAND } from './brand.mjs';
import { launchChromium } from './browser.mjs';
import { loadRegistry } from './platform-registry.mjs';
import { dateOf, dayOf, upcoming } from './release-label.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'social');
const SITE = (process.env.SITE_URL ?? 'https://newonott.in').replace(/^https?:\/\//, '').replace(/\/$/, '');
const REGION = (process.env.REGIONS ?? 'IN').split(',')[0].trim() || 'IN';
const TODAY = process.env.TODAY ?? new Date().toISOString().slice(0, 10);
const BOOKING = process.env.BOOKING === '1';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const wanted = process.argv.slice(2).filter((a) => !a.startsWith('--')).join(' ').trim();
if (!wanted) {
  console.error('Usage: npm run post:epic -- "<title>"\nNothing has been written.');
  process.exit(1);
}

const registry = await loadRegistry();
const pshort = new Map(registry.map((p) => [p.id, p.short]));
const servesHere = (id) => registry.find((p) => p.id === id)?.regions.includes(REGION);

const feed = JSON.parse(await readFile(resolve(ROOT, 'public/data/releases.json'), 'utf8'));
const archive = JSON.parse(
  await readFile(resolve(ROOT, 'data/archive.json'), 'utf8').catch(() => '{"titles":[]}'),
).titles;
/* The calendar first: the same title can sit in both, and the feed's copy is
   the one the refresh keeps current. */
const rows = [...feed.weeks.flatMap((w) => w.releases ?? []), ...archive].filter((r) =>
  r.regions?.includes(REGION),
);

const needle = wanted.toLowerCase();
const subject =
  rows.find((r) => (r.title ?? '').toLowerCase() === needle) ??
  rows.find((r) => (r.title ?? '').toLowerCase().includes(needle));
if (!subject) {
  console.error(`Nothing in the feed or the archive matches "${wanted}".\nNothing has been written.`);
  process.exit(1);
}
if (!subject.posterUrl) {
  console.error(`${subject.title} has no artwork, and this post is the artwork.\nNothing has been written.`);
  process.exit(1);
}

const LANG = {
  hi: 'Hindi', ta: 'Tamil', te: 'Telugu', ml: 'Malayalam', kn: 'Kannada',
  bn: 'Bengali', mr: 'Marathi', pa: 'Punjabi', gu: 'Gujarati', en: 'English',
};

const soon = upcoming(subject.releaseDate, TODAY);
const inCinemas =
  (subject.platforms ?? []).includes('theatres') &&
  !(subject.platforms ?? []).some((p) => p !== 'theatres');
const services = (subject.platforms ?? [])
  .filter((p) => p !== 'theatres' && servesHere(p))
  .map((p) => pshort.get(p) ?? p);

/* The one big fact, and it changes with the tense. A date is the whole story
   while a film is still ahead; once it has opened, the story is that it is
   on. */
const lead = soon
  ? { kicker: 'In cinemas', big: `${dayOf(subject.releaseDate)} ${dateOf(subject.releaseDate)}` }
  : inCinemas
    ? { kicker: 'In cinemas now', big: `Since ${dateOf(subject.releaseDate)}` }
    : { kicker: 'Streaming now', big: services.join(' · ') || 'Streaming' };

/* Runtime as people say it, not as a database stores it. "195 min" is a
   number; "3h 15m" is a plan for the evening. */
const runtime = subject.runtimeMinutes
  ? `${Math.floor(subject.runtimeMinutes / 60)}h ${subject.runtimeMinutes % 60}m`
  : null;
/* The date only where the big line is not already the date — on an upcoming
   film it reads "Thu 5 Nov" two inches above a chip saying "5 Nov", which is
   the frame repeating itself in a place built for the facts it has not said
   yet. */
const facts = [
  lead.big.includes(dateOf(subject.releaseDate)) ? null : dateOf(subject.releaseDate),
  runtime,
  subject.certification,
  (subject.languages ?? []).map((l) => LANG[l] ?? l.toUpperCase())[0],
].filter(Boolean);

/* The OTT line is the only thing this account can say that nobody else is
   saying, so it is the last thing on the frame and it is never a guess. */
const ottLine = inCinemas
  ? 'OTT date: not announced yet. The day it is, it is here.'
  : services.length
    ? `Streaming on ${services.join(', ')}.`
    : 'Where to watch, the day it lands.';

const SIZES = [
  { name: 'epic', w: 1080, h: 1350, padY: 72, art: 760, title: 86 },
  /* 250px clear at each end: a story is not cropped but the app draws its
     profile row and reply bar over it. See build-week-posters for the report
     this came from. */
  { name: 'epic-story', w: 1080, h: 1920, padY: 250, art: 900, title: 92 },
];

const page = (size) => `<!doctype html><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@600;800&family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{width:${size.w}px;height:${size.h}px;position:relative;overflow:hidden;
       background:#05060a;color:#f4f1e9;font-family:Inter,system-ui,sans-serif;
       display:flex;flex-direction:column;padding:${size.padY}px 72px}

  /* The artwork, bled to the edges and faded rather than cropped to a box.
     A poster in a rounded tile reads as a catalogue entry; the same poster
     running off the frame reads as a film. */
  .art{position:absolute;top:0;left:0;right:0;height:${size.art}px;z-index:0}
  .art img{width:100%;height:100%;object-fit:cover;object-position:50% 22%;display:block}
  /* Two stops, not one. A single fade to black greys the middle of the image
     where the faces are; holding it transparent for the top half and then
     falling steeply keeps the artwork intact and still gives the type a
     surface to sit on. */
  .art::after{content:'';position:absolute;inset:0;
    background:linear-gradient(180deg,rgba(5,6,10,.55) 0%,rgba(5,6,10,0) 26%,rgba(5,6,10,.12) 52%,rgba(5,6,10,.86) 82%,#05060a 100%)}

  .top{position:relative;z-index:2;display:flex;align-items:center;gap:15px}
  .mark{width:46px;height:46px;border-radius:14px;display:grid;place-items:center;
        background:linear-gradient(135deg,#ff4d4d,#ffb03a);font-weight:900;font-size:23px;color:#fff;
        font-family:Inter,sans-serif}
  .brand{font-size:29px;font-weight:700;letter-spacing:-.022em}

  .body{position:relative;z-index:2;margin-top:auto}

  /* Gold, and only here. The wash on every other card is the brand's red to
     amber; this is a single warm metal because two gradients in one frame
     read as decoration rather than as a thing cast in something. */
  .kicker{font-size:21px;font-weight:800;letter-spacing:.22em;text-transform:uppercase;
          color:#e8b55c;font-family:Inter,sans-serif}
  h1{margin-top:16px;font-family:Cinzel,Georgia,serif;font-weight:800;
     font-size:${size.title}px;line-height:1.02;letter-spacing:.005em;
     background:linear-gradient(170deg,#fdf3d8,#e8b55c 48%,#b8832f);
     -webkit-background-clip:text;-webkit-text-fill-color:transparent}
  .big{margin-top:22px;font-size:46px;font-weight:800;letter-spacing:-.02em;color:#f4f1e9}

  .rule{margin:30px 0 26px;height:1px;background:linear-gradient(90deg,rgba(232,181,92,.75),rgba(232,181,92,0))}

  .facts{display:flex;flex-wrap:wrap;gap:14px 12px;font-size:25px;font-weight:600;color:#c9c2b2}
  .facts span{padding:8px 18px;border:1px solid rgba(232,181,92,.3);border-radius:999px;white-space:nowrap}
  .people{margin-top:24px;font-size:28px;line-height:1.45;font-weight:500;color:#b7b0a1}
  .people b{color:#efe9dc;font-weight:700}
  ${BOOKING ? '.booking{margin-top:26px;display:inline-block;padding:14px 26px;border-radius:14px;font-size:29px;font-weight:800;letter-spacing:-.01em;color:#1a1206;background:linear-gradient(100deg,#f4d58a,#e8b55c)}' : ''}

  .foot{position:relative;z-index:2;margin-top:36px;padding-top:28px;
        border-top:1px solid rgba(255,255,255,.12);display:flex;align-items:baseline;gap:16px;flex-wrap:wrap}
  .url{font-size:40px;font-weight:900;letter-spacing:-.03em;
       background:linear-gradient(100deg,#ffb03a,#ff4d4d);
       -webkit-background-clip:text;-webkit-text-fill-color:transparent}
  .say{font-size:25px;font-weight:500;color:#8e8778}
</style>
<div class="art"><img src="${esc(subject.posterUrl)}" alt=""></div>
<div class="top">
  <div class="mark">N</div><div class="brand">${esc(BRAND)}</div>
</div>
<div class="body">
  <div class="kicker">${esc(lead.kicker)}</div>
  <h1>${esc(subject.title)}</h1>
  <div class="big">${esc(lead.big)}</div>
  <div class="rule"></div>
  <div class="facts">${facts.map((f) => `<span>${esc(f)}</span>`).join('')}</div>
  <div class="people">${
    subject.director ? `<b>${esc(subject.director)}</b><br>` : ''
  }${esc((subject.cast ?? []).slice(0, 5).join(' · '))}</div>
  ${BOOKING ? '<div class="booking">Advance booking open</div>' : ''}
</div>
<div class="foot">
  <div class="url">${esc(SITE)}</div>
  <div class="say">${esc(ottLine)}</div>
</div>`;

await mkdir(OUT, { recursive: true });
const browser = await launchChromium('post:epic');
try {
  for (const size of SIZES) {
    const p = await browser.newPage({
      viewport: { width: size.w, height: size.h },
      deviceScaleFactor: 1,
    });
    await p.setContent(page(size), { waitUntil: 'networkidle' });
    await p.evaluate(() => document.fonts.ready);
    /* The poster is the post. Everything else can degrade; this cannot, so it
       is waited for rather than raced — but still bounded, because a CI run
       must not hang on one slow image. */
    await p.evaluate(
      () =>
        new Promise((done) => {
          const img = document.querySelector('.art img');
          if (!img || img.complete) return done();
          img.addEventListener('load', done, { once: true });
          img.addEventListener('error', done, { once: true });
          setTimeout(done, 15000);
        }),
    );

    /* As large as the frame allows, measured against the frame itself.
       "Ramayana: Rise of a Legend" is 26 characters of Cinzel, a wide face,
       so it takes two lines and pushes everything under it down; a longer
       title would push the address off the bottom, where it would be found
       after posting rather than before. The loop shrinks until the whole
       column sits inside the safe box — the same condition the assert below
       checks, so the knob is tied to the constraint rather than to a proxy
       for it. An earlier version compared scrollHeight with clientHeight,
       which on a 1.02 line-height measures the serif's own overhang and
       shrank a title that fitted perfectly well from 86px to 62px. */
    const fitted = await p.evaluate(
      ({ start, min, h, pad }) => {
        const h1 = document.querySelector('h1');
        const top = document.querySelector('.top');
        const foot = document.querySelector('.foot');
        const spills = () =>
          top.getBoundingClientRect().top < pad - 1 ||
          foot.getBoundingClientRect().bottom > h - pad + 1;
        let size = start;
        h1.style.fontSize = `${size}px`;
        while (size > min && spills()) {
          size -= 2;
          h1.style.fontSize = `${size}px`;
        }
        return size;
      },
      { start: size.title, min: 40, h: size.h, pad: size.padY },
    );

    const out = await p.evaluate(
      ({ pad, h }) =>
        ['.top', '.body', '.foot']
          .map((sel) => [sel, document.querySelector(sel)?.getBoundingClientRect()])
          .filter(([, r]) => r)
          .filter(([, r]) => r.top < pad - 1 || r.bottom > h - pad + 1)
          .map(([sel, r]) => `${sel} spans ${Math.round(r.top)}–${Math.round(r.bottom)}`),
      { pad: size.padY, h: size.h },
    );
    if (out.length) {
      console.error(
        `${size.name}: outside the safe area of a ${size.w}x${size.h} image — ${out.join('; ')}.\n` +
          'Nothing has been written.',
      );
      process.exit(1);
    }

    await writeFile(resolve(OUT, `${size.name}.png`), await p.screenshot({ type: 'png' }));
    await writeFile(resolve(OUT, `${size.name}.jpg`), await p.screenshot({ type: 'jpeg', quality: 92 }));
    await p.close();
    console.log(`  ${size.name}.png / .jpg   ${size.w}x${size.h}   title ${fitted}px`);
  }
} finally {
  await browser.close();
}

const cast = (subject.cast ?? []).slice(0, 5).join(', ');
const caption = `${
  soon
    ? `${dayOf(subject.releaseDate)} ${dateOf(subject.releaseDate)}. Cinemas mein.`
    : inCinemas
      ? `Cinemas mein, ${dateOf(subject.releaseDate)} se.`
      : `${services.join(', ')} pe, abhi.`
}${BOOKING ? ' Advance booking khul gayi hai. 🏹' : ' 🏹'}

${subject.title}${subject.director ? ` — ${subject.director}` : ''}.${cast ? ` ${cast}.` : ''}${
  runtime ? ` ${runtime}.` : ''
}${subject.certification ? ` ${subject.certification} certificate.` : ''}

${
  inCinemas
    ? `OTT pe kab aayegi? Abhi kisi platform ne kuch nahi kaha. Jis din kahega — Netflix, Prime, JioHotstar, koi bhi — usi din ${SITE} pe dikh jayega. Roz check hota hai.`
    : `Poori detail, har platform ke saath — ${SITE}.`
}

Koi app nahi. Koi login nahi. Free.

🔗 ${SITE} — link in bio

Pehle din dekh rahe ho? 👇

#${subject.title.replace(/[^A-Za-z0-9]/g, '')} ${(subject.cast ?? [])
  .slice(0, 3)
  .map((c) => `#${c.replace(/[^A-Za-z0-9]/g, '')}`)
  .join(' ')} #NewOnOTT #OTTIndia #OTTReleaseDate #KyaDekhein #WhatToWatch #newonottin
`;
await writeFile(resolve(OUT, 'epic-caption.txt'), caption);

console.log(`\n  ${subject.title} — ${lead.kicker}, ${lead.big}`);
console.log(`  booking line: ${BOOKING ? 'on (BOOKING=1)' : 'off'}`);
console.log('\nWritten to social/ — epic.png, epic-story.png, epic-caption.txt');
