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

import { readFile, readdir, stat } from 'node:fs/promises';
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

const readJson = async (p) => JSON.parse(await readFile(p, 'utf8'));
const maybe = async (p) => readJson(p).catch(() => null);

// --- inputs ------------------------------------------------------------------

const feed = await maybe(resolve(DIST, 'data/releases.json'));
const catalogue = await maybe(resolve(ROOT, 'public/data/catalogue.json'));
const archive = await maybe(resolve(ROOT, 'data/archive.json'));
const registrySrc = await readFile(resolve(ROOT, 'src/data/platforms.ts'), 'utf8').catch(() => '');
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
  pass(S4, 'pages were generated', `${pages.size} pages on disk`);

  const noTitle = [...pages].filter(([, html]) => !/<title>[^<]{5,}<\/title>/.test(html));
  noTitle.length
    ? fail(S4, 'every page has a title', `${noTitle.length} missing`, noTitle.slice(0, 3).map(([p]) => p))
    : pass(S4, 'every page has a title');

  const badH1 = [...pages].filter(([, html]) => (html.match(/<h1[\s>]/g) ?? []).length !== 1);
  badH1.length
    ? fail(S4, 'every page has exactly one h1', `${badH1.length} pages do not`,
        badH1.slice(0, 5).map(([p, html]) => `${p} — ${(html.match(/<h1[\s>]/g) ?? []).length} h1s`))
    : pass(S4, 'every page has exactly one h1');

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
  const known = new Set([...pages.keys()]);
  const broken = new Set();
  for (const [, html] of pages) {
    for (const m of html.matchAll(/href="(\/[^"#?]*)"/g)) {
      const href = m[1].replace(/\/$/, '') || '/';
      if (!known.has(href) && !/\.(png|svg|xml|txt|json|ico|webmanifest|css|js)$/.test(href)) broken.add(href);
    }
  }
  broken.size
    ? fail(S4, 'internal links resolve to real pages', `${broken.size} dead`, [...broken].slice(0, 8))
    : pass(S4, 'internal links resolve to real pages');

  const sitemap = await readFile(resolve(DIST, 'sitemap.xml'), 'utf8').catch(() => '');
  if (!sitemap) skip(S4, 'every sitemap entry exists', 'no sitemap.xml');
  else {
    const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname.replace(/\/$/, '') || '/');
    const missing = locs.filter((l) => !known.has(l));
    missing.length
      ? fail(S4, 'every sitemap entry exists', `${missing.length} of ${locs.length} do not`, missing.slice(0, 5))
      : pass(S4, 'every sitemap entry exists', `${locs.length} entries`);
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
  const bySlug = new Map();
  for (const r of [...feedRows, ...(archive?.titles ?? [])]) {
    const key = r.slug ?? slugify(r.title ?? '');
    if (key) bySlug.set(key, r);
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
    const saysStreaming = /Streaming now on/.test(html);
    const saysUnannounced = /Not announced yet/.test(html);
    if (streams && saysUnannounced) wrong.push(`${slug} — on ${row.platforms.join(',')} but says "Not announced yet"`);
    if (!streams && saysStreaming) wrong.push(`${slug} — no streaming platform but says "Streaming now"`);
  }
  wrong.length
    ? fail(S5, 'streaming status matches the data', `${wrong.length} pages contradict their row`, wrong.slice(0, 5))
    : pass(S5, 'streaming status matches the data', `${titlePages.length} title pages`);
  orphan.length
    ? fail(S5, 'every title page has a row behind it', `${orphan.length} orphaned`, orphan.slice(0, 5))
    : pass(S5, 'every title page has a row behind it');

  const thinPages = titlePages.filter(([path]) => {
    const row = bySlug.get(path.split('/').pop());
    return row && (!row.synopsis || !row.cast?.length);
  });
  thinPages.length
    ? fail(S5, 'no title page is published without a synopsis and cast', `${thinPages.length} thin`, thinPages.slice(0, 5).map(([p]) => p))
    : pass(S5, 'no title page is published without a synopsis and cast');
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
    r.status === 'PASS' ? ' ok ' : r.status === 'FAIL' ? 'FAIL' : r.status === 'NOTE' ? 'note' : 'skip';
  console.log(`  ${mark}  ${r.name.padEnd(width)}${r.detail}`);
  for (const ex of r.examples) console.log(`        · ${ex}`);
}

const failed = results.filter((r) => r.status === 'FAIL').length;
const skipped = results.filter((r) => r.status === 'SKIP').length;
const passed = results.filter((r) => r.status === 'PASS').length;
console.log(
  `\n${passed} passed, ${failed} failed${skipped ? `, ${skipped} skipped` : ''}` +
    (failed ? ' — the site is publishing something it should not.\n' : '\n'),
);
process.exit(failed ? 1 : 0);
