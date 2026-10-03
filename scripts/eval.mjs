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

/**
 * Severity by blast radius, for the checks that count bad pages.
 *
 * A failing gate here does not stop a bad page existing — it stops the whole
 * calendar updating, and the offending page stays live exactly as it was, now
 * staler. So withholding can never repair the thing it fired about; it can
 * only withhold the improvements to every other page.
 *
 * That trade was made badly once and it cost two days. One title page out of
 * 2,190 contradicted its row, the refresh aborted on it, and the site served a
 * 49-hour-old calendar behind a gate that — on that occasion — was itself
 * wrong. Three workflows went red over one page nobody could have fixed by
 * keeping the data frozen.
 *
 * So: a handful of pages is a warning, published and reported, because
 * shipping the other 2,189 fresh is strictly better than shipping none. A
 * large share is still a hard failure, because that is not an edge case in the
 * data, it is the generator having broken, and shipping that would replace
 * good pages with bad ones at scale.
 *
 * The line is calibrated against the real regression rather than picked. When
 * the arrived-sibling code path was broken it produced ten bad pages — 0.46%
 * of the site — and a first attempt at this rule put the line at 0.5% and 25
 * pages, which let that exact regression through as a warning. A whole code
 * path failing has to stop the build, so the line sits below it: five pages,
 * or a fifth of a percent.
 *
 * That is "a few rows have an odd shape", not a budget for known-wrong pages.
 * Warnings are reported every run and are meant to be spent, not banked.
 */
const BOUNDED_SHARE = 0.002;
const BOUNDED_MAX = 5;

const byBlastRadius = (section, name, bad, total, detail, examples = []) => {
  const systemic = bad > BOUNDED_MAX || (total > 0 && bad / total > BOUNDED_SHARE);
  return systemic
    ? fail(section, name, `${detail} — too many to be an edge case`, examples)
    : warn(section, name, detail, examples);
};

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
/* The shipped copy, like the feed above: the build stamps slugs into it, and
   reading the source instead meant every collision-suffixed catalogue page
   looked orphaned because this re-derived the bare slug from the title. */
const catalogue = await maybe(resolve(DIST, 'data/catalogue.json'));
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
    ? byBlastRadius(S2, 'no impossible scores are shown', impossible.length, allRows.length,
        `${impossible.length} of ${allRows.length} above ${IMDB_MAX_CREDIBLE}`,
        impossible.slice(0, 5).map((r) => `${r.title} — ${displayed(r).value} from ${displayed(r).votes} votes`))
    : pass(S2, 'no impossible scores are shown', `checked ${allRows.length} rows`);

  const halfScore = allRows.filter((r) => (r.imdbRating == null) !== (r.imdbVotes == null));
  halfScore.length
    ? byBlastRadius(S2, 'IMDb rating and vote count travel together', halfScore.length, allRows.length,
        `${halfScore.length} of ${allRows.length} rows have one without the other`,
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

  /**
   * And the machine-readable half has to agree with the visible one.
   *
   * A page that greys a score because thirty people voted on it, while telling
   * Google in JSON-LD that it is an aggregate rating worth putting stars on, is
   * arguing with itself in the one place a reader cannot see and a crawler can.
   * That is a worse version of the thin-score problem, not a smaller one: the
   * hedge is the honest part, and structured data that drops it is the site
   * making a claim it has already decided it does not believe.
   *
   * Every rating is checked, not sampled, and so is its attribution — the
   * number is TMDB's crowd and markup that omits the source is claiming it.
   */
  if (!pages) skip(S2, 'no page rates a title more confidently than it shows it', 'needs dist/');
  else {
    const offences = [];
    for (const [path, html] of pages) {
      for (const [, raw] of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
        let parsed;
        try {
          parsed = JSON.parse(raw);
        } catch {
          offences.push(`${path} — unparseable JSON-LD`);
          continue;
        }
        for (const node of parsed['@graph'] ?? [parsed]) {
          const ar = node?.aggregateRating;
          if (!ar) continue;
          if (!(ar.ratingCount >= TMDB_MIN_VOTES)) {
            offences.push(`${path} — ${ar.ratingValue} on ${ar.ratingCount} votes`);
          } else if (ar.ratingValue > MAX_CREDIBLE) {
            offences.push(`${path} — ${ar.ratingValue} is above the credible ceiling`);
          } else if (!ar.author?.name) {
            offences.push(`${path} — rating with no source named`);
          }
        }
      }
    }
    offences.length
      ? byBlastRadius(S2, 'no page rates a title more confidently than it shows it', offences.length, pages.size,
          `${offences.length} page(s) assert a score the page itself hedges`, offences.slice(0, 5))
      : pass(S2, 'no page rates a title more confidently than it shows it',
          `every emitted rating clears ${TMDB_MIN_VOTES} votes and names its source`);
  }
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
      ? byBlastRadius(S7, 'nothing unreleased is also streaming', contradictions.length, future.length,
          `${contradictions.length} in cinemas and streaming at once`,
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

const S13 = 'How the long tail is reached';
{
  /**
   * A page a crawler cannot walk to is a page that does not rank, whatever
   * the sitemap says.
   *
   * The title pages are the point of this site — "where to watch X" is very
   * nearly the only way anybody arrives — and they were reached like this:
   * 754 of 997 had exactly one inbound link, and 651 of those came from
   * /streaming alone. A single page with 651 links out passes almost nothing
   * to each and is precisely the shape a crawler goes shallow on. The whole
   * long tail was hanging off the weakest hook on the site.
   *
   * It was invisible because nothing counted. The sitemap listed every page,
   * every page returned 200, and the orphan check passed — all true, and none
   * of it about whether the pages could be *reached*.
   *
   * Orphans fail. A rising share of single-linked pages warns rather than
   * fails, because it drifts with the data rather than with a mistake: a
   * quiet week genuinely has fewer hubs covering it.
   */
  if (!pages) skip(S13, 'every title page is reachable from another page', 'needs dist/');
  else {
    const titles = new Set();
    for (const [path] of pages) if (path.startsWith('/ott-release-date/')) titles.add(path);

    const inbound = new Map();
    for (const [from, html] of pages) {
      for (const [, href] of html.matchAll(/href="(\/ott-release-date\/[a-z0-9-]+)"/g)) {
        if (!inbound.has(href)) inbound.set(href, new Set());
        inbound.get(href).add(from);
      }
    }

    const orphans = [...titles].filter((t) => !(inbound.get(t)?.size > 0));
    orphans.length
      ? byBlastRadius(S13, 'every title page is reachable from another page', orphans.length, titles.size,
          `${orphans.length} are linked from nowhere`, orphans.slice(0, 5))
      : pass(S13, 'every title page is reachable from another page', `${titles.size} pages`);

    const lonely = [...titles].filter((t) => (inbound.get(t)?.size ?? 0) === 1);
    const share = titles.size ? lonely.length / titles.size : 0;
    const avg = titles.size
      ? [...titles].reduce((s, t) => s + (inbound.get(t)?.size ?? 0), 0) / titles.size
      : 0;
    share > 0.25
      ? warn(S13, 'and from more than one place',
          `${lonely.length} of ${titles.size} hang off a single link`, lonely.slice(0, 5))
      : pass(S13, 'and from more than one place',
          `${lonely.length} single-linked, ${avg.toFixed(1)} inbound on average`);
  }
}

const S12 = 'Dates the site can vouch for';
{
  /**
   * "Streaming since" is a claim about a service, and it needs evidence.
   *
   * Reported from the Breaking Bad page: "STREAMING SINCE 20 January 2008 ·
   * 6825 days ago". The relative day was the complaint and the smaller half
   * of it — six thousand days is a subtraction, not an insight. The claim
   * above it was wrong. 20 January 2008 is when Breaking Bad first aired on
   * AMC; Netflix did not launch in India until 2016, and nothing in this
   * repo records when the show reached it.
   *
   * A back-catalogue row carries the title's own release date, never a
   * platform's, and 402 of the 658 catalogue titles are pre-2020 — so most
   * of that shelf was dating a streaming arrival it had never observed.
   *
   * The window is ninety days, past the eight weeks the feed holds, and it
   * has to be enforced on the rendered page because two separate renderers
   * produce it: build-seo.mjs for the crawler and ReleaseDatePage for the
   * reader. They have drifted apart once already, on this exact block.
   */
  if (!pages) skip(S12, 'no page dates a streaming arrival it never saw', 'needs dist/');
  else {
    const DAY = 86_400_000;
    const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
    const overreach = [];
    for (const [path, html] of pages) {
      const m = html.match(/<strong>Streaming since:<\/strong>\s*(\d{1,2}) (\w{3}) (\d{4})/);
      if (!m) continue;
      const when = Date.UTC(Number(m[3]), MONTHS[m[2]] ?? 0, Number(m[1]));
      const age = Math.floor((Date.parse(`${TODAY}T00:00:00Z`) - when) / DAY);
      if (age > 90) overreach.push(`${path} — "Streaming since ${m[0].split('</strong>')[1].trim()}", ${age} days old`);
    }
    overreach.length
      ? byBlastRadius(S12, 'no page dates a streaming arrival it never saw', overreach.length, pages.size,
          `${overreach.length} pages claim a streaming date older than the calendar`, overreach.slice(0, 5))
      : pass(S12, 'no page dates a streaming arrival it never saw',
          `${pages.size} pages checked`);

    /* And the relative day, which is the half that was reported. It is news
       for a few weeks and arithmetic after that. */
    const absurd = [];
    for (const [path, html] of pages) {
      for (const [, n] of html.matchAll(/(\d{3,})\s+days ago/g)) {
        absurd.push(`${path} — "${n} days ago"`);
      }
    }
    absurd.length
      ? byBlastRadius(S12, 'and none counts the days since 2008', absurd.length, pages.size,
          `${absurd.length} pages print a four-figure day count`, absurd.slice(0, 5))
      : pass(S12, 'and none counts the days since 2008');
  }
}

const S11 = 'One page, one claim';
{
  /**
   * No two published pages may say the same thing.
   *
   * Distinct URLs carrying an identical title and description is what Google
   * reads as duplicate content: it picks one, drops the other, and the
   * dropped page is crawl budget this site already spent. With paid traffic
   * arriving that is worse than waste — it is two of your own pages
   * competing to answer the same query.
   *
   * It had happened five times and nothing could see it. The slug collision
   * resolver gave two different films called Mayday their own URLs, /mayday
   * and /mayday-2026, and then built both tags from the title — which is
   * genuinely identical, because the films genuinely share a name. The URLs
   * were distinct and everything a search engine reads was not.
   *
   * Checked over what actually shipped rather than over the data, because
   * this is a property of the rendered page and every template feeding it.
   */
  if (!pages) skip(S11, 'no two pages carry the same title', 'needs dist/');
  else {
    const titled = new Map();
    const described = new Map();
    for (const [path, html] of pages) {
      const t = (html.match(/<title>([^<]*)<\/title>/) ?? [])[1] ?? '';
      const d = (html.match(/name="description"\s+content="([^"]*)"/) ?? [])[1] ?? '';
      if (t) titled.set(t, [...(titled.get(t) ?? []), path]);
      if (d) described.set(d, [...(described.get(d) ?? []), path]);
    }
    const dupT = [...titled.values()].filter((p) => p.length > 1);
    const dupD = [...described.values()].filter((p) => p.length > 1);

    dupT.length
      ? byBlastRadius(S11, 'no two pages carry the same title', dupT.length, pages.size,
          `${dupT.length} titles are shared`,
          dupT.slice(0, 4).map((p) => p.join(' == ')))
      : pass(S11, 'no two pages carry the same title', `${titled.size} distinct across ${pages.size} pages`);

    dupD.length
      ? byBlastRadius(S11, 'nor the same description', dupD.length, pages.size,
          `${dupD.length} descriptions are shared`,
          dupD.slice(0, 4).map((p) => p.join(' == ')))
      : pass(S11, 'nor the same description', `${described.size} distinct`);
  }
}

const S10 = 'Crawl rules';
{
  /**
   * No page this site publishes may be blocked from being crawled.
   *
   * A Disallow line is the cheapest way to delete a site from Google. It
   * fails silently — the page still serves, the sitemap still lists it, and
   * the only symptom is traffic that stops arriving — and the matching rule
   * is longest-prefix-wins, so a line meant for one path quietly outranks the
   * `Allow: /` above it and takes every page underneath with it. "/d" instead
   * of "/diag" would take /documentaries.
   *
   * This site has already been on the wrong end of the same class of mistake
   * once, when a canonical pointed at a URL that redirected away from its own
   * page and Search Console indexed nothing for weeks. That cost months and
   * was one character of config.
   *
   * So the sitemap and robots.txt are checked against each other: everything
   * the sitemap offers Google must be something robots.txt permits. The two
   * files are written eighty lines apart in this same script and nothing
   * otherwise makes them agree.
   */
  const robots = await readFile(resolve(DIST, 'robots.txt'), 'utf8').catch(() => '');
  const sitemap = await readFile(resolve(DIST, 'sitemap.xml'), 'utf8').catch(() => '');

  if (!robots || !sitemap) skip(S10, 'nothing in the sitemap is blocked by robots.txt', 'needs dist/');
  else {
    const disallows = [...robots.matchAll(/^Disallow:\s*(\S+)\s*$/gm)].map((m) => m[1]);
    const paths = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname);
    /* Longest prefix wins, which is the rule that makes this dangerous and is
       therefore the rule this reproduces. */
    const blocked = paths.filter((p) => disallows.some((d) => p.startsWith(d)));
    blocked.length
      ? fail(S10, 'nothing in the sitemap is blocked by robots.txt',
          `${blocked.length} published pages are disallowed`, blocked.slice(0, 5))
      : pass(S10, 'nothing in the sitemap is blocked by robots.txt',
          `${paths.length} urls against ${disallows.length} rule(s): ${disallows.join(' ') || 'none'}`);

    /* And the rules that are meant to be there, are. The api routes and the
       diagnostics page are not publications; if a future edit drops these
       lines the sitemap check above would happily keep passing. */
    const wanted = ['/api/', '/diag'];
    const missing = wanted.filter((w) => !disallows.includes(w));
    missing.length
      ? fail(S10, 'the routes that are not pages stay out of the index',
          `missing ${missing.join(', ')}`)
      : pass(S10, 'the routes that are not pages stay out of the index', disallows.join(' '));

    /* The one line that makes the file worth serving at all. */
    /\nSitemap:\s*https?:\/\/\S+\/sitemap\.xml/.test(robots)
      ? pass(S10, 'robots.txt still points at the sitemap')
      : fail(S10, 'robots.txt still points at the sitemap', 'the Sitemap line is gone');
  }
}

const S9 = 'Guessed platforms';
{
  /**
   * A guess must never be indistinguishable from a fact.
   *
   * `namedBy` marks a platform that came from something weaker than a watch
   * provider — free text on a release date, a production company, a series'
   * broadcaster. The field shipped with a comment saying each can be wrong in
   * a way a provider cannot, and that being wrong sends a reader to a
   * subscription they do not need. Then nothing read it for months.
   *
   * Reported from the site: Toxic: A Fairy Tale for Grown-ups in "On OTT"
   * under a ZEE5 badge, dated today, when TMDB has no India provider for it
   * at all. UNABOMBER, two cards along, was the same. Seven rows were making
   * that claim on the day it was reported.
   *
   * This does not forbid a guess — an announced date is most of why anybody
   * visits a release calendar. It checks the two things that make one safe:
   * the row has to say where its platform came from, and the guess has to be
   * a guess about a real service rather than an empty badge.
   */
  if (!feed) skip(S9, 'a guessed platform is still marked as one', 'needs the feed');
  else {
    const all = feed.weeks.flatMap((w) => w.releases);
    const guessed = all.filter((r) => r.namedBy);
    const bad = guessed.filter(
      (r) => !['note', 'studio', 'network'].includes(r.namedBy) || !r.platforms?.length,
    );
    bad.length
      ? byBlastRadius(S9, 'a guessed platform is still marked as one', bad.length, allRows.length,
          `${bad.length} malformed`,
          bad.slice(0, 4).map((r) => `${r.title}: namedBy=${r.namedBy} platforms=${(r.platforms ?? []).join(',') || 'none'}`))
      : pass(S9, 'a guessed platform is still marked as one',
          `${guessed.length} of ${all.length} rows name a source`);

    /*
     * The one that would have caught the report. A row claiming a service on
     * a date that has already passed is claiming availability, and the only
     * thing entitled to do that is a provider. The refresh now re-asks TMDB
     * on the day and clears namedBy when it is confirmed — so a row still
     * carrying namedBy past its date is correctly marked, and the rails and
     * the sheet treat it as expected rather than available. What this watches
     * for is the count getting away from us: a handful is TMDB lagging, a
     * flood means a pass is inventing platforms.
     */
    const today = new Date().toISOString().slice(0, 10);
    const due = guessed.filter((r) => r.releaseDate <= today);
    const share = all.length ? due.length / all.length : 0;
    share > 0.1
      ? warn(S9, 'few rows claim a service their date has outrun',
          `${due.length} of ${all.length} rows are past their date on a guess`,
          due.slice(0, 6).map((r) => `${r.releaseDate} ${r.title} → ${r.platforms.join(',')} [${r.namedBy}]`))
      : pass(S9, 'few rows claim a service their date has outrun',
          `${due.length} past their date, shown as expected rather than available`);
  }
}

const S8 = 'Connection hints';
{
  /**
   * A preconnect has to describe the connection that actually gets opened.
   *
   * Browsers keep separate connection pools for CORS and non-CORS requests to
   * the same host, and a preconnect warms only the pool its own attributes
   * describe. So `crossorigin` is not a harmless extra: put it on a hint for
   * an origin the page fetches with plain <img> tags and the warmed
   * connection is never used, while the first poster still pays DNS, TCP and
   * TLS in full. It is a line that looks like an optimisation, measures as
   * nothing, and nothing in a test suite would ever notice.
   *
   * Which is what had happened. Every poster and platform logo on this site
   * comes from image.tmdb.org through PosterArt, which has never set a
   * crossorigin attribute and has no reason to — nothing reads a poster back
   * off a canvas. The hint carried one anyway.
   *
   * Fonts are the opposite case and keep theirs: a webfont is fetched in CORS
   * mode whether or not you ask, so gstatic's hint is only useful with it.
   */
  const head = await readFile(resolve(ROOT, 'index.html'), 'utf8').catch(() => '');
  const hints = [...head.matchAll(/<link\s+rel="preconnect"[^>]*>/g)].map((m) => m[0]);
  const hintFor = (host) => hints.find((h) => h.includes(host)) ?? '';

  if (!hints.length) skip(S8, 'preconnects match how the assets are fetched', 'no preconnects found');
  else {
    const images = hintFor('image.tmdb.org');
    const fontFiles = hintFor('fonts.gstatic.com');
    const wrong = [];
    if (images && /crossorigin/.test(images)) {
      wrong.push('image.tmdb.org is hinted crossorigin but its posters are plain <img> tags');
    }
    if (fontFiles && !/crossorigin/.test(fontFiles)) {
      wrong.push('fonts.gstatic.com is hinted without crossorigin, and webfonts are always CORS');
    }
    wrong.length
      ? fail(S8, 'preconnects match how the assets are fetched', 'a hint warms the wrong pool', wrong)
      : pass(S8, 'preconnects match how the assets are fetched', `${hints.length} hints`);
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

  /*
   * Which row owns a page is the builder's decision, read rather than guessed.
   *
   * This used to re-derive the answer: key every row by `r.slug ?? slugify(
   * title)`, let the archive load last, then a second pass to put the live row
   * back on top. Three rules approximating one decision made somewhere else,
   * and they disagreed with it the first time a film had two rows.
   *
   * Teenage Sex and Death at Camp Miasma opened in cinemas on 14 August and
   * reached MUBI on 2 October, so the feed carries both a cinema row and an
   * ~ott row. The builder gave the page to the MUBI row and the page is right:
   * it says "Streaming now on MUBI", because the film is. But the cinema row
   * has no slug — it has no page — and the slugify fallback invented one for
   * it anyway, so the grader judged a correct page against the row that does
   * not own it and reported "no streaming platform but says Streaming now".
   *
   * That failure blocked every refresh for two days, and the site went 49
   * hours stale behind a gate that was wrong. A check confidently wrong about
   * a page that is right is worse than no check: it teaches people to ignore
   * it, and then it is worth nothing on the day it is right.
   *
   * So: a row owns a page only if it carries a stamped slug, which is exactly
   * what build-seo writes into the shipped feed for every row it builds a page
   * for — "one implementation of the rule, and no way for the two to
   * disagree", as the comment there puts it. Verified against the build: 2,190
   * pages, every one of them with a stamped row behind it, none orphaned.
   *
   * Archive first so the live sources overwrite it. The archive is frozen at
   * the moment a row aged off the board, and it had been winning: Ramba
   * Oorvasi Menaka reached Prime Video and the archive still remembered a
   * cinema listing, Anbil Avan gained a synopsis the archive copy predates.
   * Both were correct pages judged against a stale copy of themselves.
   */
  /*
   * id → the page that row belongs to, mirroring slugFor in build-seo.
   *
   * Two things make this harder than reading r.slug, and both have bitten.
   *
   * The archive's stamps go stale. It freezes a row as it was when it aged off
   * the board, slug included, and three of them currently disagree with the
   * live build — Toxic: A Fairy Tale for Grown-ups is stamped "toxic" there
   * and "toxic-a-fairy-tale-for-grown-ups" in the feed, and only the second
   * page exists. So the live sources are authoritative for this build: where
   * they mention a row, their answer stands, including when their answer is
   * that the row has no page at all. That last part matters — it is how a
   * cinema row that aged out of the candidates stops claiming a URL the
   * streaming row now owns.
   *
   * And a streaming row usually has no page of its own. build-seo resolves
   * `m-1213243~ott` to the page of `m-1213243`; it only holds a slug outright
   * when nothing else claims one. So it asks for its own first and falls back
   * to the film's.
   */
  const frozen = new Map();
  for (const r of archive?.titles ?? []) if (r.slug) frozen.set(String(r.id), r.slug);
  const slugOf = new Map();
  for (const r of [...catRows, ...feedRows]) {
    const id = String(r.id ?? '');
    if (r.slug) slugOf.set(id, r.slug);
    else slugOf.delete(id);
  }
  const pageOf = (r) => {
    const id = String(r.id ?? '');
    const base = id.replace(/~[a-z]+$/, '');
    /* A live stamp first, from either the row or — for a streaming row — the
       film it belongs to. Only then the archive's frozen one, which is right
       for a row this build never saw and wrong whenever it disagrees. Toxic's
       streaming row is stamped "toxic" there while the film's page is
       "toxic-a-fairy-tale-for-grown-ups"; preferring the film's live stamp is
       what puts the ZEE5 date on the page that exists. */
    return (
      slugOf.get(id) ??
      (base !== id ? slugOf.get(base) : undefined) ??
      frozen.get(id) ??
      (base !== id ? frozen.get(base) : undefined) ??
      null
    );
  };

  const isOtt = (r) => String(r.id ?? '').endsWith('~ott');
  const everyRow = [...(archive?.titles ?? []), ...catRows, ...feedRows];

  /* Cinema rows own their page outright; a streaming row only where none does. */
  for (const r of everyRow) {
    if (!isOtt(r)) continue;
    const key = pageOf(r);
    if (key && !bySlug.has(key)) bySlug.set(key, r);
  }
  for (const r of everyRow) {
    if (isOtt(r)) continue;
    const key = pageOf(r);
    if (key) bySlug.set(key, r);
  }

  /*
   * The streaming date, keyed by the page it belongs to.
   *
   * Region matters here and nowhere else. feedRows is already scoped to India;
   * the archive is not, and The Last First: Winter K2 carries a US Apple TV
   * date and no Indian one. Counting that as the film's streaming date would
   * fail a page for refusing to publish an American date to Indian readers —
   * which is the page being right.
   */
  for (const r of everyRow) {
    if (!isOtt(r)) continue;
    const key = pageOf(r);
    if (key && (r.regions ?? [REGION]).includes(REGION)) datedBySlug.set(key, r);
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
    const dated = datedBySlug.get(slug);
    /*
     * A film is streaming if its own row says so, or if its streaming row's
     * date has arrived.
     *
     * The grader has to know what the builder knows. A title with an announced
     * digital date is two rows — the cinema listing and the row for the week it
     * reaches OTT — and once that second date passes, the page says "Streaming
     * now on X" because by then it is. Judging that page against the cinema row
     * alone reports ten correct pages as contradictions, which is how this
     * check spent two days blocking refreshes over a page that was right.
     */
    const arrived = dated?.platforms?.length && dated.releaseDate <= TODAY;
    const streams = (row.platforms ?? []).some((p) => p !== 'theatres') || Boolean(arrived);
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
    ? byBlastRadius(S5, 'streaming status matches the data', wrong.length, titlePages.length,
        `${wrong.length} of ${titlePages.length} pages contradict their row`, wrong.slice(0, 5))
    : pass(S5, 'streaming status matches the data', `${titlePages.length} title pages`);
  orphan.length
    ? byBlastRadius(S5, 'every title page has a row behind it', orphan.length, titlePages.length,
        `${orphan.length} orphaned`, orphan.slice(0, 5))
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
    ? byBlastRadius(S5, 'no title page is published thin', thinPages.length, titlePages.length,
        `${thinPages.length} thin`, thinPages.slice(0, 5).map(([p]) => p))
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
