#!/usr/bin/env node
/**
 * Is the site working, right now, for somebody who just clicked an ad?
 *
 * The live audit asks a hundred questions and takes a few seconds. That is
 * the right shape for a daily sweep and the wrong shape for a smoke alarm:
 * it runs once a day, and the morning both edge secrets were unbound the
 * site was broken for eight hours before anyone noticed — found not by a
 * monitor but by the owner typing a film name into his own search box.
 *
 * With paid traffic arriving, eight hours is a bill rather than an
 * embarrassment. So this is the small, fast half, on a short clock: the
 * handful of things whose failure means a visitor is having a bad time.
 *
 * What it deliberately does not check
 *
 * Anything that is only a problem for us. BREVO_API_KEY being unbound
 * matters — it is the staleness alarm's battery — but a reader never
 * notices, and a check that fails every fifteen minutes for a week trains
 * its owner to ignore the alert. That one belongs in the daily audit, which
 * reports it, and it is reported there. This file stays quiet until
 * something a visitor can see is wrong, so that when it does fire it is
 * worth reading.
 *
 * Usage: SITE=https://newonott.in node scripts/health.mjs
 */

const SITE = (process.env.SITE ?? 'https://newonott.in').replace(/\/$/, '');

let checks = 0;
const broken = [];

function ok(condition, label, detail = '') {
  checks += 1;
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    broken.push(`${label}${detail ? ` — ${detail}` : ''}`);
    console.log(`  DOWN ${label}${detail ? `  — ${detail}` : ''}`);
  }
}

async function get(path) {
  try {
    const res = await fetch(`${SITE}${path}`, {
      headers: { 'user-agent': 'newonott-health' },
      signal: AbortSignal.timeout(20_000),
    });
    return { status: res.status, body: await res.text(), headers: res.headers };
  } catch (err) {
    return { status: 0, body: '', headers: new Headers(), error: String(err) };
  }
}

console.log(`Health — ${SITE}`);

/* 1. The page an ad lands on. Nothing else matters if this is not there. */
const home = await get('/');
ok(home.status === 200, 'the homepage answers', `status ${home.status}${home.error ? ` ${home.error}` : ''}`);

/*
 * 2. The bundle, as JavaScript.
 *
 * The specific way this site went fully dark once: a redirect rule sent every
 * hashed asset to a path that did not exist, the SPA fallback answered with
 * index.html, and the browser was handed HTML where it expected a module. The
 * page was blank and the status codes were all 200.
 */
const asset = (home.body.match(/<script[^>]+src="(\/assets\/[^"]+\.js)"/) ?? [])[1];
if (asset) {
  const js = await get(asset);
  ok(
    js.status === 200 && (js.headers.get('content-type') ?? '').includes('javascript'),
    'the app bundle is javascript, not the fallback',
    `${asset} → ${js.status} ${js.headers.get('content-type') ?? ''}`,
  );
} else {
  ok(false, 'the homepage references a bundle', 'no /assets/*.js in the html');
}

/* 3. The board has something on it. An empty feed is a blank site. */
const feed = await get('/data/releases.json');
let rows = 0;
let ageHours = Infinity;
try {
  const parsed = JSON.parse(feed.body);
  rows = (parsed.weeks ?? []).flatMap((w) => w.releases ?? []).length;
  ageHours = (Date.now() - Date.parse(parsed.generatedAt)) / 3_600_000;
} catch {
  /* Reported below. */
}
ok(rows > 50, 'the feed has a calendar on it', `${rows} rows`);
/* Two days, matching the audit: the refresh runs several times a day, so
   this is a stopped scheduler rather than a slow morning. */
ok(ageHours < 48, 'and it is not stale', `${Number.isFinite(ageHours) ? ageHours.toFixed(1) : '?'}h old`);

/*
 * 4. Search, which is the header's promise and the reason for the TMDB
 *    binding. Two queries, not one: a miss on a single title could be TMDB
 *    having a bad minute, while both failing is the credential.
 */
const watchdog = await get('/api/watchdog');
let searchable = false;
try {
  searchable = JSON.parse(watchdog.body).searchable === true;
} catch {
  /* Reported below. */
}
ok(searchable, 'search has its credential', watchdog.body.slice(0, 90) || 'no answer');

const queries = ['shawshank redemption', 'rajinikanth'];
const answers = await Promise.all(queries.map((q) => get(`/api/search?q=${encodeURIComponent(q)}`)));
answers.forEach((res, i) => {
  let hits = 0;
  try {
    hits = (JSON.parse(res.body).results ?? []).length;
  } catch {
    /* Reported by the assertion. */
  }
  ok(hits > 0, `search finds "${queries[i]}"`, `${hits} results, status ${res.status}`);
});

/* 5. A published page, since those are what the ads and the index point at. */
const sitemap = await get('/sitemap.xml');
const first = (sitemap.body.match(/<loc>([^<]+ott-release-date[^<]*)<\/loc>/) ?? [])[1];
if (first) {
  const page = await get(new URL(first).pathname);
  ok(page.status === 200, 'a title page answers', `${new URL(first).pathname} → ${page.status}`);
} else {
  ok(false, 'the sitemap lists title pages', `sitemap status ${sitemap.status}`);
}

console.log(`\n${checks - broken.length}/${checks} healthy`);
if (broken.length) {
  console.log('\nBroken:');
  for (const b of broken) console.log(`  - ${b}`);
}
/* Non-zero is the notification. See the header for why this file is small. */
process.exit(broken.length ? 1 : 0);
