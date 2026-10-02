#!/usr/bin/env node
/**
 * The Drishyam post: an in-joke, then the utility.
 *
 * Follows build-mirzapur: a one-off tied to one film and one week, kept apart
 * from build-memes because those are deliberately evergreen and carry no
 * titles. This carries nothing else.
 *
 * THE JOKE. Drishyam's whole plot turns on a family rehearsing an alibi for
 * the 2nd and 3rd of October until they believe it themselves — it is the most
 * quoted thing about the franchise by a distance. The Conclusion opened on the
 * 2nd of October. Whether the studio planned that or not, every person who has
 * seen the film reads the date and gets there on their own.
 *
 * That is the shape worth posting. An in-joke rewards the reader for knowing
 * it, and a reader who feels clever forwards the thing that made them feel
 * that way; an explained joke does neither. So the card states the date,
 * speaks one line in the alibi's voice, and explains nothing.
 *
 * The release date is read from the feed rather than typed, because a post
 * whose entire joke is a date cannot afford to be wrong about it — and if the
 * film is ever re-dated this will simply stop claiming the 2nd.
 *
 * WHAT IT DOES NOT SAY. The Conclusion is in cinemas, not streaming. The card
 * says so in those words. The earlier films are a search away and the post says
 * that too, which is the one genuinely useful thing it can offer today.
 *
 * Usage: npm run drishyam
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BRAND } from './brand.mjs';
import { launchChromium } from './browser.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'social');
const SITE = (process.env.SITE_URL ?? 'https://newonott.in').replace(/^https?:\/\//, '').replace(/\/$/, '');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/* The subject, from the feed. The date is the joke, so it is read and never
   typed: a card that is wrong about the 2nd of October is worse than no card. */
const feed = JSON.parse(await readFile(resolve(ROOT, 'public/data/releases.json'), 'utf8'));
const film = feed.weeks
  .flatMap((w) => w.releases)
  .find((r) => /drishyam/i.test(r.title) && /conclusion/i.test(r.title));

if (!film) {
  console.error('Drishyam: The Conclusion is not in the current feed. Nothing has been written.');
  process.exit(1);
}

const when = new Date(`${film.releaseDate}T00:00:00Z`);
const DAY = when.getUTCDate();
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];
const MONTH = MONTHS[when.getUTCMonth()];

/* The joke only works on the 2nd, and only for a film still in cinemas. Both
   are asserted rather than assumed — this is a post that must not run on a
   date that makes nonsense of it. */
const streaming = (film.platforms ?? []).filter((p) => p !== 'theatres');
if (DAY !== 2 || MONTH !== 'October') {
  console.error(
    `The card's joke is the 2nd of October and the feed says ${film.releaseDate}. ` +
      'Nothing has been written — the date is the post.',
  );
  process.exit(1);
}
if (streaming.length) {
  console.error(
    `The feed now lists ${film.title} on ${streaming.join(', ')}, so "in cinemas" would be wrong. ` +
      'Nothing has been written.',
  );
  process.exit(1);
}

const html = `<!doctype html><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body {
    width:1080px; height:1350px; position:relative; overflow:hidden;
    background:#06070a; color:#f2f4f9; font-family:Inter,system-ui,sans-serif;
    display:flex; flex-direction:column; padding:80px 76px;
  }
  /* The same two-corner wash as every other image, so a forwarded screenshot
     and the page it points at read as one product. */
  body::before, body::after {
    content:''; position:absolute; width:1100px; height:1100px; border-radius:50%; pointer-events:none;
  }
  body::before { top:-720px; left:-330px; background:radial-gradient(circle, rgba(255,61,61,.32), transparent 62%); }
  body::after  { bottom:-780px; right:-350px; background:radial-gradient(circle, rgba(126,78,255,.24), transparent 64%); }

  .top { position:relative; display:flex; align-items:center; gap:15px; flex:none; }
  .mark { width:48px; height:48px; border-radius:14px; display:grid; place-items:center;
          background:linear-gradient(135deg,#ff4d4d,#ffb03a); }
  .mark svg { width:20px; height:20px; fill:#fff; }
  .brand { font-size:31px; font-weight:700; letter-spacing:-.022em; }
  .kicker { margin-left:auto; font-size:23px; font-weight:700; letter-spacing:.14em;
            text-transform:uppercase; color:#8d94a4; }

  .mid { position:relative; flex:1 1 auto; display:flex; flex-direction:column; justify-content:center; }

  /* Sized to leave air above and below rather than to be as large as
     possible: the card has to hold the joke, the status line, the FYI and the
     address, and a date that fills the frame starves the three things that
     make it useful. */
  .date { font-size:158px; line-height:.94; font-weight:900; letter-spacing:-.055em;
          background:linear-gradient(100deg,#ff4d4d,#ff7a3d 42%,#ffb03a);
          -webkit-background-clip:text; -webkit-text-fill-color:transparent; }

  /* The alibi, set as something being recited rather than said — the rule the
     family repeat to each other until it is true. */
  .quote { margin-top:52px; padding-left:34px; border-left:5px solid rgba(255,77,77,.65);
           font-size:54px; line-height:1.26; font-weight:700; letter-spacing:-.03em; color:#f2f4f9; }
  .beat { margin-top:40px; font-size:38px; line-height:1.4; font-weight:500; color:#b6bdcc; }
  .beat b { color:#f2f4f9; font-weight:800; }

  .fyi { position:relative; flex:none; margin-top:44px; padding:26px 30px; border-radius:18px;
         background:rgba(255,255,255,.055); border:1px solid rgba(255,255,255,.09);
         font-size:31px; line-height:1.42; font-weight:500; color:#b6bdcc; }
  .fyi b { color:#f2f4f9; font-weight:800; }

  .foot { position:relative; flex:none; margin-top:36px; padding-top:30px;
          border-top:1px solid rgba(255,255,255,.12); }
  .url { font-size:60px; font-weight:900; letter-spacing:-.04em;
         background:linear-gradient(100deg,#ffb03a,#ff4d4d);
         -webkit-background-clip:text; -webkit-text-fill-color:transparent; }
  .note { margin-top:11px; font-size:28px; font-weight:500; color:#7d8494; }
</style>
<div class="top">
  <span class="mark"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></span>
  <span class="brand">${esc(BRAND)}</span>
  <span class="kicker">In cinemas today</span>
</div>

<div class="mid">
  <div class="date">${DAY}<br>${esc(MONTH)}.</div>
  <div class="quote">“Yaad rakhna — hum us din bahar the.”</div>
  <div class="beat">
    <b>${esc(film.title)}</b> aaj cinemas mein hai.<br>
    Date dekhi? Fans ko samajh aa gaya hoga.
  </div>
</div>

<div class="fyi">
  <b>FYI</b> — pehle ke Hindi aur Malayalam parts dekhne hain?
  ${esc(SITE)} pe <b>“Drishyam”</b> search karo. Sab ek jagah, with platforms.
</div>

<div class="foot">
  <div class="url">${esc(SITE)}</div>
  <div class="note">Jis din OTT pe aayegi, page apne aap update hoga.</div>
</div>
`;

await mkdir(OUT, { recursive: true });
const browser = await launchChromium('drishyam');
try {
  const p = await browser.newPage({ viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 1 });
  await p.setContent(html, { waitUntil: 'networkidle' });
  // Webfonts can resolve after networkidle; without this it renders in a
  // fallback face and the whole card looks like a draft.
  await p.evaluate(() => document.fonts.ready);
  await writeFile(resolve(OUT, 'drishyam-alibi.png'), await p.screenshot({ type: 'png' }));
  /* Instagram's publishing API rejects PNG. */
  await writeFile(resolve(OUT, 'drishyam-alibi.jpg'), await p.screenshot({ type: 'jpeg', quality: 92 }));
  await p.close();
} finally {
  await browser.close();
}

const caption = `${DAY} ${MONTH}.

Agar ye date dekh ke tum muskura diye — tumne Drishyam dekhi hai. 👀

${film.title} aaj cinemas mein hai. OTT pe abhi nahi — kisi platform ne date announce nahi ki hai. Jis din karega, page apne aap update ho jaayega.

FYI: pehle ke parts dekhne hain ya dobara dekhne hain? ${SITE} pe "Drishyam" search karo — Hindi waali bhi, Malayalam waali bhi, aur kaunsi kahan stream ho rahi hai wo bhi. Sab ek page pe.

Chhota sa confusion bhi clear kar dete hain: Malayalam ki Drishyam 3 already streaming hai. Aaj waali alag film hai.

🔗 ${SITE} — link in bio

Theatre ja rahe ho ya OTT ka wait? 👇

#Drishyam #DrishyamTheConclusion #AjayDevgn #NewOnOTT #OTTIndia #KyaDekhein
#WhatToWatch #Bollywood #MalayalamCinema #OTTReleases #PrimeVideo #OTTUpdate
`;

await writeFile(resolve(OUT, 'drishyam-alibi-caption.txt'), caption);

console.log(`\n  drishyam-alibi.png / .jpg   1080x1350`);
console.log(`  Release date read from the feed: ${film.releaseDate}`);
console.log(`  Status: in cinemas, no streaming platform — stated as such.`);
console.log(`\n  social/drishyam-alibi-caption.txt`);
