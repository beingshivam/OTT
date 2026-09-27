#!/usr/bin/env node
/**
 * Three posts a week, chosen rather than picked at random.
 *
 * Everything needed to post already existed and none of it was joined up. The
 * repo builds eight kinds of creative — the weekly poster, hook cards, three
 * memes, product-screen posts, a launch carousel, an explainer, a seven-frame
 * story — each with its caption written alongside it. What it had no answer for
 * was which of them goes out on Wednesday, and that is the whole reason the
 * account would otherwise be posted to by hand or not at all.
 *
 * Three decisions, and they are the only interesting ones here:
 *
 * ROTATION. Never the same format twice running. Three posters in a row read as
 * one advertiser talking, which is the note build-memes was written against;
 * the fix belongs here, in what gets chosen, rather than in each builder. Among
 * the eligible formats the least recently used wins, so the shape of the feed
 * varies without anybody maintaining a calendar.
 *
 * THE LEDGER. A creative that has gone out is spent, and the ledger is what
 * remembers. Without it a rerun would repost Monday's image on Wednesday and
 * the account would look like a broken cron job. It records the asset, not just
 * the format, because the memes are three distinct posts and posting the same
 * one twice is the failure a format-only log would allow.
 *
 * THE WEEKLY POSTER IS DIFFERENT. It is the only perishable one — it names this
 * week's releases, so it is worth most on the day the calendar updates and
 * worth nothing a fortnight later. It gets the first slot every week and is
 * exempt from the spent rule, since next week's poster is a different poster.
 *
 * Media has to be reachable: Metricool takes public URLs, not local files, so
 * the chosen images are copied into public/social/ to be served by the site
 * that is already deployed. Nothing else about them changes.
 *
 * Writes a plan and posts nothing. Scheduling is a separate step against a
 * connected account, which keeps the part that can be tested away from the part
 * that is irreversible.
 *
 * Usage: npm run plan:ig
 *        npm run plan:ig -- --weeks 2      (plan further ahead)
 *        npm run plan:ig -- --mark         (record the current plan as spent)
 */

import { readFile, writeFile, mkdir, copyFile, readdir, stat } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOCIAL = resolve(ROOT, 'social');
const SERVED = resolve(ROOT, 'public/social');
const LEDGER = resolve(ROOT, 'data/instagram-log.json');
const PLAN = resolve(ROOT, 'data/instagram-plan.json');
const SITE = (process.env.SITE_URL ?? 'https://newonott.in').replace(/\/$/, '');

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
};
const WEEKS = Number(arg('weeks', 1));
if (WEEKS > 1) {
  /*
   * Planning ahead does less than it looks like it does, and saying so beats
   * quietly producing a worse plan.
   *
   * The posts that carry this account — the weekly poster and the three angles
   * — are built from the current feed. Next week's do not exist yet, so a
   * multi-week plan can only use each of them once and then falls back to the
   * fixed creative, burning in three weeks a stock that is meant to be
   * occasional variety. One week at a time, rebuilt each time, is the mode
   * this is designed for.
   */
  console.error(
    `Planning ${WEEKS} weeks, but only this week's data-driven creative exists — later weeks\n` +
      'will fall back to fixed stock and use it up. Prefer rebuilding and planning weekly.\n',
  );
}

/**
 * The formats, and what each one is for.
 *
 * `match` finds a format's assets by filename, because the builders name their
 * output and renaming it to suit this script would put the coupling in the
 * wrong place. `caption` says where the words live: most builders write
 * <asset>-caption.txt beside the image, the weekly poster writes caption.txt.
 *
 * Ordered by how much of the week's work each does, which decides ties on the
 * first run when the ledger is empty and nothing is least-recently-used yet.
 */
const FORMATS = [
  {
    id: 'poster',
    /* The utility itself: this week's releases, with the address on it. Nobody
       forwards an ad and plenty of people forward the list their group chat
       was about to ask for. */
    match: (f) => f === 'instagram-4x5.png',
    caption: () => 'caption.txt',
    perishable: true,
  },
  /*
   * The weekly angles, and the reason three a week is now sustainable rather
   * than a two-week runway. Each is built from the current feed with its
   * figures computed rather than typed, so it is new every week and cannot go
   * stale the way the product screenshots did — see build-angles.
   *
   * One format each rather than a shared "angle" id, because the rotation rule
   * is per format: under one id only a single angle could run in any week and
   * the other two would never be reached.
   */
  { id: 'south', match: (f) => f === 'angle-south.png', perishable: true },
  { id: 'cinemas', match: (f) => f === 'angle-cinemas.png', perishable: true },
  { id: 'landed', match: (f) => f === 'angle-landed.png', perishable: true },
  { id: 'meme', match: (f) => /^meme-\d/.test(f) && f.endsWith('.png') },
  {
    id: 'feature',
    /* build-feature writes post-<slug>.png, not feature-<slug>.png. The first
       draft matched the name I assumed and so found none of them — seven of the
       thirteen usable assets were invisible to the planner, which is why it ran
       out of creative after four posts. */
    match: (f) => /^post-/.test(f) && f !== 'post-what-we-are.png' && f.endsWith('.png'),
    /*
     * Held back from the automatic pool, and this is the interesting one.
     *
     * These looked like the answer to sustainability: the image is a screenshot
     * of a real page, so /south next month shows next month's titles and the
     * asset recycles itself. I gave them a 28-day cooloff on that reasoning and
     * it was wrong, because the caption does not come from the page — it is
     * prose in build-feature.mjs with the numbers typed into it:
     *
     *   claims    70 South releases, 64 theatre-only, Tamil 27, Telugu 19
     *   actual    96 South releases, 79 theatre-only, Tamil 36, Telugu 27
     *
     * Every figure in that caption is now wrong, and rebuilding does not fix it:
     * the screenshot refreshes and the caption is rewritten from the same
     * hardcoded text. So a fresh file is no evidence of an accurate claim, which
     * is why the mtime check that catches the stale poster cannot catch this.
     *
     * Publishing a wrong number about our own catalogue, in our own voice, is
     * worse than posting less often. They stay available to post by hand, where
     * somebody can read the numbers first, and they come back into the pool the
     * day their captions are derived from the feed rather than typed.
     */
    manualOnly: 'its caption has hand-typed statistics that are now out of date',
  },
  { id: 'hook', match: (f) => /^hook-\d/.test(f) && f.endsWith('.png') },
  { id: 'title', match: (f) => /^mirzapur-/.test(f) && f.endsWith('.png') },
  { id: 'explainer', match: (f) => f === 'post-what-we-are.png' },
];

/**
 * When to post, in IST.
 *
 * Deliberately fixed rather than asked for. Metricool's best-time tool reads an
 * account's own history, and an account with no history has none to read — it
 * would answer with noise and the noise would look like a measurement. These
 * are the three windows an Indian entertainment audience is actually on the
 * app: after work, and the two evenings either side of a Friday release.
 *
 * Once the account has run for a few weeks its own numbers beat any default,
 * and that is the point to switch. Not before.
 */
const SLOTS = [
  { day: 5, hour: 19, minute: 30, why: 'Friday evening, when the week\'s releases have just landed' },
  { day: 0, hour: 12, minute: 30, why: 'Sunday midday, the longest scroll of the week' },
  { day: 3, hour: 21, minute: 0, why: 'Wednesday night, the midweek "kya dekhein" gap' },
];

const IST = '+05:30';
const DAY = 86_400_000;

/** The next date at a given weekday and time, strictly after `after`. */
const nextSlot = (after, slot) => {
  const d = new Date(after);
  const ahead = (slot.day - d.getUTCDay() + 7) % 7 || 7;
  const at = new Date(d.getTime() + ahead * DAY);
  /* Built in IST and written with the offset, so a runner in UTC and a reader
     in Mumbai agree on when 7:30pm is. */
  const iso = `${at.toISOString().slice(0, 10)}T${String(slot.hour).padStart(2, '0')}:${String(
    slot.minute,
  ).padStart(2, '0')}:00`;
  return { dateTime: iso, date: `${iso}${IST}` };
};

/*
 * Closing the loop the first draft left open.
 *
 * The ledger was read and never written, which meant the guarantee it exists
 * for — a creative that has gone out is spent — did not actually hold. Every
 * run would have re-chosen the same meme and the account would have looked like
 * a broken cron job, which is the precise failure the ledger was described as
 * preventing.
 *
 * It is a separate step from planning on purpose, and takes its timestamps from
 * the plan rather than from the clock. A plan that was written but never
 * scheduled must not burn its creative: marking is what happens *after* the
 * posts are accepted, so the two cannot get out of order. Idempotent, so
 * running it twice on the same plan is harmless.
 */
if (process.argv.includes('--mark')) {
  const planned = await readFile(PLAN, 'utf8')
    .then((s) => JSON.parse(s))
    .catch(() => null);
  if (!planned?.posts?.length) {
    console.error(`No plan to mark at ${PLAN}. Run \`npm run plan:ig\` first. Nothing has been written.`);
    process.exit(1);
  }
  const log = await readFile(LEDGER, 'utf8')
    .then((s) => JSON.parse(s))
    .catch(() => ({ posts: [] }));
  const already = new Set(log.posts.map((p) => `${p.asset}@${p.postedAt}`));
  let added = 0;
  for (const p of planned.posts) {
    const key = `${p.asset}@${p.date}`;
    if (already.has(key)) continue;
    log.posts.push({ postedAt: p.date, asset: p.asset, format: p.format });
    already.add(key);
    added += 1;
  }
  log.posts.sort((a, b) => String(a.postedAt).localeCompare(String(b.postedAt)));
  await mkdir(dirname(LEDGER), { recursive: true });
  await writeFile(LEDGER, `${JSON.stringify(log, null, 2)}\n`);
  console.log(
    `Marked ${added} post(s) as spent; the ledger now holds ${log.posts.length}.` +
      (added ? '' : ' Nothing new — this plan was already recorded.'),
  );
  process.exit(0);
}

const files = await readdir(SOCIAL).catch(() => []);
if (!files.length) {
  console.error(
    'social/ is empty — nothing to plan. Build the creative first:\n' +
      '  npm run social && npm run memes && npm run hook && npm run feature\n' +
      'Nothing has been written.',
  );
  process.exit(1);
}

/** What has gone out before, so nothing goes out twice. */
const ledger = await readFile(LEDGER, 'utf8')
  .then((s) => JSON.parse(s))
  .catch(() => ({ posts: [] }));
/**
 * Spent, for now.
 *
 * A fixed joke is spent for good; a screenshot of a live page is spent only
 * until the page has changed under it. So "have I posted this" is really "have I
 * posted this recently enough that it would still look like a repeat", and the
 * answer depends on the format. Anything with no cooloff is spent permanently.
 */
const cooloff = new Map(FORMATS.map((f) => [f.id, f.cooloffDays]));
const isSpent = (asset) =>
  ledger.posts.some((p) => {
    if (p.asset !== asset) return false;
    const days = cooloff.get(p.format);
    if (!days) return true;
    return Date.now() - (Date.parse(p.postedAt) || 0) < days * DAY;
  });
const lastUsed = new Map();
for (const p of ledger.posts) {
  const at = Date.parse(p.postedAt) || 0;
  if (at > (lastUsed.get(p.format) ?? 0)) lastUsed.set(p.format, at);
}

/*
 * A perishable asset has to be fresh, and the first run proved why.
 *
 * The planner happily scheduled a poster reading "Out this week — 4–10 Sep"
 * for the 2nd of October, because social/ had been built weeks earlier and
 * nothing checked. That is the same class of mistake as a page claiming a
 * streaming date it never saw: the creative is not wrong, it is *old*, and old
 * is indistinguishable from wrong to somebody reading it on the day.
 *
 * So the poster is only eligible while it is still this week's poster. Judged
 * on when the file was built rather than by parsing the dates off the caption —
 * the caption's wording belongs to the builder and would silently stop matching
 * the moment it was reworded.
 */
const FRESH_MS = 7 * DAY;
const stale = [];

const inventory = new Map();
for (const format of FORMATS) {
  if (format.manualOnly) {
    const held = files.filter((f) => format.match(f)).length;
    if (held) {
      console.error(
        `  · holding back ${held} ${format.id} post(s): ${format.manualOnly}.\n` +
          '    Still in social/ to post by hand once the numbers are checked.',
      );
    }
    continue;
  }
  const candidates = files
    .filter((f) => format.match(f))
    .filter((f) => format.perishable || !isSpent(f))
    .sort();

  const assets = [];
  for (const asset of candidates) {
    if (format.perishable) {
      const built = await stat(resolve(SOCIAL, asset)).then((s) => s.mtimeMs, () => 0);
      if (Date.now() - built > FRESH_MS) {
        stale.push({ asset, days: Math.round((Date.now() - built) / DAY) });
        continue;
      }
    }
    assets.push(asset);
  }
  if (assets.length) inventory.set(format.id, { format, assets });
}

for (const s of stale) {
  console.error(
    `  ! ${s.asset} was built ${s.days} days ago and names a week that has passed — left out.\n` +
      '    Run `npm run social` to rebuild it for this week.',
  );
}

const captionFor = async (format, asset) => {
  const name = format.caption ? format.caption(asset) : `${asset.replace(/\.png$/, '')}-caption.txt`;
  const text = await readFile(resolve(SOCIAL, name), 'utf8').catch(() => null);
  return text?.trim() ?? null;
};

await mkdir(SERVED, { recursive: true });

const plan = [];
let cursor = Date.now();
let previous = null;

for (let week = 0; week < WEEKS; week += 1) {
  for (const slot of SLOTS) {
    const when = nextSlot(cursor, slot);
    cursor = Date.parse(`${when.date}`);

    /*
     * The choice. Eligible = has an unspent asset, and is not what went out
     * last. Among those, least recently used, with the perishable poster
     * pulled to the front of its week because its value expires.
     */
    const eligible = [...inventory.values()]
      .filter((e) => e.assets.length && e.format.id !== previous)
      .sort((a, b) => {
        if (a.format.perishable !== b.format.perishable) return a.format.perishable ? -1 : 1;
        const seen = (e) => lastUsed.get(e.format.id) ?? 0;
        if (seen(a) !== seen(b)) return seen(a) - seen(b);
        /* Falls back to the declared order, which is why FORMATS is ordered by
           how much work each format does rather than alphabetically. */
        return FORMATS.indexOf(a.format) - FORMATS.indexOf(b.format);
      });

    if (!eligible.length) {
      console.error(
        `\nRan out of unposted creative at slot ${plan.length + 1}. ` +
          'Build more before planning further ahead:\n' +
          '  npm run memes && npm run hook && npm run feature\n' +
          `Wrote the ${plan.length} slot(s) that could be filled.`,
      );
      break;
    }

    /*
     * Take the first eligible format whose asset actually has words beside it.
     *
     * This used to give up on the slot when a caption was missing, which is the
     * wrong failure: one un-captioned image in social/ would silently cost a
     * post. An asset without a caption is not a reason to publish nothing, it is
     * a reason to publish the next thing — and to say which asset was skipped,
     * so the gap gets fixed rather than absorbed.
     */
    let chosen = null;
    for (const entry of eligible) {
      while (entry.assets.length) {
        const asset = entry.assets.shift();
        const caption = await captionFor(entry.format, asset);
        if (caption) {
          chosen = { entry, asset, caption };
          break;
        }
        console.error(`  ! ${asset} has no caption file beside it — skipped.`);
      }
      if (chosen) break;
    }
    if (!chosen) continue;

    const { entry, asset, caption } = chosen;

    await copyFile(resolve(SOCIAL, asset), resolve(SERVED, asset));

    plan.push({
      slot: plan.length + 1,
      date: when.date,
      publicationDate: { dateTime: when.dateTime, timezone: 'Asia/Calcutta' },
      why: slot.why,
      format: entry.format.id,
      asset,
      /* The URL Metricool will fetch. It only exists once the site deploys, so
         the scheduling step has to run after a deploy, not before it. */
      media: [`${SITE}/social/${asset}`],
      type: 'POST',
      text: caption,
      /* Alt text is not decoration: it is how the post reaches somebody using a
         screen reader, and Instagram generates a worse one if none is given. */
      mediaAltText: [altFor(entry.format.id, asset)],
    });

    /* Only mark the format as used once it is in the plan, so a missing caption
       cannot shift the rotation. */
    lastUsed.set(entry.format.id, cursor);
    previous = entry.format.id;
    if (!entry.assets.length && !entry.format.perishable) inventory.delete(entry.format.id);
  }
}

function altFor(format, asset) {
  if (format === 'poster') return 'This week\'s new releases on Indian streaming, listed by platform and date.';
  if (format === 'meme') return 'A joke about how long it takes to find something to watch across streaming apps.';
  if (format === 'feature') return 'A screenshot of the newonott.in release calendar.';
  if (format === 'hook') return 'A card reading that every Indian streaming release is on one page.';
  if (format === 'title') return 'A card answering a common question about an upcoming release.';
  return `Promotional image: ${asset.replace(/\.png$/, '').replace(/-/g, ' ')}.`;
}

await writeFile(
  PLAN,
  `${JSON.stringify({ plannedAt: new Date().toISOString(), site: SITE, posts: plan }, null, 2)}\n`,
);

console.log(`\nThree a week, ${plan.length} planned\n`);
for (const p of plan) {
  console.log(`  ${p.date}  ${p.format.padEnd(10)} ${p.asset}`);
  console.log(`  ${' '.repeat(25)} ${p.why}`);
  console.log(`  ${' '.repeat(25)} ${p.text.split('\n')[0].slice(0, 62)}`);
}
console.log(`\n  plan   data/instagram-plan.json`);
console.log(`  media  public/social/ — served at ${SITE}/social/ once deployed`);
console.log(
  '\n  Nothing has been scheduled. The media URLs above only resolve after a\n' +
    '  deploy, so publish the site first, then schedule against a connected\n' +
    '  account and append what went out to data/instagram-log.json.',
);
