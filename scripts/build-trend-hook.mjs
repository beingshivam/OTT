#!/usr/bin/env node
/**
 * The first slide: the question, not the answer.
 *
 * `npm run hook` makes an evergreen Hinglish line about the site. It is good
 * and it is timeless, which is also its limit — nothing about it says "this
 * week", so nothing about it earns a share on the day somebody is actually
 * thinking about a film. This is the other half: one frame that hijacks the
 * thing the audience is already asking, and carries no answer at all.
 *
 * Asked for as "Zepto virality". What that house actually does, stripped of
 * the mythology: it waits for a thing everybody is already talking about,
 * says one short line about it in the voice people use, puts the brand in as
 * the punchline rather than the subject, and ships it while the moment is
 * warm. No product shots, no adjectives about itself, no explanation. The
 * parts that transfer here are the timing and the restraint — the moment has
 * to be real, and the frame has to carry exactly one idea.
 *
 * The moment this week is Jailer 2: the biggest Indian title in cinemas by a
 * distance (TMDB attention 52, against 38 for the next Indian film) and no
 * OTT date announced for it anywhere. That gap is the whole post. Somebody
 * walks out of the cinema, opens their phone and types "jailer 2 ott release
 * date" — and this site exists to be what they find.
 *
 * So the image is that search box, with their query in it, and the one thing
 * the site can honestly promise: nobody has dated it, and the day somebody
 * does, it will be here. The answer is deliberately withheld. That is not a
 * trick, it is the measurement: Search Console, 4–14 September, the pages
 * whose snippet opened "No OTT platform has dated it yet" took 372
 * impressions and zero clicks at position 8.6. A frame that answers its own
 * question gives nobody a reason to arrive.
 *
 * Nothing on the image is typed. The title, its date, whether it is still in
 * cinemas and whether a platform has dated it are all read from the feed, so
 * the frame cannot outlive the fact it is built on — and next week it is one
 * command and a different film.
 *
 * 4:5, which the feed shows uncropped and the profile grid now shows whole.
 *
 * Usage: npm run hook:trend
 *        TITLE="Jailer 2" npm run hook:trend   (override the pick)
 */

import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BRAND } from './brand.mjs';
import { launchChromium } from './browser.mjs';
import { loadRegistry } from './platform-registry.mjs';
import { dateOf } from './release-label.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'social');
const SITE = (process.env.SITE_URL ?? 'https://newonott.in')
  .replace(/^https?:\/\//, '')
  .replace(/\/$/, '');
const REGION = (process.env.REGIONS ?? 'IN').split(',')[0].trim() || 'IN';
const TODAY = process.env.TODAY ?? new Date().toISOString().slice(0, 10);

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const registry = await loadRegistry();
const pshort = new Map(registry.map((p) => [p.id, p.short]));
const prank = new Map(registry.map((p) => [p.id, p.rank]));
const servesHere = (id) => registry.find((p) => p.id === id)?.regions.includes(REGION);

const feed = JSON.parse(await readFile(resolve(ROOT, 'public/data/releases.json'), 'utf8'));
const rows = feed.weeks.flatMap((w) => w.releases ?? []).filter((r) => r.regions?.includes(REGION));
/* The back catalogue, for the sister film only. The feed is the release
   calendar and reaches back weeks; Jailer came out in 2023 and lives in the
   archive, which is where "and the first one is on Prime tonight" has to come
   from. Nothing else on this image reads from here — the claim about what is
   new stays a claim about the calendar. */
const archive = JSON.parse(
  await readFile(resolve(ROOT, 'data/archive.json'), 'utf8').catch(() => '{"titles":[]}'),
).titles.filter((r) => r.regions?.includes(REGION));

/* Same locality test as the rails and the poster builder: origin decides when
   TMDB has any, language fills the silence. A post about what India is asking
   should not open on a title India is not asking about. */
const INDIAN = new Set(['hi', 'ta', 'te', 'ml', 'kn', 'bn', 'mr', 'pa', 'gu', 'or', 'ur', 'as']);
const local = (r) => (r.origin?.length ? r.origin.includes('IN') : INDIAN.has(r.languages?.[0] ?? ''));

/**
 * How far back a film is still the thing people are asking about.
 *
 * Three weeks, which is the theatrical floor this repo measured rather than
 * the six-week run the cinema rail allows. The question "when does it come to
 * OTT" is loudest while the film is new and unavailable; a month in, the
 * people who wanted it have mostly seen it.
 */
const ASKING_DAYS = 21;
const since = new Date(Date.parse(TODAY) - (ASKING_DAYS - 1) * 86_400_000).toISOString().slice(0, 10);

/* Still only in cinemas, which is what makes the question worth asking. The
   moment a platform carries it the post has no tension in it: the answer is
   on the poster. */
const onlyInCinemas = (r) =>
  (r.platforms ?? []).includes('theatres') && !(r.platforms ?? []).some((p) => p !== 'theatres');

/* And nothing in the feed has dated its arrival — the `~ott` sibling is how a
   title carries an announced streaming date, so its absence is the claim this
   image makes. Checked rather than assumed: the frame says nobody has dated
   it, and it must not say that about a film this site has a date for. */
const dated = new Set(
  rows.filter((r) => String(r.id).includes('~')).map((r) => String(r.id).split('~')[0]),
);

const asking = rows
  .filter((r) => local(r) && onlyInCinemas(r) && Boolean(r.posterUrl))
  .filter((r) => r.releaseDate >= since && r.releaseDate <= TODAY)
  .filter((r) => !dated.has(String(r.id)))
  .sort((a, b) => (b.heat ?? 0) - (a.heat ?? 0));

const WANT = (process.env.TITLE ?? '').trim().toLowerCase();
const subject = WANT ? asking.find((r) => r.title.toLowerCase().includes(WANT)) : asking[0];
if (!subject) {
  console.error(
    WANT
      ? `TITLE="${process.env.TITLE}" matches no Indian film in cinemas, undated, from the last ${ASKING_DAYS} days.`
      : `No Indian film is in cinemas and undated in the last ${ASKING_DAYS} days — there is no question to hang a hook on this week.`,
  );
  process.exit(1);
}

/**
 * The two faint rows under the query.
 *
 * An autocomplete list with one entry is a search box; with three it is a
 * search engine, and the second thing is what the site is. They are the next
 * two Indian titles people would plausibly be looking up this week — in
 * cinemas or just landed — so the frame shows breadth without a second
 * headline competing with the first.
 */
const nearby = rows
  .filter((r) => local(r) && r.id !== subject.id && Boolean(r.posterUrl))
  .filter((r) => r.releaseDate >= since && r.releaseDate <= TODAY)
  .sort((a, b) => (b.heat ?? 0) - (a.heat ?? 0))
  .filter((r, i, all) => all.findIndex((x) => x.title === r.title) === i);
/* One of each where the week allows it. Both rows reading "kahan dekhein"
   makes the site look like it answers one kind of question; a cinema title
   asking for its OTT date beside a streaming title asking where it is says
   the thing the headline cannot. */
const alsoAsked = [
  nearby.find(onlyInCinemas),
  nearby.find((r) => !onlyInCinemas(r)),
  ...nearby,
]
  .filter(Boolean)
  .filter((r, i, all) => all.findIndex((x) => x.id === r.id) === i)
  .slice(0, 2)
  .map((r) =>
    onlyInCinemas(r)
      ? `${r.title.toLowerCase()} ott release date`
      : `${r.title.toLowerCase()} kahan dekhein`,
  );

/* The sister film, when the feed has one streaming. "Jailer 2 is in cinemas"
   is news; "and Jailer is on Prime tonight" is a reason to open the site
   within the next ten minutes, which is the difference between a post people
   like and a post people act on. Matched on the title's own stem rather than
   a hardcoded pair, and only ever named with services TMDB actually lists. */
const stem = subject.title.replace(/\s*\d+$|\s*:\s.*$/, '').trim();
const siblingRows = [...rows, ...archive].filter(
  (r) => r.title !== subject.title && r.title.replace(/\s*\d+$|\s*:\s.*$/, '').trim() === stem,
);
const tiers = Object.assign({}, ...siblingRows.map((r) => r.tiers ?? {}));
/* Best-ranked service first, and a free one ahead of a subscription at the
   same rank. Jailer is on MX Player free with ads, and on Prime and Sun NXT
   behind a subscription — "free" is the strongest word available here, and
   the first name is the only one half the readers take in. The tier comes
   from the row rather than from a list of which services are free, which
   changes without telling anybody. */
const FREE = new Set(['ads', 'free']);
const alsoOn = [...new Set(siblingRows.flatMap((r) => (r.platforms ?? []).filter((p) => p !== 'theatres' && servesHere(p))))]
  .sort(
    (a, b) =>
      (prank.get(a) ?? 2) - (prank.get(b) ?? 2) ||
      Number(FREE.has(tiers[b])) - Number(FREE.has(tiers[a])),
  )
  .map((p) => (FREE.has(tiers[p]) ? `${pshort.get(p) ?? p} (free)` : (pshort.get(p) ?? p)))
  .slice(0, 3);

const query = `${subject.title.toLowerCase()} ott release date`;
const HEAD_MAX = 96;
const HEAD_MIN = 52;

const html = `<!doctype html><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{width:1080px;height:1350px;position:relative;overflow:hidden;
       background:#06070a;color:#f2f4f9;font-family:Inter,system-ui,sans-serif;
       display:flex;flex-direction:column;padding:84px 76px}
  /* The same two-corner wash as the site, the share card and the posters, so
     a forwarded screenshot and the page it points at read as one product. */
  body::before,body::after{content:'';position:absolute;width:1100px;height:1100px;border-radius:50%;pointer-events:none}
  body::before{top:-700px;left:-320px;background:radial-gradient(circle,rgba(255,61,61,.34),transparent 62%)}
  body::after{bottom:-760px;right:-340px;background:radial-gradient(circle,rgba(126,78,255,.26),transparent 64%)}

  .top{position:relative;display:flex;align-items:center;gap:16px}
  .mark{width:52px;height:52px;border-radius:15px;display:grid;place-items:center;
        background:linear-gradient(135deg,#ff4d4d,#ffb03a)}
  .mark svg{width:22px;height:22px;fill:#fff}
  .brand{font-size:34px;font-weight:700;letter-spacing:-.022em}

  /* The search box is the hook, so it sits where the eye lands first and
     nothing shares the row with it. Rendered as the thing itself rather than
     as a picture of one: a real field, a real caret, the query lowercase the
     way somebody actually types it at eleven at night. */
  .search{position:relative;margin-top:72px;background:#11141d;border:1px solid rgba(255,255,255,.1);
          border-radius:26px;padding:34px 36px;display:flex;align-items:center;gap:22px;
          box-shadow:0 24px 60px rgba(0,0,0,.5)}
  .search svg{width:38px;height:38px;flex:none;fill:none;stroke:#7d8494;stroke-width:2.4}
  .q{font-size:42px;font-weight:600;letter-spacing:-.02em;white-space:nowrap;overflow:hidden}
  .caret{display:inline-block;width:3px;height:44px;margin-left:6px;vertical-align:-8px;background:#ffb03a}

  .also{position:relative;margin-top:22px;padding:0 10px}
  .also div{display:flex;align-items:center;gap:20px;padding:17px 26px;font-size:31px;
            font-weight:500;color:#6d7484;letter-spacing:-.01em;
            white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .also svg{width:27px;height:27px;flex:none;fill:none;stroke:#454c5c;stroke-width:2.4}

  h1{position:relative;margin-top:auto;font-size:${HEAD_MAX}px;line-height:1.0;
     font-weight:900;letter-spacing:-.05em}
  /* Each row is its own block and never wraps, so the fit pass can measure the
     widest and shrink the whole headline. Left to wrap, a long row re-breaks
     itself and reintroduces the accidental line breaks the rows exist to
     prevent. */
  h1 span{display:block;white-space:nowrap}
  em{font-style:normal;background:linear-gradient(100deg,#ff4d4d,#ff7a3d 42%,#ffb03a);
     -webkit-background-clip:text;-webkit-text-fill-color:transparent}
  p{position:relative;margin-top:34px;margin-bottom:auto;max-width:880px;
    font-size:35px;line-height:1.38;font-weight:500;color:#b6bdcc}

  .foot{position:relative;padding-top:34px;border-top:1px solid rgba(255,255,255,.12)}
  .url{font-size:62px;font-weight:900;letter-spacing:-.04em;
       background:linear-gradient(100deg,#ffb03a,#ff4d4d);
       -webkit-background-clip:text;-webkit-text-fill-color:transparent}
  .note{margin-top:12px;font-size:29px;font-weight:500;color:#7d8494}
</style>
<div class="top">
  <span class="mark"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></span>
  <span class="brand">${esc(BRAND)}</span>
</div>

<div class="search">
  <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4.2-4.2" stroke-linecap="round"/></svg>
  <span class="q">${esc(query)}<i class="caret"></i></span>
</div>
<div class="also">
  ${alsoAsked
    .map(
      (q) =>
        `<div><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4.2-4.2" stroke-linecap="round"/></svg>${esc(q)}</div>`,
    )
    .join('')}
</div>

<h1><span>Abhi tak kisi ne</span><span><em>date</em> nahi di.</span></h1>
<p>${esc(
  `${subject.title}, ${dateOf(subject.releaseDate)} se cinemas mein. Kisi platform ne OTT date announce nahi ki — jis din karega, usi din yahan.` +
    (alsoOn.length ? ` Tab tak ${stem} khud ${alsoOn.join(', ')} pe hai.` : ''),
)}</p>

<div class="foot">
  <div class="url">${esc(SITE)}</div>
  <div class="note">Roz check hota hai · No app, no login, free.</div>
</div>`;

await mkdir(OUT, { recursive: true });
let fitted = HEAD_MAX;
const browser = await launchChromium('hook:trend');
try {
  const p = await browser.newPage({ viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 1 });
  await p.setContent(html, { waitUntil: 'networkidle' });
  // Webfonts can resolve after networkidle; without this the line renders in a
  // fallback face and the whole thing looks like a draft.
  await p.evaluate(() => document.fonts.ready);

  /* As large as fits, measured rather than guessed. The headline is fixed but
     the query under it is not, and a long title — "Pehla Pyaar Doosri Baar
     ott release date" — is half as wide again as this week's. There is no CSS
     for "as large as fits", and a viewport-unit guess is the same hardcoded
     number wearing a different hat. */
  fitted = await p.evaluate(
    ([max, min]) => {
      const fit = (el, start, floor) => {
        const rows = el.tagName === 'H1' ? [...el.querySelectorAll('span')] : [el];
        let size = start;
        el.style.fontSize = `${size}px`;
        while (size > floor && rows.some((r) => r.scrollWidth > el.clientWidth)) {
          size -= 2;
          el.style.fontSize = `${size}px`;
        }
        return size;
      };
      fit(document.querySelector('.q'), 42, 24);
      return fit(document.querySelector('h1'), max, min);
    },
    [HEAD_MAX, HEAD_MIN],
  );

  /* Inside the frame, or nothing is written. `body` is overflow:hidden, so a
     composition that stops fitting is silently cut and the first sign of it
     is a posted image with no address on it. 4:5 is shown whole, so the safe
     box is the padding. */
  const out = await p.evaluate(
    (pad) =>
      ['.top', '.search', '.also', 'h1', 'p', '.foot']
        .map((sel) => [sel, document.querySelector(sel)?.getBoundingClientRect()])
        .filter(([, r]) => r)
        .filter(([, r]) => r.top < pad || r.bottom > 1350 - pad)
        .map(([sel, r]) => `${sel} spans ${Math.round(r.top)}–${Math.round(r.bottom)}`),
    84,
  );
  if (out.length) {
    console.error(
      `Outside the frame of a 1080x1350 image — ${out.join('; ')}.\nNothing has been written.`,
    );
    process.exit(1);
  }

  await writeFile(resolve(OUT, 'hook-trend.png'), await p.screenshot({ type: 'png' }));
  await writeFile(resolve(OUT, 'hook-trend.jpg'), await p.screenshot({ type: 'jpeg', quality: 92 }));
} finally {
  await browser.close();
}

/* Hinglish caption under a Hinglish image. Switching to English here reads as
   a translation of the joke, which kills it. */
const caption = `"${query}" 🔍

${subject.title} ${dateOf(subject.releaseDate)} se cinemas mein hai aur abhi tak kisi platform ne OTT date announce nahi ki.

Jis din karega — Netflix ho, Prime ho, JioHotstar, SonyLIV, ZEE5, Sun NXT — usi din ${SITE} pe dikh jayega. Roz, har platform check hota hai.${
  alsoOn.length ? `\n\nAur tab tak? ${stem} already ${alsoOn.join(', ')} pe hai. 🍿` : ''
}

Koi app nahi. Koi login nahi. Free.

🔗 ${SITE} — link in bio

Aur kiska OTT date chahiye? Comment karo 👇

#${subject.title.replace(/[^A-Za-z0-9]/g, '')} #OTTReleaseDate #NewOnOTT #OTTIndia #KyaDekhein
#WhatToWatch #TamilCinema #OTTUpdate #StreamingIndia #newonottin
`;
await writeFile(resolve(OUT, 'hook-trend-caption.txt'), caption);

console.log(`  hook-trend.png / .jpg  1080x1350  headline ${fitted}px`);
console.log(`  query: "${query}"`);
console.log(`  also asked: ${alsoAsked.join(' · ') || 'none'}`);
console.log(`  ${stem} streaming on: ${alsoOn.join(', ') || 'nothing in the feed'}`);
console.log('\nWritten to social/ — hook-trend.png, hook-trend.jpg, hook-trend-caption.txt');
if (fitted === HEAD_MIN) console.warn(`  ⚠  headline hit the ${HEAD_MIN}px floor.`);
