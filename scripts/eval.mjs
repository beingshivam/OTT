#!/usr/bin/env node
/**
 * A grader for what the site actually publishes.
 *
 * The unit tests here cover functions. This covers *claims* — the things a
 * reader would be entitled to believe from the shipped pages and data, checked
 * against the data behind them. Almost every check below exists because the
 * thing it checks for went wrong at least once:
 *
 *   - a "best rated" row that was three English titles, on a site whose whole
 *     design is that languages are never ranked against each other
 *   - a film displayed at a flat 10.0 from 1,029 votes
 *   - a heading asking "when is it coming to OTT?" above an answer saying it
 *     was already streaming
 *   - chips counting rows in one dataset while linking into another
 *   - a page intro inset twenty pixels from the board it heads, for a year,
 *     because of a CSS variable that was never defined
 *
 * None of those were caught by a type or a unit test. They were caught by
 * looking, which does not scale and does not run on a Thursday at 01:00.
 *
 * A check that cannot run reports SKIP rather than PASS: a grader that goes
 * quiet when its input is missing is worse than no grader, because it reports
 * success for work it never inspected.
 *
 * Usage: npm run eval          (after npm run build)
 */

import { appendFile, readFile, readdir, stat } from 'node:fs/promises';
import { slugify } from './slug.mjs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = resolve(ROOT, 'dist');
const REGION = 'IN';

const results = [];
const record = (section, name, status, detail = '', examples = []) =>
  results.push({ section, name, status, detail, examples });
const pass = (s, n, d) => record(s, n, 'PASS', d);
const fail = (s, n, d, ex = []) => record(s, n, 'FAIL', d, ex);
const skip = (s, n, d) => record(s, n, 'SKIP', d);
/**
 * A finding that is worth fixing and not worth withholding a calendar for.
 *
 * This distinction is the whole design of the gate and it was missing, which
 * cost three Fridays. On 22 September the refresh fetched a perfect calendar
 * and refused to publish it because one page out of 356 — /upcoming — had a
 * description seven characters too long to fit the site's name on the end. The
 * site went a day stale over a suffix nobody would have noticed.
 *
 * So there are two kinds of finding now.
 *
 *   fail  the site would tell a reader something untrue: a page claiming a
 *         film streams when it does not, a link into nothing, a score of 9.8
 *         from four votes, a calendar too old to be the calendar. Publishing
 *         that is worse than publishing nothing, so it blocks.
 *
 *   warn  the site would be correct and slightly worse at selling itself: a
 *         missing brand suffix, a description over its display budget, a
 *         sitemap whose dates have stopped distinguishing pages. Every one of
 *         these is worth a fix this week. None is worth a stale week.
 *
 * The test for which is one question: would a reader be misled? If the answer
 * is no, it is a warn, however much it annoys an SEO audit.
 */
const warn = (s, n, d, ex = []) => record(s, n, 'WARN', d, ex);

const readJson = async (p) => JSON.parse(await readFile(p, 'utf8'));
const maybe = async (p) => readJson(p).catch(() => null);

// --- inputs ------------------------------------------------------------------

const TODAY = new Date().toISOString().slice(0, 10);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** A date as the pages spell it — mirrors formatDate in build-seo.mjs. Two
 *  copies of one format is the cost of build-seo being a script that fetches
 *  and writes on import; a page that changes the spelling fails here, loudly,
 *  which is the right way round for a gate. */
const spokenDate = (iso) => {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};

const feed = await maybe(resolve(DIST, 'data/releases.json'));
const catalogue = await maybe(resolve(ROOT, 'public/data/catalogue.json'));
const archive = await maybe(resolve(ROOT, 'data/archive.json'));
const registrySrc = await readFile(resolve(ROOT, 'src/data/platforms.ts'), 'utf8').catch(() => '');
const workerCfg = await readFile(resolve(ROOT, 'wrangler.jsonc'), 'utf8').catch(() => '');
/** Read from the app's own source rather than repeated here, so a rename of the
 *  site cannot leave this grader asserting the old one. */
const BRAND =
  (await readFile(resolve(ROOT, 'src/data/brand.ts'), 'utf8').catch(() => ''))
    .match(/BRAND\s*=\s*'([^']+)'/)?.[1] ?? 'New on OTT';
const PLATFORM_IDS = new Set([...registrySrc.matchAll(/\{\s*id:\s*'([^']+)'/g)].map((m) => m[1]));

/** Every generated page on disk, as path → html. */
async function collectPages(dir = DIST, base = '') {
  const out = new Map();
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === 'assets' || entry.name === 'data') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      for (const [k, v] of await collectPages(full, `${base}/${entry.name}`)) out.set(k, v);
    } else if (entry.name === 'index.html') {
      out.set(base || '/', await readFile(full, 'utf8'));
    }
  }
  return out;
}
const pages = await stat(DIST).then(() => collectPages(), () => null);

const feedRows = feed ? feed.weeks.flatMap((w) => w.releases).filter((r) => r.regions?.includes(REGION)) : [];
const catRows = catalogue?.titles ?? [];

// --- data integrity ----------------------------------------------------------

const S1 = 'Data integrity';

for (const [label, rows] of [['feed', feedRows], ['catalogue', catRows], ['archive', archive?.titles ?? []]]) {
  if (!rows.length) {
    skip(S1, `${label}: rows present`, 'file missing or empty');
    continue;
  }
  const bad = rows.filter(
    (r) => !r.id || !r.title || !/^\d{4}-\d{2}-\d{2}$/.test(r.releaseDate ?? '') || !r.platforms?.length,
  );
  bad.length
    ? fail(S1, `${label}: every row is well formed`, `${bad.length} of ${rows.length} malformed`,
        bad.slice(0, 3).map((r) => `${r.title ?? '(untitled)'} — ${JSON.stringify({ id: r.id, date: r.releaseDate, platforms: r.platforms })}`))
    : pass(S1, `${label}: every row is well formed`, `${rows.length} rows`);

  const seen = new Set();
  const dupes = rows.filter((r) => (seen.has(r.id) ? true : (seen.add(r.id), false)));
  dupes.length
    ? fail(S1, `${label}: no duplicate ids`, `${dupes.length} duplicated`, dupes.slice(0, 3).map((r) => `${r.id} — ${r.title}`))
    : pass(S1, `${label}: no duplicate ids`);

  const unknown = rows.flatMap((r) => (r.platforms ?? []).filter((p) => !PLATFORM_IDS.has(p)));
  unknown.length
    ? fail(S1, `${label}: platforms exist in the registry`, `${new Set(unknown).size} unknown`, [...new Set(unknown)].slice(0, 5))
    : pass(S1, `${label}: platforms exist in the registry`);
}

// --- score honesty -----------------------------------------------------------

const S2 = 'Score honesty';
const IMDB_MIN_VOTES = 1000;
const IMDB_MAX_CREDIBLE = 9.5;
const MAX_CREDIBLE = 9.5;
const TMDB_MIN_VOTES = 50;

/** Mirrors lib/score.ts. Kept as a copy on purpose: a grader that imports the
 *  thing it grades cannot catch that thing being wrong.
 *
 *  Update it deliberately, and only after checking the app was right to change:
 *  the ceiling below arrived here *after* this grader caught the site printing
 *  9.6 from five votes while suppressing 10.0 from a thousand. */
const displayed = (r) => {
  if (r.imdbRating != null && r.imdbVotes != null && r.imdbVotes >= IMDB_MIN_VOTES && r.imdbRating <= IMDB_MAX_CREDIBLE) {
    return { value: r.imdbRating, source: 'IMDb', votes: r.imdbVotes };
  }
  if (r.rating == null || r.rating > MAX_CREDIBLE) return null;
  return { value: r.rating, source: 'TMDB', votes: r.votes };
};

const allRows = [...feedRows, ...catRows];
if (!allRows.length) skip(S2, 'no impossible scores are shown', 'no data');
else {
  const impossible = allRows.filter((r) => {
    const d = displayed(r);
    return d && d.value > IMDB_MAX_CREDIBLE;
  });
  impossible.length
    ? fail(S2, 'no impossible scores are shown', `${impossible.length} above ${IMDB_MAX_CREDIBLE}`,
        impossible.slice(0, 5).map((r) => `${r.title} — ${displayed(r).value} from ${displayed(r).votes} votes`))
    : pass(S2, 'no impossible scores are shown', `checked ${allRows.length} rows`);

  const halfScore = allRows.filter((r) => (r.imdbRating == null) !== (r.imdbVotes == null));
  halfScore.length
    ? fail(S2, 'IMDb rating and vote count travel together', `${halfScore.length} rows have one without the other`,
        halfScore.slice(0, 3).map((r) => `${r.title} — rating ${r.imdbRating}, votes ${r.imdbVotes}`))
    : pass(S2, 'IMDb rating and vote count travel together');

  /**
   * Reported, not failed.
   *
   * The board's stated policy is that a thinly-voted score still shows — in
   * grey, with the count in its tooltip — and only a confident one gets the
   * colour. Failing on these would be the grader asserting a rule the app never
   * made, which is how a check ends up measuring its author's taste instead of
   * the product's promises. The count is worth watching; a jump in it means
   * something upstream changed.
   */
  const thin = allRows.filter((r) => {
    const d = displayed(r);
    return d && d.source === 'TMDB' && d.votes != null && d.votes < TMDB_MIN_VOTES && d.value >= 8;
  });
  record(S2, 'thinly-voted high scores (shown grey, by design)', 'NOTE',
    `${thin.length} row(s) show ≥8.0 on fewer than ${TMDB_MIN_VOTES} votes`,
    thin.slice(0, 3).map((r) => `${r.title} — ${displayed(r).value} from ${displayed(r).votes}`));
}

// --- language fairness -------------------------------------------------------

const S3 = 'Language fairness';
if (!catRows.length) skip(S3, 'ranked lists span more than one language', 'no catalogue');
else {
  const ranked = catRows.filter((r) => r.popRank != null);
  if (!ranked.length) skip(S3, 'ranked lists span more than one language', 'no popularity ranks yet');
  else {
    const top12 = [...ranked].sort((a, b) => a.popRank - b.popRank).slice(0, 12);
    const langs = new Set(top12.map((r) => r.languages?.[0]));
    langs.size >= 3
      ? pass(S3, 'ranked lists span more than one language', `top 12 covers ${langs.size} languages: ${[...langs].join(', ')}`)
      : fail(S3, 'ranked lists span more than one language',
          `top 12 is only ${[...langs].join(', ')} — the failure this design exists to prevent`,
          top12.slice(0, 5).map((r) => `${r.title} (${r.languages?.[0]})`));

    /** A rank is only meaningful within its own language; two Tamil titles both
     *  ranked 3 would mean the rank is measuring something else. */
    const byLang = new Map();
    for (const r of ranked) {
      const l = r.languages?.[0] ?? '?';
      if (!byLang.has(l)) byLang.set(l, []);
      byLang.get(l).push(r.popRank);
    }
    const collides = [...byLang.entries()].filter(([, ranks]) => new Set(ranks).size !== ranks.length);
    collides.length
      ? fail(S3, 'ranks are unique within a language', `${collides.length} language(s) repeat a rank`,
          collides.slice(0, 3).map(([l, ranks]) => `${l}: ${ranks.length} rows, ${new Set(ranks).size} distinct`))
      : pass(S3, 'ranks are unique within a language', `${byLang.size} languages ranked`);
  }

  const noPlatform = catRows.filter((r) => !r.platforms?.length);
  noPlatform.length
    ? fail(S3, 'every catalogue row says where to watch it', `${noPlatform.length} have no platform`, noPlatform.slice(0, 3).map((r) => r.title))
    : pass(S3, 'every catalogue row says where to watch it');
}

// --- published pages ---------------------------------------------------------

const S4 = 'Published pages';
if (!pages) skip(S4, 'pages were generated', 'no dist/ — run npm run build');
else {
  /**
   * A page that tells crawlers not to index it is not a published page, and the
   * checks below are all about what gets published: a canonical URL, a place in
   * the sitemap, a link a crawler can follow. /diag/ is a tool a reader is sent
   * to when the site fails to load on their network — it has no business in a
   * search result and correctly carries noindex.
   *
   * Counted rather than quietly dropped. An exclusion nobody can see is how a
   * grader starts agreeing with whatever it is grading: if a real page ever
   * acquires a noindex by accident, this line is where it shows up.
   */
  // Taken before the split below: a link to a noindex page is still a link that
  // has to land somewhere, and the banner on every page points at /diag/.
  const onDisk = new Set([...pages.keys()]);

  const utility = [...pages].filter(([, html]) => /name="robots"[^>]*noindex/.test(html));
  for (const [path] of utility) pages.delete(path);
  pass(S4, 'pages were generated', `${pages.size} indexable` +
    (utility.length ? `, plus ${utility.length} noindex: ${utility.map(([p]) => p).join(', ')}` : ''));

  const noTitle = [...pages].filter(([, html]) => !/<title>[^<]{5,}<\/title>/.test(html));
  noTitle.length
    ? fail(S4, 'every page has a title', `${noTitle.length} missing`, noTitle.slice(0, 3).map(([p]) => p))
    : pass(S4, 'every page has a title');

  const badH1 = [...pages].filter(([, html]) => (html.match(/<h1[\s>]/g) ?? []).length !== 1);
  badH1.length
    ? fail(S4, 'every page has exactly one h1', `${badH1.length} pages do not`,
        badH1.slice(0, 5).map(([p, html]) => `${p} — ${(html.match(/<h1[\s>]/g) ?? []).length} h1s`))
    : pass(S4, 'every page has exactly one h1');

  /*
   * The brand, on every title and every description.
   *
   * Asked for, and the audit that prompted it found the name in 3 of 355 title
   * tags and none of the descriptions. The generator now adds it centrally
   * (withBrand in build-seo.mjs), which is exactly the kind of rule that holds
   * until someone adds a ninth page type — so it is checked rather than
   * trusted. Noindex pages are already out of `pages` above; /diag is not a
   * result anybody will ever see.
   */
  const noBrandTitle = [...pages].filter(
    ([, html]) => !(html.match(/<title>([^<]*)<\/title>/)?.[1] ?? '').includes(BRAND),
  );
  noBrandTitle.length
    ? warn(S4, 'every title names the site', `${noBrandTitle.length} do not`,
        noBrandTitle.slice(0, 5).map(([p]) => p))
    : pass(S4, 'every title names the site', `${pages.size} pages`);

  const descOf = (html) => html.match(/name="description" content="([^"]*)"/)?.[1] ?? '';
  const noBrandDesc = [...pages].filter(([, html]) => !descOf(html).includes(BRAND));
  noBrandDesc.length
    ? warn(S4, 'every description names the site', `${noBrandDesc.length} do not`,
        noBrandDesc.slice(0, 5).map(([p]) => p))
    : pass(S4, 'every description names the site');

  /*
   * Long enough to say something, short enough to be read.
   *
   * Google shows about 155 characters. Over that is not a penalty, it is
   * waste — the tail is written for nobody — and this caught the homepage at
   * 248 and every title page at 205. The ceiling is loose because a long film
   * name is worth more than a tidy length, and it is the film's name that
   * pushes the last forty over.
   */
  const badLen = [...pages].filter(([, html]) => {
    const d = descOf(html);
    return d.length < 70 || d.length > 210;
  });
  badLen.length
    ? warn(S4, 'descriptions fit a search result', `${badLen.length} outside 70-210 chars`,
        badLen.slice(0, 5).map(([p, html]) => `${p} — ${descOf(html).length}`))
    : pass(S4, 'descriptions fit a search result');

  /*
   * The search URL the structured data promises.
   *
   * The WebSite node carries a SearchAction pointing at /search?q=. That path
   * is not a route this site defines — it works because unrouted paths fall
   * through to the app, which reads ?q= whatever the path is. That is a real
   * behaviour and a fragile one, so it is asserted: a published promise
   * pointing at a dead URL is worse than no promise.
   */
  const home = pages.get('/') ?? '';
  const action = home.match(/"urlTemplate":"([^"]+)"/)?.[1] ?? '';
  const searchPath = action.replace(/^https?:\/\/[^/]+/, '').split('?')[0];
  /* Either the path is a page we generated, or the SPA fallback answers it —
     and that fallback is a line in wrangler.jsonc, not an assumption, so it is
     read rather than believed. The first version of this check accepted
     '/search' by name, which made it pass because it was written to. */
  const spaFallback = /"not_found_handling"\s*:\s*"single-page-application"/.test(workerCfg);
  const servedByApp = spaFallback && searchPath.startsWith('/') && !/\.[a-z0-9]+$/i.test(searchPath);
  const ok =
    action.includes('{search_term_string}') &&
    (onDisk.has(searchPath) || onDisk.has(`${searchPath}/`) || servedByApp);
  ok
    ? pass(S4, 'the searchbox action points somewhere real',
        `${action}${onDisk.has(searchPath) ? '' : ' (via the SPA fallback)'}`)
    : warn(S4, 'the searchbox action points somewhere real',
        action ? `${action} — nothing serves ${searchPath}` : 'no SearchAction found');

  const badCanon = [...pages].filter(([path, html]) => {
    const m = html.match(/rel="canonical" href="([^"]+)"/);
    if (!m) return true;
    const want = path === '/' ? '' : path;
    return !m[1].endsWith(want);
  });
  badCanon.length
    ? fail(S4, 'canonical matches the page it is on', `${badCanon.length} mismatched`,
        badCanon.slice(0, 5).map(([p, html]) => `${p} → ${(html.match(/rel="canonical" href="([^"]+)"/) ?? [])[1] ?? 'none'}`))
    : pass(S4, 'canonical matches the page it is on');

  // Every internal link a crawler can follow must land on a page that exists.
  const broken = new Set();
  for (const [, html] of pages) {
    for (const m of html.matchAll(/href="(\/[^"#?]*)"/g)) {
      const href = m[1].replace(/\/$/, '') || '/';
      if (!onDisk.has(href) && !/\.(png|svg|xml|txt|json|ico|webmanifest|css|js)$/.test(href)) broken.add(href);
    }
  }
  broken.size
    ? fail(S4, 'internal links resolve to real pages', `${broken.size} dead`, [...broken].slice(0, 8))
    : pass(S4, 'internal links resolve to real pages');

  /*
   * And every page a crawler can reach by following them.
   *
   * The links all resolved and 64 pages still could not be got to: 63 title
   * pages that had aged out of the feed window, kept alive by the archive
   * while every list page was built from the window, plus /streaming, which
   * held the entire back catalogue and had simply never been added to the
   * browse nav. A page in the sitemap and nowhere else is crawled rarely and
   * carries no internal weight — and the count was growing by about thirty
   * titles a week, so it would have been most of the site by December.
   *
   * This is a fail rather than a warn, which is a deliberate line: an
   * unreachable page is not the site looking worse, it is the site publishing
   * something a reader cannot get to. Cheap to keep true, and the one shape
   * of breakage that gets worse silently.
   */
  const reachable = new Set(['/']);
  const queue = ['/'];
  while (queue.length) {
    const here = queue.shift();
    for (const m of (pages.get(here) ?? '').matchAll(/href="(\/[^"#?]*)"/g)) {
      const href = m[1].replace(/\/$/, '') || '/';
      if (pages.has(href) && !reachable.has(href)) {
        reachable.add(href);
        queue.push(href);
      }
    }
  }
  const stranded = [...pages.keys()].filter((p) => !reachable.has(p));
  stranded.length
    ? fail(S4, 'every page can be reached by following links', `${stranded.length} unreachable from the homepage`,
        stranded.slice(0, 8))
    : pass(S4, 'every page can be reached by following links', `${reachable.size} pages, all linked`);

  const sitemap = await readFile(resolve(DIST, 'sitemap.xml'), 'utf8').catch(() => '');
  if (!sitemap) skip(S4, 'every sitemap entry exists', 'no sitemap.xml');
  else {
    const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname.replace(/\/$/, '') || '/');
    // Against the indexable set, not everything on disk: a sitemap entry
    // pointing at a page marked noindex is a contradiction worth failing on,
    // not a page that merely exists.
    const missing = locs.filter((l) => !pages.has(l));
    missing.length
      ? fail(S4, 'every sitemap entry exists', `${missing.length} of ${locs.length} are missing or noindex`, missing.slice(0, 5))
      : pass(S4, 'every sitemap entry exists', `${locs.length} entries`);

    /*
     * A date per URL, not one date on every URL.
     *
     * Every entry used to carry the build date, and once the refresh went
     * daily that became "all 354 pages changed today, every day" — a field
     * carrying no information, which Google says it discounts, and which
     * spends the crawl budget evenly across pages that did not move. The
     * dates now come from the archive's changedAt.
     *
     * The check is deliberately loose. It does not assert a distribution, only
     * that the file distinguishes its pages at all: two distinct dates, and
     * not everything stamped with the build. A quiet week where genuinely most
     * pages moved together should not fail a build, and the failure this
     * guards against is the regression to one date, which is unmistakable.
     */
    const stamps = [...sitemap.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)].map((m) => m[1]);
    const distinct = new Set(stamps);
    const allBuilt = feed && stamps.every((d) => d === feed.generatedAt.slice(0, 10));
    !stamps.length
      ? warn(S4, 'sitemap dates tell the pages apart', 'no lastmod at all')
      : distinct.size > 1 && !allBuilt
        ? pass(S4, 'sitemap dates tell the pages apart',
            `${distinct.size} distinct dates across ${stamps.length} URLs`)
        : warn(S4, 'sitemap dates tell the pages apart',
            allBuilt ? 'every URL carries the build date' : `all ${stamps.length} share one date`);
  }
}

// --- what the calendar claims about the future ------------------------------

const S7 = 'Unreleased titles';
{
  /**
   * Nothing can be streaming before it exists.
   *
   * Reported from the live site: a film opening in cinemas on 2 October also
   * carried a Prime badge. TMDB assigns providers *after* a title is available,
   * so a provider on a future theatrical row is never a fact about that film —
   * usually it is the franchise's earlier entries, which really are streaming.
   * The cost of getting this wrong is somebody paying for a subscription to
   * watch something that is not there.
   */
  const today = new Date().toISOString().slice(0, 10);
  const contradictions = feedRows.filter(
    (r) =>
      r.releaseDate > today &&
      r.platforms?.includes('theatres') &&
      r.platforms.some((p) => p !== 'theatres'),
  );
  if (!feedRows.length) skip(S7, 'nothing unreleased is also streaming', 'no feed');
  else
    contradictions.length
      ? fail(S7, 'nothing unreleased is also streaming', `${contradictions.length} in cinemas and streaming at once`,
          contradictions.slice(0, 5).map((r) => `${r.title} — opens ${r.releaseDate}, listed on ${r.platforms.join(', ')}`))
      : pass(S7, 'nothing unreleased is also streaming',
          `${feedRows.filter((r) => r.releaseDate > today).length} future rows checked`);
}

// --- the schedule the site advertises ---------------------------------------

const S6 = 'Refresh schedule';
{
  /**
   * The cron and the copy have to be the same schedule.
   *
   * The workflow decides when the data is rebuilt; lib/freshness.ts decides what
   * the footer tells a reader about it, and derives the weekday names from its
   * own copy of the times so they come out right in the reader's timezone. Two
   * copies of one fact, and the one nobody would notice going wrong is the copy
   * that only shows up as a sentence at the bottom of a page.
   */
  const workflow = await readFile(resolve(ROOT, '.github/workflows/refresh-releases.yml'), 'utf8').catch(() => '');
  const freshness = await readFile(resolve(ROOT, 'src/lib/freshness.ts'), 'utf8').catch(() => '');

  if (!workflow || !freshness) skip(S6, 'the footer promises the schedule that runs', 'file missing');
  else {
    const DAY = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    /* A day field can be a list. `30 4 * * 0,2,3,4` is one line and four runs,
       and the first version of this read only a single digit — so adding the
       daily schedule made the cron look like four runs against freshness's
       eight, and this check failed the build rather than the schedule. It was
       right to fail: it could not see what it was comparing. */
    const cron = [...workflow.matchAll(/cron:\s*'(\d+)\s+(\d+)\s+\*\s+\*\s+([\d,]+)'/g)]
      .flatMap(([, minute, hour, days]) =>
        days.split(',').map((day) => `${day}:${hour}:${minute}`),
      )
      .sort();
    const copy = [...freshness.matchAll(/\{\s*day:\s*(\d+),\s*hour:\s*(\d+),\s*minute:\s*(\d+)\s*\}/g)]
      .map(([, day, hour, minute]) => `${day}:${hour}:${minute}`)
      .sort();

    const show = (list) =>
      list.map((t) => { const [d, h, m] = t.split(':'); return `${DAY[d]} ${h.padStart(2, '0')}:${m.padStart(2, '0')}`; }).join(', ');

    cron.length && cron.join() === copy.join()
      ? pass(S6, 'the footer promises the schedule that runs', `${cron.length} runs: ${show(cron)} UTC`)
      : fail(S6, 'the footer promises the schedule that runs',
          'the cron and lib/freshness.ts disagree',
          [`cron:      ${show(cron) || '(none parsed)'}`, `freshness: ${show(copy) || '(none parsed)'}`]);
  }
}

// --- the claim each title page makes ----------------------------------------

const S5 = 'Title page claims';
if (!pages || !feed) skip(S5, 'streaming status matches the data', 'needs dist/ and the feed');
else {
  /**
   * Joined by slugifying the title, which is how the build decides the URL.
   *
   * The first version joined on the stored `slug` field and reported two pages
   * as orphaned. They were not: a row only carries that field once the build
   * has stamped it onto the shipped feed, and rows that live only in the
   * archive never get stamped — so the check was testing whether a field had
   * been written back, not whether a page had a title behind it.
   */
  /**
   * The cinema listing wins the slug, and its streaming date rides alongside.
   *
   * A film with an announced digital date is two rows sharing one page: the
   * cinema listing the page is built from, and an `~ott` row carrying the date
   * its service has not been attached to yet. Keyed naively, the second
   * overwrote the first and this check then demanded the page say "Streaming
   * now on" — about a film that is not streaming and whose platform nobody
   * knows. The page was right and the check was wrong.
   */
  const bySlug = new Map();
  const datedBySlug = new Map();
  for (const r of [...feedRows, ...(archive?.titles ?? [])]) {
    const key = r.slug ?? slugify(r.title ?? '');
    if (!key) continue;
    if (String(r.id ?? '').endsWith('~ott')) {
      // Region matters here and nowhere else in this map. feedRows is already
      // scoped to India; the archive is not, and The End of Oak Street carries
      // a US digital date and no Indian one. Counting that as the film's
      // streaming date would have failed a page for refusing to publish an
      // American release date to Indian readers — which is the page being
      // right.
      if ((r.regions ?? [REGION]).includes(REGION)) datedBySlug.set(key, r);
      /* A streaming row is the film's date sibling AND, when the film has no
         cinema row, the owner of its page — Ghamasaan exists on ZEE5 and
         nowhere else. Registering it as an owner only when nothing else claims
         the slug keeps the cinema row winning wherever both exist. */
      if (!bySlug.has(key)) bySlug.set(key, r);
      continue;
    }
    bySlug.set(key, r);
  }

  const titlePages = [...pages].filter(([p]) => p.startsWith('/ott-release-date/'));
  const wrong = [];
  const orphan = [];
  for (const [path, html] of titlePages) {
    const slug = path.split('/').pop();
    const row = bySlug.get(slug);
    if (!row) {
      orphan.push(path);
      continue;
    }
    const streams = (row.platforms ?? []).some((p) => p !== 'theatres');
    const dated = datedBySlug.get(slug);
    const saysStreaming = /Streaming now on/.test(html);
    const saysUnannounced = /Not announced yet/.test(html);
    /*
     * The date, not the sentence that carries it.
     *
     * This looked for the literal words "Streaming from", which is what the
     * page said until 7d7b29c taught it to name the service — the lede now
     * reads "Streaming on Netflix from 18 Sep 2026", the words moved apart,
     * and on 18 September this failed two pages that were telling the truth
     * and blocked the whole Friday publish. The rule is about a known date
     * reaching the reader, so that is what it looks for; the page can go on
     * rewording itself without the gate calling it a liar.
     */
    const saysDated = dated ? html.includes(spokenDate(dated.releaseDate)) : false;
    if (streams && saysUnannounced) wrong.push(`${slug} — on ${row.platforms.join(',')} but says "Not announced yet"`);
    if (!streams && saysStreaming) wrong.push(`${slug} — no streaming platform but says "Streaming now"`);
    // A known date must be on the page. This is the question the page exists to
    // answer, and holding an answer back is as much a failure as inventing one.
    if (!streams && dated && dated.releaseDate >= TODAY && !saysDated)
      wrong.push(`${slug} — streams ${dated.releaseDate} and the page does not say so`);
    /*
     * A date and a platform together used to be a contradiction, because every
     * page was a cinema listing and its streaming sibling carried no service.
     * A streaming row dated in the future now says both on purpose — "streaming
     * on Netflix from 18 Sep" is one fact, not two competing ones. What must
     * still never happen is a future date described as already available.
     */
    if (saysStreaming && row.releaseDate > TODAY)
      wrong.push(`${slug} — releases ${row.releaseDate} but says "Streaming now"`);
  }
  wrong.length
    ? fail(S5, 'streaming status matches the data', `${wrong.length} pages contradict their row`, wrong.slice(0, 5))
    : pass(S5, 'streaming status matches the data', `${titlePages.length} title pages`);
  orphan.length
    ? fail(S5, 'every title page has a row behind it', `${orphan.length} orphaned`, orphan.slice(0, 5))
    : pass(S5, 'every title page has a row behind it');

  /*
   * Thin means thin, which is a question about the body text rather than about
   * the cast list. Requiring both fields kept 137 streaming titles off the site
   * while Search Console showed people searching for them by name — so the bar
   * is now the one build-seo publishes against: a synopsis long enough to read
   * as a page, twelve words beside a cast list and twenty-five without one.
   */
  const words = (t) => (t ?? '').trim().split(/\s+/).filter(Boolean).length;
  const thinPages = titlePages.filter(([path]) => {
    const row = bySlug.get(path.split('/').pop());
    if (!row) return false;
    if (!row.synopsis) return true;
    return row.cast?.length ? words(row.synopsis) < 12 : words(row.synopsis) < 25;
  });
  thinPages.length
    ? fail(S5, 'no title page is published thin', `${thinPages.length} thin`, thinPages.slice(0, 5).map(([p]) => p))
    : pass(S5, 'no title page is published thin', `${titlePages.length} pages meet the content bar`);
}

// --- report ------------------------------------------------------------------

const width = Math.max(...results.map((r) => r.name.length)) + 2;
let section = '';
for (const r of results) {
  if (r.section !== section) {
    section = r.section;
    console.log(`\n${section}`);
  }
  const mark =
    r.status === 'PASS' ? ' ok '
    : r.status === 'FAIL' ? 'FAIL'
    : r.status === 'WARN' ? 'warn'
    : r.status === 'NOTE' ? 'note'
    : 'skip';
  console.log(`  ${mark}  ${r.name.padEnd(width)}${r.detail}`);
  for (const ex of r.examples) console.log(`        · ${ex}`);
}

const failed = results.filter((r) => r.status === 'FAIL').length;
const warned = results.filter((r) => r.status === 'WARN');
const skipped = results.filter((r) => r.status === 'SKIP').length;
const passed = results.filter((r) => r.status === 'PASS').length;
console.log(
  `\n${passed} passed, ${failed} failed` +
    (warned.length ? `, ${warned.length} to fix` : '') +
    (skipped ? `, ${skipped} skipped` : '') +
    (failed
      ? ' — the site is publishing something it should not.\n'
      : warned.length
        ? ' — publishing, with the above worth fixing.\n'
        : '\n'),
);

/*
 * Warnings have to reach somebody, or "advisory" just means "ignored".
 *
 * They are the reason a calendar still publishes, so nothing stops if they
 * pile up — which is exactly how a site ends up with eighty pages missing
 * their descriptions and nobody knowing. The run summary is where the refresh
 * already reports, so they go there too, under a heading that says they are
 * not an emergency.
 */
if (warned.length && process.env.GITHUB_STEP_SUMMARY) {
  const lines = [
    `### ${warned.length} thing${warned.length > 1 ? 's' : ''} to fix (published anyway)`,
    '',
    ...warned.flatMap((r) => [`- **${r.name}** — ${r.detail}`, ...r.examples.map((e) => `  - ${e}`)]),
    '',
  ];
  await appendFile(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`).catch(() => {});
}

process.exit(failed ? 1 : 0);
