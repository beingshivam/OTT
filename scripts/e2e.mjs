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

// --- the cinema / OTT split --------------------------------------------------

/**
 * The two rows under "On right now", checked as behaviour rather than markup.
 *
 * The split exists because cinema and streaming decay at different rates and a
 * single row had to pick one window, so what is worth asserting is that each
 * row holds only its own kind, that each states its own span (the counts come
 * from different windows and must never read as comparable), and that showing
 * both does not push the board off the screen — which is the cost the design
 * was chosen against and the thing most likely to regress silently.
 */
console.log('\nOn right now: in cinemas / on OTT');
for (const [width, height] of [[360, 780], [390, 844], [1280, 900]]) {
  const { ctx, page, errors } = await newPage(browser, { width, height });
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.landed__cell');

  const rows = page.locator('.landed--sub');
  is(await rows.count() === 2, `${width}px: both rows render`, `${await rows.count()} rows`);

  const titles = await page.evaluate(() =>
    [...document.querySelectorAll('.landed--sub .landed__title')].map((e) => e.textContent.trim()),
  );
  is(
    titles[0] === 'In cinemas' && titles[1] === 'On OTT',
    `${width}px: cinemas leads, OTT follows`,
    titles.join(' / '),
  );

  /*
    Cards are counted as cards, and the platform pill is asserted separately.

    This used to count badges and call the result "both rows have cards", which
    silently stopped meaning that the day the cinema row dropped its pill: every
    card in that row is theatrical, so printing "Theatres" across all of them
    was a label repeated until it stopped being read. The count and the pill are
    two different claims and now fail for two different reasons.
  */
  const cards = await page.evaluate(() =>
    [...document.querySelectorAll('.landed--sub')].map(
      (row) => row.querySelectorAll('.landed__cell').length,
    ),
  );
  is(cards[0] > 0 && cards[1] > 0, `${width}px: both rows have cards`, `${cards.join(' / ')} cards`);

  /*
    The OTT row names the service on every card; the cinema row names none.

    "Which OTT is it on" was the single commonest piece of feedback on this row,
    and the answer used to be an 18px logo with no words next to it. It is now a
    pill carrying the mark and the name — and the cinema row, where the heading
    already answers it, carries nothing.
  */
  const pills = await page.evaluate(() =>
    [...document.querySelectorAll('.landed--sub')].map((row) => ({
      cells: row.querySelectorAll('.landed__cell').length,
      named: [...row.querySelectorAll('.landed__badgename')]
        .map((e) => e.textContent.trim())
        .filter(Boolean).length,
    })),
  );
  /* Not "no pills" — "no pill that repeats the heading". A cinema card that is
     also streaming now names the service, which is the one fact "In cinemas"
     does not already give. */
  const saysTheatres = await page.evaluate(() =>
    [...document.querySelectorAll('.landed--sub')[0].querySelectorAll('.landed__badgename')]
      .map((e) => e.textContent.trim())
      .filter((t) => /cinema|theatre/i.test(t)).length,
  );
  is(saysTheatres === 0, `${width}px: the cinema row does not repeat "Theatres"`,
     `${saysTheatres} cards label a cinema row "Theatres"`);
  is(pills[1].named === pills[1].cells, `${width}px: every OTT card names its service`,
     `${pills[1].named} of ${pills[1].cells} named`);

  /*
    The cinema row ranks by attention, and says so.

    A cinema run lasts six weeks, so strict date order buried the biggest film
    on the board: Mirzapur: The Movie was the highest-attention title in Indian
    cinemas and sat nineteenth, behind eighteen that had merely opened later.
    The whole row ranks now rather than just its head, and that is only
    defensible if the reader can see it — a row of posters is read as a
    calendar unless something says otherwise — so the chip is asserted, not
    just the ordering.
  */
  const hot = await page.evaluate(() => {
    const row = document.querySelectorAll('.landed--sub')[0];
    const cells = [...row.querySelectorAll('.landed__cell')];
    return {
      marked: cells.filter((c) => c.querySelector('.landed__hot')).length,
      leading: cells.slice(0, 3).filter((c) => c.querySelector('.landed__hot')).length,
      names: cells.slice(0, 1).map((c) => c.querySelector('.landed__name')?.textContent?.trim()),
    };
  });
  /*
    Nothing on a card may sit on top of anything else on it.

    The chip used to be top-right, opposite the platform badge, and that held
    only while no row showed both. The streaming row does, and at 360px a card
    is 133px against a 75px chip and a 75px badge — TRENDING landed on the
    platform name and Netflix rendered as "N". Caught by looking, which is the
    thing this file exists to stop being necessary, so the geometry is measured
    here at every width instead of being asserted in a comment.
  */
  const collisions = await page.evaluate(() => {
    /* Clearance, not merely absence of overlap. Two pills a pixel apart have
       not collided and still read as one smear, and the margin here is thin by
       necessity: at 320px the card is 132px and the chip and score take 115 of
       it between the insets. Two pixels is the floor at which they are still
       visibly two things. */
    const MIN_GAP = 2;
    const out = [];
    for (const cell of document.querySelectorAll('.landed__cell')) {
      const parts = ['.landed__badge', '.landed__hot', '.landed__score']
        .map((sel) => [sel, cell.querySelector(sel)?.getBoundingClientRect()])
        .filter(([, r]) => r && r.width > 0);
      for (let i = 0; i < parts.length; i++) {
        for (let j = i + 1; j < parts.length; j++) {
          const [an, a] = parts[i];
          const [bn, b] = parts[j];
          // Apart on either axis is apart; only a pair overlapping on both is
          // sharing space.
          const gapX = Math.max(a.left - b.right, b.left - a.right);
          const gapY = Math.max(a.top - b.bottom, b.top - a.bottom);
          if (Math.max(gapX, gapY) < MIN_GAP) {
            const name = cell.querySelector('.landed__name')?.textContent?.trim();
            out.push(`${name}: ${an} and ${bn} are ${Math.max(gapX, gapY).toFixed(0)}px apart`);
          }
        }
      }
    }
    return out;
  });
  is(collisions.length === 0, `${width}px: every chip on a card has room of its own`, collisions.slice(0, 3).join('; '));

  /*
   * The freshness dot sits on the same line as the date it describes.
   *
   * The phone rule that gives the week heading its own line — added so the
   * range stopped rendering as "11 – 17 Se…" — put the heading at 100% width
   * and left the dot stranded on the line above, alone. Two separate fixes
   * fighting, and the sort of thing that reads as broken without looking like
   * anything a size or overflow check would catch.
   */
  const label = await page.evaluate(() => {
    const dot = document.querySelector('.controls__fresh i');
    const head = document.querySelector('.controls__heading');
    if (!dot || !head) return null;
    const d = dot.getBoundingClientRect();
    const h = head.getBoundingClientRect();
    return { gap: Math.abs(d.top + d.height / 2 - (h.top + h.height / 2)), text: head.textContent.trim() };
  });
  if (label) {
    is(
      label.gap < 12,
      `${width}px: the freshness dot rides with the date, not above it`,
      `${label.gap.toFixed(0)}px apart vertically`,
    );
  }

  /*
    And the platform name is readable, not a first initial.

    "Which OTT is it on" is the commonest piece of feedback this site has had.
    A badge squeezed to 40px by something beside it answers it with "N", which
    is the same failure as not showing it at all — and it passes a test that
    only checks the pill exists.
  */
  const squeezed = await page.evaluate(() =>
    [...document.querySelectorAll('.landed--sub')[1].querySelectorAll('.landed__cell')]
      .map((c) => {
        const el = c.querySelector('.landed__badgename');
        if (!el) return null;
        // scrollWidth beyond clientWidth is text the reader cannot see.
        return el.scrollWidth > el.clientWidth + 1 ? el.textContent.trim() : null;
      })
      .filter(Boolean),
  );
  is(squeezed.length === 0, `${width}px: every service name fits its pill`, `clipped: ${squeezed.join(', ')}`);

  is(hot.marked === 3, `${width}px: three cinema cards are marked trending`, `${hot.marked} marked`);
  is(hot.leading === 3, `${width}px: and they are the three at the front`,
     `${hot.leading} of the first three carry the chip`);
  is(
    hot.names[0] === 'Mirzapur: The Movie',
    `${width}px: the biggest film in cinemas leads the row`,
    `the row opens with "${hot.names[0]}"`,
  );

  /*
    No window in the subtitle. It said "last 6 weeks" under a tab that says
    "This week" — a contradiction the reader has to resolve before trusting
    either. Recency now lives on each card, where it is per title and true.
  */
  const subs = await page.evaluate(() =>
    [...document.querySelectorAll('.landed--sub .landed__sub')].map((e) => e.textContent.trim()),
  );
  is(
    subs.length === 2 && subs.every((t) => !/week|day/i.test(t)),
    `${width}px: no row claims a window that fights the tab`,
    subs.join(' / '),
  );
  is(
    // The arrow is the "see all" affordance on the cinema row, decorative and
    // aria-hidden — the claim being tested is that the row states a count.
    subs.every((t) => /^\d+ titles(\s*→)?$/.test(t)),
    `${width}px: each row says how much it holds`,
    subs.join(' / '),
  );

  // A subtitle that ellipsises loses its count.
  const clipped = await page.evaluate(() =>
    [...document.querySelectorAll('.landed--sub .landed__sub')].filter(
      (e) => e.scrollWidth > e.clientWidth + 1,
    ).length,
  );
  is(clipped === 0, `${width}px: neither subtitle is cut off`, `${clipped} truncated`);

  /*
    Two full posters and a glimpse of a third.

    Four cards fit a phone only by shrinking each to 92px, at which point the
    poster stops earning its place. Below two, the row stops being a row. The
    partial third is what says it scrolls.
  */
  const fit = await page.evaluate(() => {
    const row = document.querySelector('.landed--sub');
    const cell = row.querySelector('.landed__cell');
    const w = cell.getBoundingClientRect().width;
    return (row.querySelector('.landed__track').clientWidth + 10) / (w + 10);
  });
  // The ceiling is a phone constraint: a 1280px desktop has room for a proper
  // row and capping it there would waste the width, so only the floor applies.
  const ceiling = width < 700 ? 3.2 : Infinity;
  is(
    fit >= 2 && fit < ceiling,
    `${width}px: two posters and a peek, not a wall of thumbnails`,
    `${fit.toFixed(2)} cards visible`,
  );

  /*
    Both rows on the first screen.

    This replaced an assertion that the *board* reached the first screen, which
    bigger posters made false. The trade was deliberate: the first screen is now
    what is new in both places, and the calendar begins immediately under it. So
    what has to hold is that neither row is stranded below the fold — a second
    row a reader never sees is the toggle's problem all over again, with none of
    its compactness.
  */
  const secondRowBottom = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.landed--sub')];
    const r = rows[rows.length - 1].getBoundingClientRect();
    return Math.round(r.bottom + scrollY);
  });
  is(
    secondRowBottom <= height,
    `${width}px: both rows land on the first screen`,
    `the OTT row ends at ${secondRowBottom}px against a ${height}px fold`,
  );

  is(errors.length === 0, `${width}px: no console errors`, errors[0]);
  await ctx.close();
}

// --- the scroll hint ------------------------------------------------------

/**
 * The row moves once, then never again.
 *
 * Asked whether the rail should auto-advance. It should not — a drifting row
 * moves the card a thumb is already travelling towards, and anything
 * auto-moving beside other content owes WCAG 2.2.2 a pause control. But the
 * question exposed a real gap: only an edge fade and a cut-off card say the row
 * continues. So it nudges 44px and returns.
 *
 * Worth testing rather than eyeballing, because the first build of it silently
 * did nothing: scroll snapping pulled the 44px straight back to the nearest
 * snap point, one frame after it moved. Peak travel is the assertion that
 * catches that; settling back to 0 is what proves it took nobody's place.
 */
console.log('\nThe scroll hint');
for (const [label, width, height, reduced, shouldNudge] of [
  ['phone', 390, 844, false, true],
  ['phone, reduced motion', 390, 844, true, false],
  ['desktop', 1280, 900, false, false],
]) {
  const ctx = await browser.newContext({
    viewport: { width, height },
    reducedMotion: reduced ? 'reduce' : 'no-preference',
  });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    window.__peak = 0;
  });
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.landed__cell');
  await page.evaluate(() => {
    const tick = () => {
      const el = document.querySelector('.landed--sub .landed__track');
      if (el) window.__peak = Math.max(window.__peak, el.scrollLeft);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.waitForTimeout(3200);

  const m = await page.evaluate(() => {
    const el = document.querySelector('.landed--sub .landed__track');
    return {
      peak: Math.round(window.__peak),
      settled: Math.round(el.scrollLeft),
      snap: getComputedStyle(el).scrollSnapType,
      others: [...document.querySelectorAll('.landed--sub .landed__track')].map((e) =>
        Math.round(e.scrollLeft),
      ),
    };
  });

  if (shouldNudge) {
    is(m.peak > 20, `${label}: the row hints that it scrolls`, `travelled ${m.peak}px`);
  } else {
    // Pointer devices get the arrows; reduced motion gets nothing that moves.
    is(m.peak === 0, `${label}: no hint where it does not belong`, `travelled ${m.peak}px`);
  }
  is(m.settled === 0, `${label}: the hint gives the row back`, `left at ${m.settled}px`);
  is(
    m.snap !== 'none',
    `${label}: snapping is restored afterwards`,
    `scroll-snap-type left as "${m.snap}"`,
  );
  is(
    m.others.every((x) => x === 0),
    `${label}: no row is left mid-scroll`,
    `rows at [${m.others}]`,
  );
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

// --- search reaches past the week on screen ----------------------------------

/**
 * The regression this guards is silent and was live for months: search filtered
 * the week the board happened to be showing, so a reader who typed a real title
 * releasing three weeks out was told "no matches in this week" and reasonably
 * concluded the site did not have it. Nothing errored, nothing looked broken,
 * and the near-miss buttons underneath made it look considered.
 *
 * So the assertion is deliberately the strong one — a title the board is not
 * currently showing must be findable by name — rather than "the box filters
 * something".
 */
console.log('\nSearch is global');
{
  const { ctx, page, errors } = await newPage(browser, { width: 1440, height: 900 });
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.controls__row');

  const onScreen = await page.evaluate(() =>
    [...document.querySelectorAll('.row__title')].map((el) => el.textContent.trim()),
  );

  // A title the current week does not carry, drawn from the feed the page is
  // actually serving, so this stays true as the calendar rolls forward.
  const feed = JSON.parse(await readFile(join(DIST, 'data/releases.json'), 'utf8'));
  const elsewhere = feed.weeks
    .flatMap((w) => w.releases)
    .filter((r) => (r.regions ?? []).includes('IN'))
    .find((r) => r.title.length > 6 && !onScreen.some((t) => t.startsWith(r.title)));

  if (!elsewhere) {
    bad('a title exists outside the current week', 'the feed holds only this week');
  } else {
    await page.fill('.search input[type=search]', elsewhere.title);
    await page.waitForTimeout(700);

    const found = await page.evaluate((title) => ({
      heading: document.querySelector('.controls__heading')?.textContent ?? '',
      hit: [...document.querySelectorAll('.row__title')].some((el) =>
        el.textContent.trim().startsWith(title),
      ),
      stepper: !!document.querySelector('.controls__row .weeknav'),
      empty: !!document.querySelector('.empty'),
    }), elsewhere.title);

    is(found.hit, `"${elsewhere.title}" is found from another week`, 'the query stayed inside the week');
    is(!found.empty, 'and the board is not the empty state', 'it said there were no matches');
    is(
      /results? for/.test(found.heading),
      'the heading names the search rather than a week',
      `heading was "${found.heading}"`,
    );
    is(!found.stepper, 'the week stepper stands down', 'the arrows would step a week nothing is drawn from');

    // And clearing it puts the week back, rather than leaving the board global.
    await page.locator('.search__clear').click();
    await page.waitForTimeout(500);
    is(
      !!(await page.evaluate(() => document.querySelector('.controls__row .weeknav'))),
      'clearing the query returns the week',
      'the board stayed in search mode',
    );
  }

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
  /**
   * The poster grid must ask *our* origin for artwork, not TMDB's.
   * image.tmdb.org sends no Access-Control-Allow-Origin, so a canvas that draws
   * from it cannot be read back — which is why the first live poster card came
   * out as coloured gradients. The Worker re-serves those bytes from /img/, and
   * this counts the requests that prove the card is using it.
   */
  const proxied = [];
  await page.route('**/img/**', (r) => {
    proxied.push(new URL(r.request().url()).pathname);
    return r.fulfill({ status: 200, contentType: 'image/png', body: PIXEL });
  });
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

    if (kind === 'posters') {
      is(
        proxied.length > 0 && proxied.every((p) => /^\/img\/(w\d+|original)\//.test(p)),
        `${width}px: the poster card asks our own origin for artwork`,
        proxied.length === 0
          ? 'it went straight to TMDB, whose images a canvas cannot read back'
          : `unexpected paths: ${proxied.slice(0, 3).join(', ')}`,
      );
    }
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

// --- what a filter does to the page -------------------------------------------

/**
 * Two checks that came out of a tester pass rather than a bug report, after
 * being told — fairly — that this was too much back and forth.
 *
 * The first: selecting a platform used to remove both poster rails, so tapping
 * a chip made two thirds of the page vanish and the only way back was to undo
 * your own filter. The rails narrow with the reader now, and a rail with
 * nothing left stands down on its own rather than taking its neighbour with it.
 *
 * The second: every visible control must have a name a screen reader can say.
 * Three of them did not on a phone and did on a desktop, because the label is
 * inside a span that is display:none below the breakpoint — which takes it out
 * of the accessibility tree along with the pixels. That is invisible to
 * looking, invisible to a type checker, and invisible to every other check in
 * this file.
 */
console.log('\nFiltering, and what it leaves behind');
for (const width of [360, 1280]) {
  const { ctx, page, errors } = await newPage(browser, { width, height: 900 });
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.landed__cell', { timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(900);

  const nameless = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('button, a[href], [role="tab"]')) {
      const box = el.getBoundingClientRect();
      if (!box.width && !box.height) continue;
      // Deliberately hidden from assistive tech is not the same as unnamed —
      // the rail arrows duplicate the keyboard and say so.
      if (el.closest('[aria-hidden="true"]')) continue;
      const labelled = el.getAttribute('aria-label') || el.getAttribute('title') || '';
      // Only text a screen reader would actually reach: a label inside a
      // display:none span is gone from the tree, not merely invisible.
      const spoken = [...el.childNodes]
        .map((n) =>
          n.nodeType === 3
            ? n.textContent
            : n.nodeType === 1 && getComputedStyle(n).display !== 'none'
              ? n.textContent
              : '',
        )
        .join('')
        .trim();
      if (!labelled && !spoken) out.push(el.className || el.tagName);
    }
    return out;
  });
  is(
    nameless.length === 0,
    `${width}px: every visible control has a name`,
    `unnamed: ${[...new Set(nameless)].slice(0, 4).join(', ')}`,
  );

  // The platform chips live in the poster view.
  await page.locator('.viewtoggle button').nth(1).click();
  await page.waitForTimeout(700);
  const chips = await page.locator('.chip--logo').count();
  is(chips > 0, `${width}px: the poster view offers platform chips`, `${chips} chips`);

  /*
   * Every chip, not just the first one.
   *
   * Reported twice, the second time after this check was already passing:
   * "when I select this filter on clicking on either theatre, OTT or Netflix
   * magically the top rails go away". Clicking one chip proved nothing, because
   * the chip that emptied the band was a *particular* one — the synthetic `ott`
   * platform, which belongs to neither rail, so filtering to it left both with
   * nothing while Netflix and Cinemas both looked fine.
   *
   * The placeholder is gone, and the way to keep it gone is to click all of
   * them. Each is a filter a reader can actually apply, so each has to leave a
   * page behind.
   */
  const labels = await page.locator('.chip--logo').allInnerTexts();
  for (let i = 0; i < chips; i++) {
    const name = (labels[i] ?? `chip ${i}`).replace(/\s+/g, ' ').trim();
    await page.locator('.chip--logo').nth(i).click();
    await page.waitForTimeout(650);
    const after = await page.evaluate(() => ({
      rails: document.querySelectorAll('.landed--sub').length,
      cards: document.querySelectorAll('.card').length,
      chips: document.querySelectorAll('.chip--logo').length,
    }));
    is(after.cards > 0, `${width}px: "${name}" leaves a board`, `${after.cards} cards`);
    is(after.rails > 0, `${width}px: "${name}" leaves a rail`, 'the band above the board emptied');
    is(after.chips > 0, `${width}px: "${name}" leaves a way back out`, 'the chips vanished with the filter');
    /* Back to everything before the next one. Not by clicking the chip again:
       the counts recompute under an active filter, so the list re-renders and
       nth(i) is no longer the chip just pressed. A reload is the only way to
       be sure each chip is tested as a single filter rather than as an
       intersection of two that legitimately holds nothing. */
    await page.reload({ waitUntil: 'networkidle' });
    await page.locator('.viewtoggle button').nth(1).click();
    await page.waitForTimeout(500);
  }

  /*
   * A chip that says what a platform is called, not what its id is.
   *
   * platform() falls back to the raw id when the registry has no entry, so a
   * row referring to a platform that no longer exists renders a pill reading,
   * literally, "ott" — quieter than a crash and worse to look at. Any all
   * lower-case single word is that fallback showing through: every real name
   * in the registry is capitalised.
   */
  const rawIds = (await page.locator('.chip--logo').allInnerTexts())
    .map((t) => t.replace(/\s+/g, ' ').trim().split(' ')[0])
    .filter((t) => /^[a-z][a-z0-9]*$/.test(t));
  is(
    rawIds.length === 0,
    `${width}px: every chip names a platform rather than an id`,
    `raw ids on screen: ${rawIds.join(', ')}`,
  );
  is(errors.length === 0, `${width}px: filtering raises no console errors`, errors[0]);
  await ctx.close();
}

// --- what the audit found, kept so it cannot come back ------------------------

/**
 * Two findings from an end-to-end audit that no report had surfaced.
 *
 * Every language the data carries must have a name. The fallback prints the
 * raw code, so a Chinese title read "ZH · Drama" and the language filter
 * offered a chip labelled "AR" — silent, because nobody reports a two-letter
 * code, they just do not click it.
 *
 * And every target on a touch device must reach 44px. The earlier touch pass
 * raised the icon buttons and the chips, which are the things that look like
 * controls, and left four links made of words: the wordmark at 26px, the
 * Instagram link at 34, the TMDB credit at 14, and "87 titles →" at 20 — the
 * narrowest thing on the page, and the only route to the full cinema list.
 */
console.log('\nNames and targets');
{
  const feedRaw = await readFile(join(ROOT, 'dist/data/releases.json'), 'utf8').catch(() => null);
  const registry = await readFile(join(ROOT, 'src/data/platforms.ts'), 'utf8').catch(() => '');
  if (feedRaw && registry) {
    const named = new Set(
      [...(registry.match(/LANGUAGES[^{]*\{([\s\S]*?)\n\};/) ?? ['', ''])[1].matchAll(/(\w+):\s*'/g)].map(
        (m) => m[1],
      ),
    );
    const unnamed = new Set();
    for (const w of JSON.parse(feedRaw).weeks)
      for (const r of w.releases) for (const l of r.languages ?? []) if (!named.has(l)) unnamed.add(l);
    is(
      unnamed.size === 0,
      'every language in the feed has a name the UI can print',
      `raw codes would reach the page: ${[...unnamed].join(', ')}`,
    );
  }
}
{
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 3,
  });
  const page = await ctx.newPage();
  await page.route('**fonts.g**', (r) => r.abort());
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.landed__cell', { timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(900);
  const small = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('button, a[href]')) {
      if (el.closest('[aria-hidden="true"]')) continue;
      const box = el.getBoundingClientRect();
      if (!box.height) continue;
      // An inset ::after is how this file grows a hit area without moving the
      // text, so the measurement has to look for one.
      const after = getComputedStyle(el, '::after');
      let h = box.height;
      if (after.content && after.content !== 'none' && after.position === 'absolute') {
        const ah = parseFloat(after.height);
        if (ah > h) h = ah;
      }
      if (h < 40) out.push(`${Math.round(h)}px ${(el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 20)}`);
    }
    return out;
  });
  is(small.length === 0, 'every target on a touch device is reachable with a thumb', small.slice(0, 3).join(', '));
  await ctx.close();
}

// --- one row per lens, each true to its own page ------------------------------

console.log('\nA rail on every lens');

/**
 * The three rows must not be the same row. "Landing soon" over films that are
 * already out is a false statement and the catalogue's row is the homepage
 * again — so this asserts the heading, and that the captions are pointing the
 * direction the heading claims.
 */
for (const [path, heading, expect] of [
  ['/', 'On right now', 'past'],
  ['/upcoming', 'Landing soon', 'future'],
  ['/streaming', 'Popular now', 'year'],
]) {
  for (const width of [390, 1440]) {
    const { ctx, page, errors } = await newPage(browser, { width, height: 900 });
    await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.landed__cell', { timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(900);

    const m = await page.evaluate(() => ({
      // On the homepage the name of the band is the section heading; the two
      // rows inside it carry their own. Everywhere else the row is the section.
      heading:
        document.querySelector('.landedpair__title')?.textContent?.trim() ??
        document.querySelector('.landed__title')?.textContent?.trim() ??
        null,
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

// --- a phone can actually hit things ----------------------------------------

/**
 * Touch targets, measured rather than declared.
 *
 * There was already a `@media (pointer: coarse)` block raising these to 44px,
 * with a comment explaining why it mattered, and it had never once applied:
 * `.controls__row .weeknav__btn` sets 28px in the phone breakpoint and a media
 * query adds no specificity, so the narrower selector won on exactly the
 * devices the block was written for. The week arrows measured 28.
 *
 * A rule that can lose silently needs a test that measures the result, not one
 * that greps the stylesheet. So this runs a real touch context and asks the
 * page how big its controls came out — and where the visible control is
 * deliberately smaller than its target, it hit-tests the gap.
 */
console.log('\nTouch targets');
{
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.landed__cell');

  is(
    await page.evaluate(() => matchMedia('(pointer: coarse)').matches),
    'the touch stylesheet is in play at all',
    'pointer: coarse does not match, so nothing below proves anything',
  );

  // iOS magnifies any focused input under 16px and does not zoom back out.
  const inputs = await page.evaluate(() =>
    [...document.querySelectorAll('input')].map((e) => parseFloat(getComputedStyle(e).fontSize)),
  );
  is(
    inputs.length > 0 && inputs.every((px) => px >= 16),
    'no input is small enough to make iOS zoom',
    `font sizes: ${inputs.join(', ')}px`,
  );

  // The controls a reader uses most, by their rendered height.
  const sized = await page.evaluate(() => {
    const h = (sel) => {
      const e = document.querySelector(sel);
      return e ? Math.round(e.getBoundingClientRect().height) : 0;
    };
    return {
      week: h('.controls__row .weeknav__btn'),
      view: h('.controls__row .viewtoggle button'),
      filters: h('.controls__row .btn'),
      lens: h('.lens'),
      browse: h('.browse__chip'),
    };
  });
  for (const [name, px] of Object.entries(sized)) {
    is(px >= 40, `${name} is a fingertip, not a pixel (${px}px)`, `${name} came out ${px}px`);
  }

  /*
    Growing a control must not move what is inside it.
    
    The first touch pass reached 44px on the lens nav by switching it to
    inline-flex, which blockified to flex — and the phone breakpoint centres
    these labels with `text-align: center`, which does not position flex items.
    Every label jumped to the left edge of a pill that is still equal-width via
    `flex: 1 1 0`: "This week" sat with 6px to its left and 36px of dead space
    to its right, on the first row of the homepage.
    
    The check that shipped alongside that change asserted the height, which was
    the number being changed and therefore the one thing guaranteed to be right.
    This asserts the thing that broke.
  */
  const centred = await page.evaluate(() =>
    [...document.querySelectorAll('.lens')].map((e) => {
      const pill = e.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(e);
      const text = range.getBoundingClientRect();
      return {
        label: e.textContent.trim(),
        left: Math.round(text.left - pill.left),
        right: Math.round(pill.right - text.right),
      };
    }),
  );
  const lopsided = centred.filter((c) => Math.abs(c.left - c.right) > 2);
  is(
    lopsided.length === 0,
    'every lens label is centred in its pill',
    lopsided.map((c) => `"${c.label}" ${c.left}px left, ${c.right}px right`).join('; '),
  );

  /*
    The other thing bigger controls cost: the board's own title.
    
    28px arrows to 44px took exactly the 32px the heading needed, and it
    rendered "11 – 17 Se…" — a date range that no longer names its month. The
    row wraps now, so this asserts the words survive rather than that the row
    fits, which it did either way.
  */
  const head = await page.evaluate(() => {
    const h = document.querySelector('.controls__heading');
    return { clipped: h.scrollWidth > h.clientWidth + 1, text: h.textContent.trim() };
  });
  is(!head.clipped, 'the week heading is not cut off', `heading reads "${head.text}" and is clipped`);

  /*
    The rail's count is a promise, and /in-cinemas is where it is kept.

    "In cinemas · 89 titles" above a row of twenty was the whole of the site's
    answer to what is playing; the other sixty-nine were reachable only by
    already knowing a title. The two numbers also have to be the same number —
    the rail gated its total on having a poster while the page did not, so the
    link said 89 and the page said 93.
  */
  const railCount = await page.evaluate(() => {
    const a = document.querySelector('.landed__all');
    return a ? { href: a.getAttribute('href'), text: a.textContent.trim() } : null;
  });
  is(railCount?.href === '/in-cinemas', 'the cinema count links to the full list',
     railCount ? `it points at ${railCount.href}` : 'there is no link on the count');

  await page.goto(`${BASE}/in-cinemas`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.controls__heading');
  const pageCount = await page.evaluate(
    () => document.querySelector('.controls__heading')?.textContent?.trim() ?? '',
  );
  const n = (t) => Number((t || '').match(/\d+/)?.[0] ?? -1);
  is(
    n(railCount?.text) === n(pageCount) && n(pageCount) > 0,
    'and promises the number that page actually holds',
    `rail said "${railCount?.text}", page says "${pageCount}"`,
  );

  // Back to the homepage: the press check below needs a poster card, and
  // /in-cinemas is a board with no rail on it.
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.landed__cell');

  /*
    The header icons stay 34px on purpose — that row already spends 346 of 358
    available pixels at 390px, and growing them overflows the narrowest phones.
    They get the target through an invisible box instead, so the assertion has
    to be a tap rather than a measurement.
  */
  const reach = await page.evaluate(() => {
    const out = {};
    for (const sel of ['.iconbtn', '.searchbox__toggle']) {
      const el = document.querySelector(sel);
      if (!el) { out[sel] = 'absent'; continue; }
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left - 4, r.top + r.height / 2);
      out[sel] = hit && (hit === el || el.contains(hit)) ? 'hit' : 'miss';
    }
    return out;
  });
  is(reach['.iconbtn'] === 'hit', 'a thumb landing beside a header icon still hits it',
     `.iconbtn: ${reach['.iconbtn']}`);
  is(reach['.searchbox__toggle'] === 'hit', 'and beside the search toggle',
     `.searchbox__toggle: ${reach['.searchbox__toggle']}`);

  /*
    A tap has to be acknowledged.

    The stylesheet had forty-odd :hover rules and not one :active — a complete
    design for a mouse and an empty one for a finger, since a finger never
    hovers. Every tap went unacknowledged until the next screen arrived, and
    iOS filled the silence with its default grey box. Held down rather than
    clicked, because the whole point is what happens *during* the press.
  */
  const card = page.locator('.landed__card').first();
  const b = await card.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(140);
  const pressed = await card.evaluate((e) => ({
    transform: getComputedStyle(e).transform,
    opacity: Number(getComputedStyle(e).opacity),
    highlight: getComputedStyle(e).webkitTapHighlightColor,
  }));
  await page.mouse.up();
  await page.waitForTimeout(250);
  const released = await card.evaluate((e) => getComputedStyle(e).transform);

  is(pressed.transform !== 'none' || pressed.opacity < 1,
     'a held card visibly responds', 'nothing changes while a card is pressed');
  is(released === 'none', 'and returns when released', `left at ${released}`);
  is(/rgba\(0, 0, 0, 0\)|transparent/.test(pressed.highlight),
     "iOS's grey tap box is turned off, since we draw our own",
     `tap highlight is ${pressed.highlight}`);

  await ctx.close();
}

// --- other pages still work -------------------------------------------------

console.log('\nOther routes');
for (const path of ['/streaming', '/upcoming', '/in-cinemas', '/hindi', '/netflix']) {
  const { ctx, page, errors } = await newPage(browser, { width: 390, height: 844 });
  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  const m = await page.evaluate(() => {
    const d = document.documentElement;
    return {
      overflow: d.scrollWidth - d.clientWidth,
      rows: document.querySelectorAll('.board li, .grid > *').length,
      // A named empty state, with words in it. The distinction below turns on
      // this being a deliberate explanation rather than an empty container.
      empty: document.querySelector('.empty h3')?.textContent?.trim() ?? '',
    };
  });
  /*
    Two claims, split, because they fail for different reasons.

    They used to be one assertion — fits AND has rows — and it went red on a
    Friday morning for something that was not a defect. /netflix carried no
    titles because the calendar week had just rolled over and TMDB assigns a
    streaming provider only once a title is actually out, which is the whole
    reason a second refresh runs on Saturday. The page was fine; the week was
    genuinely empty for four more hours.

    A test that goes red every Friday for a correct page is a test that gets
    ignored, and this repository has already been caught measuring one thing
    while claiming another — counting badges and calling it "both rows have
    cards". So: the layout claim stands on its own, and the content claim
    accepts an empty state, because what must never happen is a page that
    renders nothing and explains nothing.
  */
  is(m.overflow === 0, `${path} fits its viewport`, `overflow ${m.overflow}px`);
  is(
    m.rows > 0 || m.empty.length > 0,
    `${path} shows either titles or a reason there are none`,
    `${m.rows} rows and no empty state`,
  );
  is(errors.length === 0, `${path}: no console errors`, errors[0]);
  await ctx.close();
}

await browser.close();
server.close();

console.log(`\n${checks - failures} passed, ${failures} failed`);
if (KEEP) console.log(`screenshots in ${SHOTS}`);
process.exit(failures ? 1 : 0);
