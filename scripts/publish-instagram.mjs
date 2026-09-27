#!/usr/bin/env node
/**
 * Posts the slot that is due, straight to Instagram, with nothing in between.
 *
 * The scheduling tools all want either a paid tier or a session somebody has to
 * be sitting in. Instagram's own Content Publishing API wants neither: a long
 * -lived token in repo secrets and a workflow that runs at the right minute,
 * and the account posts whether or not anyone is watching. That was the whole
 * ask — three a week without having to do it.
 *
 * It has no scheduling of its own, which shapes everything here. You cannot
 * hand Instagram a time; you call it when you mean to post. So the plan holds
 * the times, the workflow wakes at each of them, and this publishes whichever
 * entry is due. The plan stays the record of intent either way, which is what
 * makes a dry run meaningful.
 *
 * Two calls, and the second is the irreversible one:
 *   1. POST /{ig-user}/media         — hands over the image URL and caption,
 *                                      returns a container id. Nothing public.
 *   2. POST /{ig-user}/media_publish — makes it live. This is the point of no
 *                                      return, and the only call gated by
 *                                      IG_PUBLISH.
 *
 * Refuses to post twice. The ledger is checked before the first call and
 * written after the second, because a post recorded but not sent is a post
 * silently skipped forever, and that is the worse of the two failures.
 *
 * Usage: IG_USER_ID=... IG_ACCESS_TOKEN=... node scripts/publish-instagram.mjs
 *        IG_PUBLISH=1 ...                       (actually go live)
 *        ... --slot 2                           (a specific entry, for testing)
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PLAN = resolve(ROOT, 'data/instagram-plan.json');
const LEDGER = resolve(ROOT, 'data/instagram-log.json');

const API = 'https://graph.facebook.com/v21.0';
const USER = process.env.IG_USER_ID;
const TOKEN = process.env.IG_ACCESS_TOKEN;
/**
 * Off unless explicitly switched on.
 *
 * Every other safety here can be reasoned about; this one is structural. A
 * misconfigured cron, a bad plan, a token pasted into the wrong repo — all of
 * them end at a call that cannot be taken back, in public, under the brand. So
 * the default does everything up to that call and stops, and going live is a
 * deliberate act someone performed once.
 */
const LIVE = process.env.IG_PUBLISH === '1';

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? null : process.argv[i + 1];
};

/** How far either side of its slot a post may still go out. Wide enough to
 *  absorb a queued runner, narrow enough that a stale plan cannot fire a
 *  fortnight late. */
const WINDOW_MS = 6 * 3600_000;

const plan = await readFile(PLAN, 'utf8')
  .then((s) => JSON.parse(s))
  .catch(() => null);
if (!plan?.posts?.length) {
  console.error(`No plan at ${PLAN}. Run \`npm run plan:ig\` first. Nothing has been posted.`);
  process.exit(1);
}

const ledger = await readFile(LEDGER, 'utf8')
  .then((s) => JSON.parse(s))
  .catch(() => ({ posts: [] }));
const done = new Set(ledger.posts.map((p) => `${p.asset}@${p.postedAt}`));

const wanted = arg('slot');
const now = Date.now();
const due = plan.posts.filter((p) => {
  if (done.has(`${p.asset}@${p.date}`)) return false;
  if (wanted) return String(p.slot) === String(wanted);
  return Math.abs(Date.parse(p.date) - now) <= WINDOW_MS;
});

if (!due.length) {
  /* Not an error. Most runs of a thrice-weekly cron have nothing to do, and a
     non-zero exit here would cry wolf until nobody read the red. */
  console.log('Nothing due. The plan holds:');
  for (const p of plan.posts) {
    const state = done.has(`${p.asset}@${p.date}`) ? 'posted' : 'waiting';
    console.log(`  ${p.date}  ${p.format.padEnd(10)} ${state}`);
  }
  process.exit(0);
}

/* One per run. Two posts inside the same hour reads as a bot to a reader and to
   Instagram's own pacing, and the slots are hours apart by design. */
const post = due[0];
if (due.length > 1) {
  console.log(`${due.length} are due; taking slot ${post.slot} and leaving the rest for their own runs.`);
}

if (!USER || !TOKEN) {
  console.error(
    'IG_USER_ID and IG_ACCESS_TOKEN are not both set, so nothing can be posted.\n' +
      'They are the Instagram Business account id and a long-lived access token with\n' +
      'instagram_basic and instagram_content_publish. Nothing has been posted.',
  );
  process.exit(1);
}

const call = async (path, params) => {
  const body = new URLSearchParams({ ...params, access_token: TOKEN });
  const res = await fetch(`${API}/${path}`, { method: 'POST', body });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    /* Graph puts the useful part in error.message and the status alone says
       almost nothing, so surface the message and never the token. */
    const why = json?.error?.message ?? `HTTP ${res.status}`;
    throw new Error(`${path}: ${why}`);
  }
  return json;
};

console.log(`\nSlot ${post.slot} — ${post.format}, due ${post.date}`);
console.log(`  image   ${post.media[0]}`);
console.log(`  caption ${post.text.split('\n')[0]}`);

/*
 * Check the image is actually there before handing Instagram a URL to fetch.
 * It only exists once the site has deployed, and Graph's own error for an
 * unreachable image is generic enough to send somebody looking in the wrong
 * place for an hour.
 */
let head = await fetch(post.media[0], { method: 'HEAD' }).catch(() => null);
/* Some CDNs answer HEAD with 405 while serving the file perfectly well, and
   refusing to post over that would be this check causing the outage it exists
   to prevent. One byte is enough to learn both facts. */
if (!head?.ok) {
  head = await fetch(post.media[0], { headers: { range: 'bytes=0-0' } }).catch(() => null);
}
if (!head?.ok) {
  console.error(
    `\n  ${post.media[0]} is not reachable (${head?.status ?? 'no response'}).\n` +
      '  The media is served by the site, so it has to be committed and deployed before\n' +
      '  publishing. Nothing has been posted.',
  );
  process.exit(1);
}
const type = head.headers.get('content-type') ?? '';
if (!type.includes('jpeg')) {
  console.error(
    `\n  ${post.media[0]} is served as '${type}'. Instagram's publishing API accepts JPEG only\n` +
      '  and rejects PNG. Nothing has been posted.',
  );
  process.exit(1);
}

const container = await call(`${USER}/media`, {
  image_url: post.media[0],
  caption: post.text,
});
console.log(`  container ${container.id}`);

if (!LIVE) {
  console.log(
    '\n  IG_PUBLISH is not set, so it stops here. The container was accepted, which means\n' +
      '  the token, the account and the image all check out — everything except the one\n' +
      '  call that makes it public. Set IG_PUBLISH=1 to go live.',
  );
  process.exit(0);
}

const published = await call(`${USER}/media_publish`, { creation_id: container.id });
console.log(`  published ${published.id}`);

/* After the fact, never before. A post recorded but not sent would be skipped
   forever and nobody would know why. */
ledger.posts.push({
  postedAt: post.date,
  asset: post.asset,
  format: post.format,
  instagramId: published.id,
});
ledger.posts.sort((a, b) => String(a.postedAt).localeCompare(String(b.postedAt)));
await mkdir(dirname(LEDGER), { recursive: true });
await writeFile(LEDGER, `${JSON.stringify(ledger, null, 2)}\n`);

console.log(`\nLive. The ledger now holds ${ledger.posts.length}.`);
