#!/usr/bin/env node
/**
 * End-to-end checks against a real browser and a real build.
 *
 * The unit tests cover the selection; the grader covers the published data and
 * pages. Neither can tell you that a row overflows a 360px phone, that an arrow
 * scrolls nothing, or that a poster arriving late shoves the board down the
 * page — and every one of those has happened here. This drives the built site
 * in Chromium and asserts what a reader would notice.
 *
 * Widths are swept rather than sampled at the three sizes someone thought to
 * check: the brief is that the site is good at *any* size, and the failures
 * that survive review are always at the width nobody opened.
 *
 * Usage: npm run e2e            (builds nothing — run npm run build first)
 *        npm run e2e -- --keep  (leave the screenshots behind)
 */

import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir, stat } from 'node:fs/promises';
import { extname, join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const SHOTS = join(ROOT, '.e2e');
const KEEP = process.argv.includes('--keep');

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.webmanifest': 'application/manifest+json', '.txt': 'text/plain', '.xml': 'application/xml',
};

/**
 * The site's own server, near enough.
 *
 * `serve -s` rewrites unknown paths to index.html, which hid a real routing
 * question once already: it answered index.html for /diag.html and made a file
 * that existed look missing. This serves files that exist and falls back only
 * when nothing matches, which is what Cloudflare does.
 */
function serve() {
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    for (const candidate of [join(DIST, path), join(DIST, path, 'index.html'), join(DIST, 'index.html')]) {
      try {
        const body = await readFile(candidate);
        res.writeHead(200, { 'content-type': TYPES[extname(candidate)] ?? 'application/octet-stream' });
        return res.end(body);
      } catch {
        /* Try the next candidate. */
      }
    }
    res.writeHead(404).end();
  });
  return new Promise((ok) => server.listen(0, () => ok({ server, port: server.address().port })));
}

let failures = 0;
let checks = 0;
const ok = (name, detail = '') => {
  checks++;
  console.log(`   ok   ${name}${detail ? `  ${detail}` : ''}`);
};
const bad = (name, detail) => {
  checks++;
  failures++;
  console.log(`  FAIL  ${name}\n        ${detail}`);
};
const is = (cond, name, detail) => (cond ? ok(name, typeof cond === 'string' ? cond : '') : bad(name, detail));

/** A 1x1 PNG standing in for TMDB artwork, which this sandbox cannot reach.
 *  Layout is what is under test; the pictures are not. */
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

async function newPage(browser, { width, height, seen = true, reducedMotion, slowImages = false }) {
  const ctx = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
    reducedMotion,
  });
  if (seen) await ctx.addInitScript(() => { try { localStorage.setItem('dropday.seen', '1'); } catch {} });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  /* The font request below is aborted on purpose, and Chromium reports every
     aborted request as a console error. Counting our own test setup as a
     failure of the site is how a suite ends up being ignored. */
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const text = m.text();
    if (text.includes('ERR_FAILED') || text.includes('fonts.g')) return;
    errors.push(text);
  });
  await page.route('**image.tmdb.org/**', async (route) => {
    if (slowImages) await new Promise((r) => setTimeout(r, 400));
    return route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL });
  });
  // Google Fonts is a third party this test should not depend on.
  await page.route('**fonts.g**', (r) => r.abort());
  return { ctx, page, errors };
}

const { server, port } = await serve();
const BASE = `http://127.0.0.1:${port}`;
await mkdir(SHOTS, { recursive: true });
// CHROMIUM_PATH is how this sandbox points at its preinstalled browser; in CI
// Playwright finds its own and the variable is unset.
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);

// --- every width, not three of them -----------------------------------------

console.log('\nLayout across widths');

/** 320 is the narrowest phone still in use; 1920 is a desktop monitor. The
 *  awkward numbers in between are the ones that catch clamp() boundaries. */
const WIDTHS = [320, 360, 390, 414, 480, 600, 768, 834, 1024, 1180, 1280, 1440, 1920];

for (const width of WIDTHS) {
  const { ctx, page, errors } = await newPage(browser, { width, height: 900 });
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.landed__cell, .strip__item, .board', { timeout: 10_000 });
  await page.waitForTimeout(600);

  const m = await page.evaluate(() => {
    const doc = document.documentElement;
    const track = document.querySelector('.landed__track');
    const cell = document.querySelector('.landed__cell');
    const head = document.querySelector('.landed__head');
    const arrows = document.querySelector('.landed__arrows');
    return {
      overflow: doc.scrollWidth - doc.clientWidth,
      hasRail: !!track,
      cardW: cell ? cell.getBoundingClientRect().width : 0,
      trackW: track ? track.clientWidth : 0,
      scrollable: track ? track.scrollWidth > track.clientWidth + 2 : false,
      arrowsShown: arrows ? getComputedStyle(arrows).display !== 'none' : false,
      fadeAtEnd: track ? track.hasAttribute('data-more') : false,
      headOverflow: head ? head.scrollWidth - head.clientWidth : 0,
      // Any element sticking out of the viewport that is not inside a scroller.
      strays: [...document.querySelectorAll('body *')]
        .filter((el) => {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.right <= doc.clientWidth + 0.5) return false;
          for (let p = el.parentElement; p; p = p.parentElement) {
            const o = getComputedStyle(p).overflowX;
            if (o === 'auto' || o === 'scroll' || o === 'hidden') return false;
          }
          return true;
        })
        .slice(0, 3)
        .map((el) => `${el.tagName.toLowerCase()}.${(el.className || '').toString().split(' ')[0]}`),
    };
  });

  const label = `${width}px`;
  if (m.overflow > 0 || m.strays.length) {
    bad(`${label}: nothing escapes the viewport`, `overflow ${m.overflow}px${m.strays.length ? `, strays: ${m.strays.join(', ')}` : ''}`);
  } else {
    ok(`${label}: nothing escapes the viewport`);
  }

  if (m.hasRail) {
    /**
     * A row that ends flush with the viewport looks finished and does not get
     * scrolled, so there has to be something saying otherwise. A partial card
     * does it when the cards happen not to divide the track evenly — and at
     * 1280px they divide it almost exactly (6.96 cards), which is what this
     * check caught. The fade at the edge is true at every width, so either
     * counts, but one of them must be there.
     */
    const visible = m.trackW / (m.cardW + 12);
    const partial = visible % 1 > 0.15 && visible % 1 < 0.9;
    is(
      partial || m.fadeAtEnd,
      `${label}: the rail says it continues`,
      `${visible.toFixed(2)} cards visible and no edge fade — the row reads as finished`,
    );
    is(m.scrollable, `${label}: the rail scrolls`, 'all cards fit, so nothing indicates more');
    is(m.headOverflow === 0, `${label}: the rail heading fits`, `${m.headOverflow}px of it is cut off`);
    // Arrows are for pointers on wide screens only.
    is(
      m.arrowsShown === width >= 900,
      `${label}: arrows shown only where they belong`,
      `arrows ${m.arrowsShown ? 'shown' : 'hidden'} at ${width}px`,
    );
  }

  is(errors.length === 0, `${label}: no console errors`, errors[0]);
  await page.screenshot({ path: join(SHOTS, `w-${width}.png`) });
  await ctx.close();
}

// --- the rail behaves like a rail -------------------------------------------

console.log('\nThe rail');
{
  const { ctx, page, errors } = await newPage(browser, { width: 1440, height: 900 });
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.landed__cell');

  const start = await page.evaluate(() => document.querySelector('.landed__track').scrollLeft);
  is(start === 0, 'starts at the beginning', `scrollLeft was ${start}`);

  const prevDisabled = await page.locator('.landed__arrow').first().isDisabled();
  is(prevDisabled, 'the back arrow is dead at the start', 'it offered to scroll before the first card');

  await page.locator('.landed__arrow').nth(1).click();
  await page.waitForTimeout(700);
  const moved = await page.evaluate(() => document.querySelector('.landed__track').scrollLeft);
  is(moved > 100, 'the forward arrow scrolls', `scrollLeft only reached ${moved}`);

  // Run it to the end and check the forward arrow retires.
  await page.evaluate(() => {
    const t = document.querySelector('.landed__track');
    t.scrollLeft = t.scrollWidth;
  });
  await page.waitForTimeout(400);
  is(
    await page.locator('.landed__arrow').nth(1).isDisabled(),
    'the forward arrow is dead at the end',
    'it offered to scroll past the last card',
  );

  is(errors.length === 0, 'no console errors', errors[0]);
  await ctx.close();
}

// --- opening a title --------------------------------------------------------

console.log('\nOpening a title from the rail');
for (const width of [390, 1440]) {
  const { ctx, page, errors } = await newPage(browser, { width, height: 900 });
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.landed__card');

  const name = (await page.locator('.landed__name').first().textContent())?.trim();
  await page.locator('.landed__card').first().click();
  await page.waitForTimeout(500);
  const sheet = await page.locator('.sheet, [role="dialog"]').first();
  is(await sheet.isVisible(), `${width}px: tapping a card opens the detail sheet`, 'no sheet appeared');
  const heading = (await page.locator('.sheet h2, [role="dialog"] h2').first().textContent())?.trim();
  is(
    heading?.includes(name?.slice(0, 12) ?? ' '),
    `${width}px: the sheet is the title that was tapped`,
    `tapped "${name}", opened "${heading}"`,
  );

  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  is(!(await sheet.isVisible()), `${width}px: Escape closes it`, 'the sheet stayed open');
  is(errors.length === 0, `${width}px: no console errors`, errors[0]);
  await ctx.close();
}

// --- keyboard ---------------------------------------------------------------

console.log('\nKeyboard');
{
  const { ctx, page } = await newPage(browser, { width: 1440, height: 900 });
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.landed__card');
  const reached = await page.evaluate(async () => {
    // Every card is a real button, so tabbing must reach them in order.
    const cards = [...document.querySelectorAll('.landed__card')];
    cards[0].focus();
    return document.activeElement === cards[0];
  });
  is(reached, 'the cards take focus', 'a card could not be focused');

  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  is(
    await page.locator('.sheet, [role="dialog"]').first().isVisible(),
    'Enter opens the focused card',
    'nothing opened',
  );
  await ctx.close();
}

// --- late images must not move the page -------------------------------------

console.log('\nStability');
{
  const { ctx, page } = await newPage(browser, { width: 390, height: 844, slowImages: true });
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.landed__cell');
  const before = await page.evaluate(() => {
    const el = document.querySelector('.board');
    return el ? Math.round(el.getBoundingClientRect().top) : null;
  });
  await page.waitForTimeout(1600);
  const after = await page.evaluate(() => {
    const el = document.querySelector('.board');
    return el ? Math.round(el.getBoundingClientRect().top) : null;
  });
  is(
    before !== null && Math.abs(after - before) <= 2,
    'posters arriving late do not shove the board',
    `the board moved ${Math.abs(after - before)}px once the images loaded`,
  );
  await ctx.close();
}

// --- reduced motion ---------------------------------------------------------

{
  const { ctx, page } = await newPage(browser, { width: 1440, height: 900, reducedMotion: 'reduce' });
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.landed__cell');
  const instant = await page.evaluate(async () => {
    const t = document.querySelector('.landed__track');
    document.querySelectorAll('.landed__arrow')[1].click();
    // With motion reduced the scroll is a jump, so it has landed by the next frame.
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return t.scrollLeft;
  });
  is(instant > 100, 'reduced motion scrolls instantly rather than animating', `scrollLeft ${instant}`);
  await ctx.close();
}

// --- the fallback, when there is not enough to show --------------------------

console.log('\nFallback');
{
  const { ctx, page, errors } = await newPage(browser, { width: 390, height: 844 });
  // Strip the feed down to a handful of recent titles: too few for a poster row.
  await page.route('**/data/releases.json', async (route) => {
    const body = JSON.parse(await readFile(join(DIST, 'data/releases.json'), 'utf8'));
    const today = new Date().toISOString().slice(0, 10);
    let kept = 0;
    for (const week of body.weeks) {
      week.releases = week.releases.filter((r) => (r.releaseDate <= today && kept++ < 3));
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  const state = await page.evaluate(() => ({
    rail: !!document.querySelector('.landed__cell'),
    strip: !!document.querySelector('.strip__item'),
  }));
  is(!state.rail, 'a thin week does not render a thin poster row', 'the rail rendered with too few cards');
  is(errors.length === 0, 'no console errors on a thin feed', errors[0]);
  await ctx.close();
}

// --- the page reads in the right order ---------------------------------------

console.log('\nStructure');
for (const width of [390, 1440]) {
  const { ctx, page, errors } = await newPage(browser, { width, height: 900 });
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.controls__row');
  await page.waitForTimeout(700);

  const m = await page.evaluate(() => {
    const top = (sel) => {
      const el = document.querySelector(sel);
      return el ? Math.round(el.getBoundingClientRect().top + window.scrollY) : null;
    };
    return {
      lenses: top('.lenses-row'),
      rail: top('.landed'),
      heading: top('.controls'),
      board: top('.board'),
      share: top('.weekbar .share'),
      // The bands this change removed. Their absence is the change.
      oldWeekBand: !!document.querySelector('.weekbar__week'),
      oldMetaBand: !!document.querySelector('.weekbar__right'),
      headingText: document.querySelector('.controls__heading')?.textContent?.trim() ?? '',
      hasSearch: !!document.querySelector('.searchbox'),
      searchInHeader: !!document.querySelector('.weekbar .searchbox'),
      stepper: document.querySelectorAll('.controls__row .weeknav__btn').length,
      toggle: document.querySelectorAll('.controls__row .viewtoggle button').length,
    };
  });

  const label = `${width}px`;
  is(!m.oldWeekBand && !m.oldMetaBand, `${label}: the two header bands are gone`, 'a removed band is still rendering');
  is(m.searchInHeader, `${label}: search is in the header`, 'it is not');
  is(m.stepper === 2, `${label}: the week stepper is on the board heading`, `${m.stepper} arrows found`);
  is(m.toggle === 2, `${label}: the layout toggle is on the board heading`, `${m.toggle} buttons found`);
  is(/Sep|week/i.test(m.headingText), `${label}: the heading names the week`, `it says "${m.headingText}"`);

  /**
   * Content before controls. The first attempt at this rendered the board's
   * heading above the poster row, because the row was still inside <main> and
   * the heading is not — which read as a control bar for a rail it did not
   * control.
   */
  is(
    m.lenses < m.rail && m.rail < m.heading && m.heading < m.board,
    `${label}: lenses, then the row, then the board's heading, then the board`,
    `lenses ${m.lenses}, rail ${m.rail}, heading ${m.heading}, board ${m.board}`,
  );
  /**
   * Share is in the header, above everything.
   *
   * It spent one commit at the foot of the board on the reasoning that nobody
   * shares a week they have not read — true of a reader, and beside the point:
   * the picture it makes is how the site travels, and a growth loop that needs
   * scrolling to find does not run. The owner called it, and this check now
   * holds the placement they chose rather than the one it replaced.
   */
  is(
    m.share !== null && m.share < m.rail,
    `${label}: Share is in the header, above the fold`,
    `share ${m.share}, rail ${m.rail}`,
  );
  is(errors.length === 0, `${label}: no console errors`, errors[0]);
  await ctx.close();
}

// --- the controls on that heading actually work ------------------------------

console.log('\nBoard controls');
{
  const { ctx, page, errors } = await newPage(browser, { width: 1440, height: 900 });
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.controls__row');

  // The layout toggle changes the layout, and chips follow the view that needs them.
  const chipsInBoard = await page.evaluate(() => !!document.querySelector('.chips'));
  is(!chipsInBoard, 'no platform chips in board view', 'the chips duplicate the board columns');

  await page.locator('.controls__row .viewtoggle button').nth(1).click();
  await page.waitForTimeout(500);
  const grid = await page.evaluate(() => ({
    grid: !!document.querySelector('.grid'),
    chips: !!document.querySelector('.chips'),
    pressed: document.querySelectorAll('.controls__row .viewtoggle button[aria-pressed="true"]').length,
  }));
  is(grid.grid, 'the toggle switches to posters', 'the grid did not render');
  is(grid.chips, 'chips appear in poster view, where nothing else names the platforms', 'no chips');
  is(grid.pressed === 1, 'exactly one layout is announced as pressed', `${grid.pressed} pressed`);

  await page.locator('.controls__row .viewtoggle button').nth(0).click();
  await page.waitForTimeout(400);
  is(await page.evaluate(() => !!document.querySelector('.board')), 'and back to the board', 'it did not return');

  // The week stepper still steps, from its new home.
  const before = await page.evaluate(() => document.querySelector('.controls__heading').textContent);
  await page.locator('.controls__row .weeknav__btn').first().click();
  await page.waitForTimeout(600);
  const after = await page.evaluate(() => ({
    heading: document.querySelector('.controls__heading').textContent,
    today: !!document.querySelector('.weeknav__today'),
  }));
  is(after.heading !== before, 'the stepper changes the week', `still "${before}"`);
  is(after.today, 'a way back to this week appears once you leave it', 'no shortcut back');
  await page.locator('.weeknav__today').click();
  await page.waitForTimeout(600);
  is(
    (await page.evaluate(() => document.querySelector('.controls__heading').textContent)) === before,
    'and it returns',
    'the shortcut did not go back',
  );

  // Region and sort moved into the panel; they have to be reachable there.
  await page.locator('.controls__row .btn').first().click();
  await page.waitForTimeout(400);
  const panel = await page.evaluate(() => ({
    region: !!document.querySelector('.panel .region select'),
    sort: !!document.querySelector('.panel .sort select'),
  }));
  is(panel.region, 'the region picker is in the filters panel', 'it is nowhere');
  is(panel.sort, 'the sort control is in the filters panel', 'it is nowhere');
  is(errors.length === 0, 'no console errors', errors[0]);
  await ctx.close();
}

// --- sharing the week as a picture -------------------------------------------

console.log('\nShare');
for (const width of [390, 1440]) {
  const ctx = await browser.newContext({
    viewport: { width, height: 900 },
    deviceScaleFactor: 1,
    acceptDownloads: true,
  });
  await ctx.addInitScript(() => { try { localStorage.setItem('dropday.seen', '1'); } catch {} });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // Artwork is unreachable here, which is the path worth testing anyway: the
  // card has to render when a poster does not arrive.
  await page.route('**image.tmdb.org/**', (r) => r.abort());
  await page.route('**fonts.g**', (r) => r.abort());
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.share .iconbtn');

  const inHeader = await page.evaluate(() => !!document.querySelector('.weekbar .share'));
  is(inHeader, `${width}px: the share button is in the header`, 'it is somewhere else');

  await page.locator('.share .iconbtn').click();
  await page.waitForTimeout(300);
  const items = await page.locator('.share__item').count();
  is(items === 2, `${width}px: it offers both a board and a poster image`, `${items} options`);

  for (const [i, kind] of [[0, 'board'], [1, 'posters']]) {
    if (!(await page.locator('.share__menu').isVisible())) {
      await page.locator('.share .iconbtn').click();
      await page.waitForTimeout(250);
    }
    const [dl] = await Promise.all([
      page.waitForEvent('download', { timeout: 40_000 }),
      page.locator('.share__item').nth(i).click(),
    ]);
    const file = join(SHOTS, `share-${width}-${kind}.png`);
    await dl.saveAs(file);
    const { size } = await stat(file);
    const head = (await readFile(file)).subarray(0, 8);
    is(
      head[0] === 0x89 && head[1] === 0x50 && size > 20_000,
      `${width}px: the ${kind} image renders as a real PNG`,
      `${size} bytes, magic ${head.subarray(0, 4).toString('hex')}`,
    );
    is(
      /\.png$/.test(dl.suggestedFilename()) && dl.suggestedFilename().includes('2026-'),
      `${width}px: the ${kind} file is named for its week`,
      dl.suggestedFilename(),
    );
    await page.waitForTimeout(400);
  }

  // Escape closes the menu — it is a popover, and popovers that trap you are a
  // bug people report as "the site froze".
  await page.locator('.share .iconbtn').click();
  await page.waitForTimeout(200);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  is(
    !(await page.locator('.share__menu').isVisible()),
    `${width}px: Escape closes the share menu`,
    'it stayed open',
  );
  is(errors.length === 0, `${width}px: no console errors`, errors[0]);
  await ctx.close();
}

// --- one row per lens, each true to its own page ------------------------------

console.log('\nA rail on every lens');

/**
 * The three rows must not be the same row. "Just landed" over films that are
 * not out yet is a false statement and the catalogue's row is the homepage
 * again — so this asserts the heading, and that the captions are pointing the
 * direction the heading claims.
 */
for (const [path, heading, expect] of [
  ['/', 'Just landed', 'past'],
  ['/upcoming', 'Landing soon', 'future'],
  ['/streaming', 'Popular now', 'year'],
]) {
  for (const width of [390, 1440]) {
    const { ctx, page, errors } = await newPage(browser, { width, height: 900 });
    await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.landed__cell', { timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(900);

    const m = await page.evaluate(() => ({
      heading: document.querySelector('.landed__title')?.textContent?.trim() ?? null,
      captions: [...document.querySelectorAll('.landed__meta')].slice(0, 6).map((e) => e.textContent.trim()),
      cards: document.querySelectorAll('.landed__cell').length,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      // The pill row the catalogue rail replaced must not still be there too.
      duplicatePills: [...document.querySelectorAll('.pageintro__label')].some(
        (e) => e.textContent.trim() === 'Popular now',
      ),
    }));

    is(m.heading === heading, `${path} @${width}: the row is "${heading}"`, `it says "${m.heading}"`);
    is(m.cards >= 6, `${path} @${width}: the row is full enough to be a row`, `${m.cards} cards`);
    is(m.overflow === 0, `${path} @${width}: nothing escapes the viewport`, `overflow ${m.overflow}px`);

    const past = /ago|Today|Yesterday|Last week/;
    const future = /^(Tomorrow|In \d+ days|Next week|In \d+ weeks)$/;
    const year = /^(19|20)\d\d$/;
    const rule = expect === 'past' ? past : expect === 'future' ? future : year;
    const wrong = m.captions.filter((c) => !rule.test(c));
    is(
      m.captions.length > 0 && wrong.length === 0,
      `${path} @${width}: every caption points ${expect}`,
      `"${wrong.join('", "')}" under a heading that says ${heading}`,
    );

    if (path === '/streaming') {
      is(!m.duplicatePills, `${path} @${width}: the old pill row is gone`, 'the same titles render twice');
    }
    is(errors.length === 0, `${path} @${width}: no console errors`, errors[0]);
    await ctx.close();
  }
}

// --- other pages still work -------------------------------------------------

console.log('\nOther routes');
for (const path of ['/streaming', '/upcoming', '/hindi', '/netflix']) {
  const { ctx, page, errors } = await newPage(browser, { width: 390, height: 844 });
  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  const m = await page.evaluate(() => {
    const d = document.documentElement;
    return { overflow: d.scrollWidth - d.clientWidth, rows: document.querySelectorAll('.board li, .grid > *').length };
  });
  is(m.overflow === 0 && m.rows > 0, `${path} renders and fits`, `overflow ${m.overflow}px, ${m.rows} rows`);
  is(errors.length === 0, `${path}: no console errors`, errors[0]);
  await ctx.close();
}

await browser.close();
server.close();

console.log(`\n${checks - failures} passed, ${failures} failed`);
if (KEEP) console.log(`screenshots in ${SHOTS}`);
process.exit(failures ? 1 : 0);
