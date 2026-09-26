#!/usr/bin/env node
/**
 * What the site actually does, asked of the site itself.
 *
 * Everything else in this repo tests the thing that was built: the unit tests
 * run against source, the e2e suite drives a browser against ./dist on a
 * loopback port, the eval gate reads the files the build wrote. All of that
 * can pass while the live site is wrong, because between dist and a reader
 * there is a Worker, an edge cache, a DNS record, a deploy that may not have
 * finished and a set of secrets that may not be bound.
 *
 * Those are the failures that have actually happened here. A redirect rule
 * took every hashed asset down for the length of a deploy. A canonical tag
 * pointed at a URL that redirected away from the page, and Search Console
 * indexed nothing for weeks. A missing TMDB binding made search return
 * nothing, which is indistinguishable from a site that simply has less.
 *
 * So this asks the running site, over the public internet, with no access to
 * the repository's own data except to know what to expect. It reports and
 * never gates: a slow edge is not a reason to refuse to publish, and this is
 * the wrong tool to block a deploy with.
 *
 * Usage: node scripts/live-audit.mjs
 *        SITE=https://staging.example node scripts/live-audit.mjs
 *        SAMPLE=all node scripts/live-audit.mjs     (every title page, slower)
 */

const SITE = (process.env.SITE ?? 'https://newonott.in').replace(/\/$/, '');
const SAMPLE = process.env.SAMPLE ?? '60';
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 10);

let checks = 0;
let failures = 0;
const failed = [];

function is(ok, label, detail = '') {
  checks += 1;
  if (ok) {
    console.log(`  ok   ${label}`);
  } else {
    failures += 1;
    failed.push({ label, detail });
    console.log(`  FAIL ${label}${detail ? `  — ${detail}` : ''}`);
  }
  return ok;
}

const section = (name) => console.log(`\n${name}`);

/** One request, never throwing: a network error is a result, not a crash. */
async function get(path, { method = 'GET', redirect = 'manual' } = {}) {
  const url = path.startsWith('http') ? path : `${SITE}${path}`;
  try {
    const res = await fetch(url, {
      method,
      redirect,
      headers: { 'user-agent': 'newonott-live-audit' },
      signal: AbortSignal.timeout(25_000),
    });
    const body = method === 'HEAD' ? '' : await res.text();
    return { ok: res.ok, status: res.status, headers: res.headers, body, url };
  } catch (err) {
    return { ok: false, status: 0, headers: new Headers(), body: '', url, error: String(err) };
  }
}

/** Bounded fan-out. The edge is fast but it is somebody's production site. */
async function pool(items, worker, limit = CONCURRENCY) {
  const out = [];
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const index = i++;
        out[index] = await worker(items[index], index);
      }
    }),
  );
  return out;
}

const tag = (html, re) => (html.match(re) ?? [])[1] ?? null;
const canonicalOf = (html) => tag(html, /rel="canonical"\s+href="([^"]+)"/);
const titleOf = (html) => tag(html, /<title>([^<]*)<\/title>/);
const descOf = (html) => tag(html, /name="description"\s+content="([^"]*)"/);

console.log(`Auditing ${SITE}`);

/* ---------------------------------------------------------------------------
 * Is this even the build we think it is?
 *
 * Every other answer here is worthless without this one. "Deployed" and
 * "serving" are different events, and the gap between them is where most of a
 * day's confusion has gone.
 */
section('The build that is actually serving');
const build = await get('/build.txt');
is(build.status === 200, 'build.txt is served', `status ${build.status}`);
/* "commit <sha>" on the first line, "built <iso>" on the second. The first
   draft of this split on whitespace and took index 0, and duly reported that
   the site was serving a build called "commit". */
const sha = (build.body.match(/commit\s+([0-9a-f]{7,40})/) ?? [])[1] ?? '';
const builtAt = (build.body.match(/built\s+(\S+)/) ?? [])[1] ?? '';
console.log(`       serving ${sha || '(unknown)'}${builtAt ? `, built ${builtAt}` : ''}`);
is(Boolean(sha), 'and names the commit it was built from', build.body.trim().slice(0, 60));

/*
 * Behind the branch, or serving it?
 *
 * "Pushed" and "live" are different events and the gap between them has
 * swallowed more of this project's afternoons than any bug. When the audit is
 * run from CI it knows which commit it was asked about, so it can say plainly
 * whether that is the one answering.
 */
if (process.env.EXPECT_SHA) {
  const want = process.env.EXPECT_SHA.slice(0, sha.length || 40);
  is(
    sha.startsWith(want) || want.startsWith(sha),
    'and it is the commit this audit was run for',
    `serving ${sha.slice(0, 8)}, asked about ${process.env.EXPECT_SHA.slice(0, 8)}`,
  );
}

/* ---------------------------------------------------------------------------
 * The data the whole site is drawn from
 */
section('The data behind it');
const feedRes = await get('/data/releases.json');
is(feedRes.status === 200, 'the feed is served', `status ${feedRes.status}`);

let feed = null;
try {
  feed = JSON.parse(feedRes.body);
} catch {
  /* Reported by the assertion below. */
}
is(Boolean(feed?.weeks?.length), 'and parses as a feed with weeks on it');

if (feed?.generatedAt) {
  const ageHours = (Date.now() - Date.parse(feed.generatedAt)) / 3_600_000;
  console.log(`       generated ${ageHours.toFixed(1)}h ago`);
  /* The refresh runs several times a day. Two days is not "a bit stale", it
     is a broken scheduler, and the homepage would be quietly wrong. */
  is(ageHours < 48, 'and is fresher than two days', `${ageHours.toFixed(1)}h old`);
}

const rows = (feed?.weeks ?? []).flatMap((w) => w.releases ?? []);
console.log(`       ${rows.length} rows across ${feed?.weeks?.length ?? 0} weeks`);

const catRes = await get('/data/catalogue.json');
is(catRes.status === 200, 'the back catalogue is served', `status ${catRes.status}`);
let catalogue = null;
try {
  catalogue = JSON.parse(catRes.body);
} catch {
  /* Below. */
}
is(Boolean(catalogue?.titles?.length), 'and has titles on it', `${catalogue?.titles?.length ?? 0}`);

/* ---------------------------------------------------------------------------
 * Every published URL, from the site's own sitemap
 *
 * The sitemap is the list of pages this site has told Google exist. A 404 or a
 * redirect on any of them is a promise broken to the one reader who matters
 * most, and nothing in the build can see it.
 */
section('Every page the sitemap promises');
const sitemap = await get('/sitemap.xml');
is(sitemap.status === 200, 'sitemap.xml is served', `status ${sitemap.status}`);

const locs = [...sitemap.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
is(locs.length > 100, 'and lists the site', `${locs.length} urls`);

const paths = locs.map((u) => new URL(u).pathname);
const titlePaths = paths.filter((p) => p.startsWith('/ott-release-date/'));
const otherPaths = paths.filter((p) => !p.startsWith('/ott-release-date/'));
console.log(`       ${otherPaths.length} section pages, ${titlePaths.length} title pages`);

/* Section pages are few and carry the site's structure, so all of them, in
   full, with their canonical read. */
const sectionResults = await pool(otherPaths, async (p) => ({ p, res: await get(p) }));

const notOk = sectionResults.filter((r) => r.res.status !== 200);
is(notOk.length === 0, 'every section page returns 200', notOk.map((r) => `${r.p}=${r.res.status}`).join(' '));

/*
 * The canonical has to be the URL that served the page.
 *
 * This is the exact failure that cost this site its indexing once: the edge
 * redirected /theatres to /theatres/ and the page there declared its canonical
 * to be /theatres — telling Google, on 128 pages, that the real version of the
 * page is a URL that redirects away from it.
 */
const badCanonical = sectionResults.filter(
  (r) => r.res.status === 200 && canonicalOf(r.res.body) !== `${SITE}${r.p === '/' ? '/' : r.p}`,
);
is(
  badCanonical.length === 0,
  'and declares itself its own canonical',
  badCanonical.slice(0, 4).map((r) => `${r.p} -> ${canonicalOf(r.res.body)}`).join(' | '),
);

const noTitle = sectionResults.filter((r) => r.res.status === 200 && !titleOf(r.res.body));
is(noTitle.length === 0, 'and has a title', noTitle.map((r) => r.p).join(' '));

const noDesc = sectionResults.filter((r) => r.res.status === 200 && !descOf(r.res.body));
is(noDesc.length === 0, 'and a description', noDesc.map((r) => r.p).join(' '));

/* A description still carrying {n} is a template that never got its number —
   it has shipped before and reads as a bug to anybody who sees it in a SERP. */
const unfilled = sectionResults.filter((r) => /\{n\}/.test(descOf(r.res.body) ?? ''));
is(unfilled.length === 0, 'with its placeholders filled in', unfilled.map((r) => r.p).join(' '));

/* Title pages: a sample by default, because 985 requests is a minute of
   somebody's edge and the failure mode is systemic rather than per-page. */
const sample =
  SAMPLE === 'all'
    ? titlePaths
    : titlePaths.filter((_, i) => i % Math.ceil(titlePaths.length / Number(SAMPLE)) === 0);
const titleResults = await pool(sample, async (p) => ({ p, res: await get(p) }));
const titleBad = titleResults.filter((r) => r.res.status !== 200);
is(
  titleBad.length === 0,
  `${sample.length} sampled title pages all return 200`,
  titleBad.slice(0, 5).map((r) => `${r.p}=${r.res.status}`).join(' '),
);
const titleCanon = titleResults.filter(
  (r) => r.res.status === 200 && canonicalOf(r.res.body) !== `${SITE}${r.p}`,
);
is(
  titleCanon.length === 0,
  'and each is its own canonical',
  titleCanon.slice(0, 3).map((r) => `${r.p} -> ${canonicalOf(r.res.body)}`).join(' | '),
);

/* Structured data is the reason several of these pages rank at all. It is also
   the easiest thing in the build to break without noticing, because nothing
   renders it. */
const badLd = titleResults.filter((r) => {
  if (r.res.status !== 200) return false;
  const blocks = [...r.res.body.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  if (!blocks.length) return true;
  return blocks.some((b) => {
    try {
      JSON.parse(b[1]);
      return false;
    } catch {
      return true;
    }
  });
});
is(badLd.length === 0, 'and carries valid JSON-LD', badLd.slice(0, 3).map((r) => r.p).join(' '));

/* ---------------------------------------------------------------------------
 * The edge's own rules
 */
section('The rules the edge enforces');

const slashed = await get('/action/');
is(
  slashed.status === 301 || slashed.status === 308,
  'a trailing slash redirects rather than serving a second copy',
  `status ${slashed.status}`,
);
is(
  (slashed.headers.get('location') ?? '').endsWith('/action'),
  'and lands on the canonical form',
  slashed.headers.get('location') ?? 'no location',
);

const shouty = await get('/ACTION');
is(
  shouty.status === 301 || shouty.status === 308,
  'capitals redirect to one casing',
  `status ${shouty.status}`,
);

/*
 * The exception that took the site down once: hashed bundles are named
 * index-CqG28YpW.js, and a redirect rule on capitals alone 301'd every one of
 * them to a path that does not exist. An asset must keep its capitals.
 */
const home = await get('/');
is(home.status === 200, 'the homepage is served', `status ${home.status}`);
const assetHref = tag(home.body, /<script[^>]+src="(\/assets\/[^"]+\.js)"/);
if (assetHref) {
  const asset = await get(assetHref);
  is(asset.status === 200, 'the app bundle is served', `${assetHref} = ${asset.status}`);
  is(
    (asset.headers.get('content-type') ?? '').includes('javascript'),
    'as JavaScript, not as the SPA fallback',
    asset.headers.get('content-type') ?? 'none',
  );
  is(/[A-Z]/.test(assetHref) ? asset.status === 200 : true, 'with its capitals intact', assetHref);
}

const missing = await get('/this-page-does-not-exist-9f2b');
is(missing.status === 200, 'an unknown path serves the app rather than a 404', `status ${missing.status}`);

/* ---------------------------------------------------------------------------
 * The Worker's API surface
 */
section('The routes that only exist at the edge');

const watchdog = await get('/api/watchdog');
is(watchdog.status === 200, '/api/watchdog answers', `status ${watchdog.status}`);
let wd = {};
try {
  wd = JSON.parse(watchdog.body);
} catch {
  /* Below. */
}
is(wd.searchable === true, 'search has its TMDB credential bound', JSON.stringify(wd));
is(wd.armed === true, 'the freshness watchdog can send its alert', JSON.stringify(wd));

/* Search, in the words a reader types. A miss on a famous film is the header
   writing a cheque the route cannot cash. */
const queries = ['shawshank redemption', 'coolie', 'jawan', 'rajinikanth', '3 idiots'];
const searches = await pool(queries, async (q) => ({ q, res: await get(`/api/search?q=${encodeURIComponent(q)}`) }));
for (const { q, res } of searches) {
  let b = {};
  try {
    b = JSON.parse(res.body);
  } catch {
    /* Below. */
  }
  is(res.status === 200 && !b.degraded, `search answers "${q}"`, b.degraded ? 'degraded' : `status ${res.status}`);
  is((b.results ?? []).length > 0, `and finds something for "${q}"`, `${(b.results ?? []).length} results`);
}

const nonsense = await get('/api/search?q=zzqqxxnotathing');
const nonsenseBody = JSON.parse(nonsense.body || '{}');
is(
  nonsense.status === 200 && (nonsenseBody.results ?? []).length === 0,
  'and a genuine miss is an empty answer, not an error',
  `status ${nonsense.status}`,
);

/* A title, a person, and the ids they hand each other. */
const title = await get('/api/title?id=m-278');
let tb = {};
try {
  tb = JSON.parse(title.body);
} catch {
  /* Below. */
}
is(title.status === 200 && tb.title, 'a title opens', `status ${title.status}`);
is(Array.isArray(tb.cast) && tb.cast.length > 0, 'with a cast on it', `${(tb.cast ?? []).length}`);
is(Array.isArray(tb.similar) && tb.similar.length > 0, 'and somewhere to go next', `${(tb.similar ?? []).length}`);

const badTitle = await get('/api/title?id=nonsense');
is(badTitle.status === 400, 'a made-up title id is refused', `status ${badTitle.status}`);

const person = await get('/api/person?id=p-35742');
let pb = {};
try {
  pb = JSON.parse(person.body);
} catch {
  /* Below. */
}
is(person.status === 200 && pb.name, 'a person opens', `status ${person.status}`);
is((pb.credits ?? []).length > 0, 'with a filmography', `${(pb.credits ?? []).length} credits`);

const badPerson = await get('/api/person?id=m-1');
is(badPerson.status === 400, 'a made-up person id is refused', `status ${badPerson.status}`);

/* The one route that writes. Not exercised with a real address — this runs
   daily and would fill the list with junk — but it should still be the shape
   it claims: a POST-only endpoint that refuses everything else. */
const subscribeGet = await get('/api/subscribe');
is(
  subscribeGet.status === 405,
  'the signup endpoint takes POST and nothing else',
  `GET returned ${subscribeGet.status}`,
);

/* ---------------------------------------------------------------------------
 * The genre browse, and whether the page above it agrees with it
 */
section('A genre, and whether the page agrees with itself');

const GENRES = ['action', 'comedy', 'crime', 'horror', 'romance', 'thriller'];
const browses = await pool(GENRES, async (g) => ({ g, res: await get(`/api/browse?g=${g}`) }));

for (const { g, res } of browses) {
  let b = {};
  try {
    b = JSON.parse(res.body);
  } catch {
    /* Below. */
  }
  const results = b.results ?? [];
  is(res.status === 200 && !b.degraded, `/api/browse answers for ${g}`, b.degraded ? 'degraded' : `status ${res.status}`);
  is(results.length > 0, `and returns titles for ${g}`, `${results.length}`);
  is(b.total > results.length, `and knows the genre is bigger than one page (${g})`, `total ${b.total}`);
  is(
    results.every((r) => /^[mt]-\d+$/.test(r.id ?? '')),
    `every ${g} tile carries an id the sheet can open`,
    results.slice(0, 2).map((r) => r.id).join(' '),
  );
  is(
    results.every((r) => r.image),
    `and a poster (${g})`,
    `${results.filter((r) => !r.image).length} without`,
  );
  console.log(`       ${g}: ${b.total} streaming in India`);
}

const badGenre = await get('/api/browse?g=drama');
is(badGenre.status === 400, 'a genre with no page is refused', `status ${badGenre.status}`);

/*
 * The number the page prints, against the number it has.
 *
 * Collection descriptions are generated with {n} filled in from the feed at
 * build time. If the feed has moved on and the page has not been rebuilt, the
 * page states a count it cannot show — which is precisely the kind of quiet
 * contradiction this audit exists for.
 */
if (feed && rows.length) {
  const GENRE_LABEL = {
    action: 'Action', comedy: 'Comedy', crime: 'Crime',
    horror: 'Horror', romance: 'Romance', thriller: 'Thriller',
  };
  for (const g of GENRES) {
    const page = sectionResults.find((r) => r.p === `/${g}`);
    if (!page || page.res.status !== 200) continue;
    const claimed = Number((descOf(page.res.body) ?? '').match(/(\d[\d,]*)/)?.[1]?.replace(/,/g, '') ?? 0);
    /* India only, which is what the page counts. The first run of this audit
       compared against every row in the feed, reported five genre pages as
       under-counting, and was wrong five times: /action says 41 because 41 of
       its 64 action rows are released in India, and the page is right. An
       audit that cries wolf about the thing it exists to watch is worse than
       no audit. */
    const actual = rows.filter(
      (r) => (r.genres ?? []).includes(GENRE_LABEL[g]) && (r.regions ?? []).includes('IN'),
    ).length;
    /* Within a day's churn rather than exact: the feed refreshes several
       times a day and the page is rebuilt on deploy, so a handful of rows
       apart is normal and a hundred is a stale build. */
    is(
      claimed > 0 && Math.abs(claimed - actual) <= Math.max(15, actual * 0.15),
      `/${g} states a count its own feed supports`,
      `page says ${claimed}, feed has ${actual}`,
    );
  }
}

/* ---------------------------------------------------------------------------
 * Images, which are most of the page's weight and all of its look
 */
section('Artwork');

/*
 * Two paths, on purpose, and both have to work.
 *
 * The board's posters are plain <img> tags pointing straight at TMDB's CDN;
 * only the share card goes through /img/, because a canvas cannot read back a
 * cross-origin image and image.tmdb.org sends no CORS header. That is a
 * deliberate trade — a hop per poster would put every thumbnail on the page
 * through the Worker's request budget — but it means the site depends on two
 * separate image origins and a check of one proves nothing about the other.
 *
 * The first run of this audit only knew about the proxy, found no proxied
 * poster in the feed, and printed a shrug where a check should have been.
 */
const direct = rows.find((r) => r.posterUrl?.startsWith('https://image.tmdb.org/'))?.posterUrl;
if (direct) {
  const res = await get(direct);
  is(res.status === 200, "the board's own poster host answers", `${res.status}`);
  is(
    (res.headers.get('content-type') ?? '').startsWith('image/'),
    'with an image',
    res.headers.get('content-type') ?? 'none',
  );

  /* The same file through our origin. If these disagree the share card and
     the page are drawing different artwork for the same film. */
  const path = new URL(direct).pathname.replace(/^\/t\/p\//, '/img/');
  const proxied = await get(path);
  is(proxied.status === 200, 'and the same file comes through our proxy', `${path} = ${proxied.status}`);
  is(
    (proxied.headers.get('cache-control') ?? '').includes('immutable'),
    'cached as immutable, since a TMDB path is content-addressed',
    proxied.headers.get('cache-control') ?? 'none',
  );
} else {
  is(false, 'the feed has a poster to check', 'no posterUrl on any row');
}

/*
 * The proxy is narrow on purpose: an open one is somebody else's bandwidth
 * bill and a way into networks that trust this origin. A path that does not
 * look exactly like a TMDB image path must not be forwarded.
 *
 * Not "/img/w500/../../etc/passwd" — the first draft used that and it passed
 * through as a 200, which looked alarming and was nothing: fetch normalises
 * the dot segments away before the request leaves, so the Worker was asked
 * for /etc/passwd, never matched /img/, and got the SPA fallback like any
 * other unknown path. A traversal test that never reaches the code it is
 * testing is worse than no test. These stay inside /img/.
 */
for (const bad of [
  '/img/w500/notaposter.txt',
  '/img/w500/short.jpg',
  '/img/hacker/aaaaaaaaaaaa.jpg',
  '/img/w500/%2e%2e%2f%2e%2e%2fetc%2fpasswd',
]) {
  const res = await get(bad);
  is(res.status >= 400, `the proxy refuses ${bad}`, `status ${res.status}`);
}

/* ---------------------------------------------------------------------------
 * Where the links go
 *
 * Internal links are the site's own claim about what exists. A dead one is
 * both a reader hitting a wall and crawl budget spent on nothing.
 */
section('Where the homepage says you can go');
const hrefs = [...home.body.matchAll(/href="(\/[^"#?]*)"/g)]
  .map((m) => m[1])
  .filter((h) => !h.startsWith('/assets/') && !/\.(js|css|png|svg|ico|xml|txt|json|webmanifest)$/.test(h));
const uniqueHrefs = [...new Set(hrefs)];
const linkResults = await pool(uniqueHrefs, async (h) => ({ h, res: await get(h, { method: 'HEAD' }) }));
const deadLinks = linkResults.filter((r) => r.res.status >= 400 || r.res.status === 0);
is(
  deadLinks.length === 0,
  `all ${uniqueHrefs.length} internal links from the homepage resolve`,
  deadLinks.slice(0, 5).map((r) => `${r.h}=${r.res.status}`).join(' '),
);

const redirectingLinks = linkResults.filter((r) => r.res.status >= 300 && r.res.status < 400);
is(
  redirectingLinks.length === 0,
  'and none of them redirects on the way',
  redirectingLinks.slice(0, 5).map((r) => `${r.h}->${r.res.headers.get('location')}`).join(' '),
);

/* ---------------------------------------------------------------------------
 * The feeds other things read
 */
section('The feeds other things read');
for (const [path, label] of [
  ['/robots.txt', 'robots.txt'],
  ['/changes.xml', 'the changes feed'],
  ['/data/logos.json', 'the platform logos'],
]) {
  const res = await get(path);
  is(res.status === 200, `${label} is served`, `status ${res.status}`);
}

const robots = await get('/robots.txt');
is(
  robots.body.includes(`${SITE}/sitemap.xml`),
  'robots.txt points at the sitemap',
  robots.body.trim().slice(0, 80),
);

/*
 * The crawl rules, read off the served file rather than the built one.
 *
 * eval checks these at build time against dist/. This checks the copy Google
 * actually fetches, which is the one that counts — a stale deploy, an edge
 * rule or a hand-edit in a dashboard can all put a different robots.txt in
 * front of a crawler than the one in the repo, and none of them would show up
 * in a build.
 */
const disallows = [...robots.body.matchAll(/^Disallow:\s*(\S+)\s*$/gm)].map((m) => m[1]);
for (const rule of ['/api/', '/diag']) {
  is(disallows.includes(rule), `and keeps ${rule} out of the index`, disallows.join(' ') || 'no rules');
}

/*
 * The dangerous direction. A Disallow is longest-prefix-wins, so one that is
 * a character too short silently outranks "Allow: /" and deletes real pages
 * from the index — "/d" would take /documentaries with it. Checked against
 * the live sitemap because both files have to be right *together*, and they
 * are served independently.
 */
const blocked = paths.filter((p) => disallows.some((d) => p.startsWith(d)));
is(
  blocked.length === 0,
  'and blocks nothing the sitemap publishes',
  `${blocked.length} blocked, e.g. ${blocked.slice(0, 3).join(' ')}`,
);

/* --------------------------------------------------------------------------- */
console.log(`\n${checks - failures} passed, ${failures} failed`);
if (failures) {
  console.log('\nWhat to look at:');
  for (const f of failed) console.log(`  - ${f.label}${f.detail ? `: ${f.detail}` : ''}`);
}
/* Reports, never gates — see the header. Exit 0 either way so this can be
   wired anywhere without becoming something that blocks a publish. */
