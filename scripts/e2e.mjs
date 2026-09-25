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
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const SHOTS = join(ROOT, '.e2e');
const KEEP = process.argv.includes('--keep');

/*
 * How many cards at the head of a rail are the ranking rather than the news,
 * read from the app rather than written down here. A literal 3 in this file is
 * how the row came to be three cards of week-old ranking on a screen that
 * shows three cards.
 */
const LEAD_CARDS = await (async () => {
  const d = mkdtempSync(join(tmpdir(), 'e2e-rails-'));
  execFileSync(
    'npx',
    ['--yes', 'esbuild', 'src/lib/rails.ts', '--bundle', '--format=esm', `--outfile=${join(d, 'rails.mjs')}`],
    { stdio: 'pipe' },
  );
  return (await import(join(d, 'rails.mjs'))).TRENDING_IN_CINEMAS;
})();

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
    const url = new URL(req.url, 'http://x');
    const path = decodeURIComponent(url.pathname);

    /*
     * The two Worker routes, stubbed.
     *
     * dist is static files; /api/search and /api/title only exist at the edge,
     * so without this the search dropdown has no wider half and the sheet a
     * remote result opens can only ever render its error state. Stubbed rather
     * than skipped because the wiring between them — a result carrying an id
     * that the sheet then asks about — is exactly the part that breaks
     * silently, and neither the worker tests nor the unit tests can see it.
     */
    if (path === '/api/search') {
      const q = url.searchParams.get('q') ?? '';
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(
        JSON.stringify(
          q
            ? { remote: true, total: 1, results: [{ kind: 'film', id: 'm-278', title: 'A Film Only TMDB Has', year: '1994', image: null, lang: 'en' }] }
            : { remote: true, results: [], total: 0 },
        ),
      );
    }
    if (path === '/api/title') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(
        JSON.stringify({
          remote: true, id: 'm-278', kind: 'film', title: 'A Film Only TMDB Has', year: '1994',
          synopsis: 'A synopsis.', posterUrl: null, backdropUrl: null, runtimeMinutes: 142,
          genres: ['Drama'], languages: ['en'], certification: 'A', rating: 8.7,
          cast: ['Someone', 'Someone Else'], director: 'A Director',
          providerIds: [8], rentBuyIds: [], seasons: null,
          similar: [
            { id: 'm-13', title: 'Something Else Entirely', year: '1994', image: null },
            { id: 't-1396', title: 'A Series To Go To', year: '2008', image: null },
          ],
        }),
      );
    }

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

async function newPage(browser, { width, height, seen = true, reducedMotion, slowImages = false, touch = false }) {
  const ctx = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
    reducedMotion,
    /* A phone is not a narrow desktop. The touch stylesheet raises every input
       to 16px so iOS does not magnify the page, which makes the header's copy
       measurably wider than the same width without it — and that is exactly
       where a placeholder runs out of field. Off by default so the existing
       checks keep measuring what they were written against. */
    isMobile: touch || undefined,
    hasTouch: touch || undefined,
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
      /* Where the chips are, not how many: the badge has to sit at the head of
         the row, wherever the head ends. */
      firstUnmarked: cells.findIndex((c) => !c.querySelector('.landed__hot')),
      names: cells.slice(0, 4).map((c) => c.querySelector('.landed__name')?.textContent?.trim()),
      dates: cells.slice(0, 4).map((c) => c.querySelector('.landed__meta')?.textContent?.trim()),
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

  /*
   * One badged card, at the front.
   *
   * It was three, and three is the whole of what a phone can see — so for a
   * week the homepage opened on the same three posters every day while this
   * week's openings sat in cards four to nine, correct and invisible. The
   * count is asserted against the constant rather than a literal, and the
   * chips must be contiguous from card one: a badge on cards one and four
   * reads as a bug.
   */
  is(
    hot.marked === LEAD_CARDS,
    `${width}px: ${LEAD_CARDS} cinema card is marked trending`,
    `${hot.marked} marked`,
  );
  is(
    hot.firstUnmarked === LEAD_CARDS,
    `${width}px: and the chips run from the front without a gap`,
    `first card without a chip is ${hot.firstUnmarked}, expected ${LEAD_CARDS}`,
  );
  is(
    hot.names[0] === 'Mirzapur: The Movie',
    `${width}px: the biggest film in cinemas leads the row`,
    `the row opens with "${hot.names[0]}"`,
  );
  /*
   * And the rest of what a phone can see is news rather than more ranking.
   * This is the reported bug in its observable form — three times reported,
   * never tested, because every test looked at the array and none at the
   * screen.
   */
  {
    /* "Today", "Yesterday", "3 days ago" — recent. "3 weeks ago" is the
       ranking still talking. */
    const after = hot.dates.slice(LEAD_CARDS, 3);
    is(
      after.some((d) => /today|yesterday|^\d+ days? ago/i.test(d ?? '')),
      `${width}px: a phone sees something that opened recently, not only the ranking`,
      `cards after the badge say: ${after.join(' / ')}`,
    );
  }

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

  /*
   * The artwork fills its frame, and the sheet does not scroll sideways.
   *
   * Reported as "the poster is buggy, getting cropped in all", and there were
   * two faults under it, neither visible to any check here.
   *
   * The <img> carried `.art`'s `padding: 12% 10%`, which exists to keep the
   * generated fallback's title off the tile edges. On a replaced element that
   * shrinks the picture: a 443×190 hero painted its backdrop into 354×84, and
   * object-fit then cropped a 16:9 image into a 4.2:1 sliver. Measured rather
   * than eyeballed, because "looks a bit tight" is not a bug report a fix can
   * be checked against.
   *
   * And `aspect-ratio` with `min-height` and no stated width ran backwards —
   * 190px of floor became 443px of width inside a 390px sheet. The existing
   * viewport check could never see it: the overflow is inside a scroll
   * container, so the document is perfectly well behaved.
   */
  const frame = await page.evaluate(() => {
    const hero = document.querySelector('.sheet__hero');
    const img = document.querySelector('.sheet__hero .art--photo');
    const scroll = document.querySelector('.sheet__scroll');
    return {
      overflow: scroll ? scroll.scrollWidth - scroll.clientWidth : 0,
      // Null when the fallback is showing rather than a photo — a network the
      // suite does not control, so its absence is not a failure.
      fill:
        hero && img
          ? Math.round(img.getBoundingClientRect().width) -
            Math.round(hero.getBoundingClientRect().width)
          : null,
      padded: img ? getComputedStyle(img).padding !== '0px' : false,
    };
  });
  is(
    frame.overflow <= 0,
    `${width}px: the sheet does not scroll sideways`,
    `${frame.overflow}px wider than its own frame`,
  );
  is(!frame.padded, `${width}px: artwork is not inset by the fallback's padding`, 'the image is padded');
  if (frame.fill !== null) {
    is(frame.fill === 0, `${width}px: the artwork fills its frame`, `${frame.fill}px narrower than the hero`);
  }

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
      menu: top('.weekbar .hmenu'),
      // The bands this change removed. Their absence is the change.
      oldWeekBand: !!document.querySelector('.weekbar__week'),
      oldMetaBand: !!document.querySelector('.weekbar__right'),
      headingText: document.querySelector('.controls__heading')?.textContent?.trim() ?? '',
      searchInHeader: !!document.querySelector('.weekbar .gsearch input'),
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
   * Share is above everything, behind the header menu.
   *
   * It spent one commit at the foot of the board on the reasoning that nobody
   * shares a week they have not read — true of a reader, and beside the point:
   * the picture it makes is how the site travels, and a growth loop that needs
   * scrolling to find does not run. It is one of the menu's sections now
   * rather than a button of its own, so what this holds is the menu's
   * placement; that Share is inside it is checked where Share is exercised.
   */
  is(
    m.menu !== null && m.menu < m.rail,
    `${label}: the header menu is above the fold`,
    `menu ${m.menu}, rail ${m.rail}`,
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

// --- the search box answers about more than this site ------------------------

/**
 * The dropdown, and the seam in it.
 *
 * Two things can go wrong here that no unit test sees. The placeholder can
 * promise "1M+ titles" on a deploy where the Worker has no TMDB credential —
 * which is the state this shipped in, so it is not hypothetical. And the three
 * sections can collapse into one ranked list, which reads fine in a screenshot
 * and destroys the only thing the site knows that TMDB does not: that a row is
 * on Netflix on Friday.
 */
console.log('\nThe search dropdown');
/* 360 first, and not as an afterthought: it is the narrowest screen this site
   supports and the width the placeholder has to survive. A field that reads
   "Search 1M+ ti…" makes the claim and fails to make it in the same breath. */
for (const [width, touch] of [[320, true], [360, true], [390, true], [430, true], [1440, false]]) {
  const { ctx, page, errors } = await newPage(browser, { width, height: 900, touch });

  /* No credential bound. The honest degraded state, and the one live today. */
  let asked = 0;
  await page.route('**/api/search*', (route) => {
    asked++;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ remote: false, results: [], total: 0 }),
    });
  });

  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.controls__row');
  await page.waitForTimeout(400);

  is(
    await page.locator('.weekbar .gsearch input').isVisible(),
    `${width}px: the search field is drawn, not hidden behind an icon`,
    'it collapsed',
  );
  is(
    asked === 0,
    `${width}px: loading the page costs no search request`,
    `${asked} made before anybody typed`,
  );
  /*
   * One placeholder at every width, and it has to fit the field it is in.
   *
   * Measured rather than asserted, and measured off ::placeholder rather than
   * the input: those are two different font sizes on a phone on purpose — the
   * input is pinned at 16px so iOS does not magnify the page, and the hint
   * renders at 13px so it fits beside the wordmark. An earlier version of this
   * check read the input's size on a desktop context and passed while the real
   * phone was drawing 142px of copy into 132px of field.
   */
  const copy = await page.evaluate(() => {
    const el = document.querySelector('.gsearch input');
    const cs = getComputedStyle(el);
    const ps = getComputedStyle(el, '::placeholder');
    const probe = document.createElement('span');
    probe.textContent = el.placeholder;
    probe.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap';
    probe.style.fontFamily = cs.fontFamily;
    probe.style.fontWeight = ps.fontWeight || cs.fontWeight;
    probe.style.fontSize = ps.fontSize || cs.fontSize;
    probe.style.letterSpacing = ps.letterSpacing || cs.letterSpacing;
    document.body.append(probe);
    const w = probe.getBoundingClientRect().width;
    probe.remove();
    /* The real padding, not a guess: it differs by width and shrinks again
       while the placeholder is the only thing in the box. */
    const room =
      el.getBoundingClientRect().width -
      parseFloat(cs.paddingLeft) -
      parseFloat(cs.paddingRight);
    return { text: el.placeholder, room, w };
  });
  is(
    copy.text === 'Search 1M+ titles',
    `${width}px: the placeholder is the one line, not a variant`,
    `it says "${copy.text}"`,
  );
  is(
    copy.w <= copy.room,
    `${width}px: and it fits the field without truncating`,
    `${Math.round(copy.w)}px of copy in ${Math.round(copy.room)}px of field`,
  );

  /*
   * The name, back beside the field.
   *
   * It was dropped on every phone to make room for the search box, which was
   * the wrong half of the trade: a first-time visitor arriving from Instagram
   * had nothing in the header telling them where they had landed. Sizing the
   * whole row rather than deleting from it buys it back above 380px, and the
   * play mark still carries the link home below that.
   */
  const brand = await page.evaluate(() => {
    const word = document.querySelector('.logo__word');
    const mark = document.querySelector('.logo__mark');
    const shown = (el) => el && getComputedStyle(el).display !== 'none';
    return {
      word: shown(word) ? word.textContent.trim() : null,
      mark: shown(mark),
      home: document.querySelector('.logo')?.getAttribute('href'),
      reach: Math.round(document.querySelector('.logo').getBoundingClientRect().width),
    };
  });
  if (width >= 380) {
    is(
      brand.word === 'New on OTT.',
      `${width}px: the site's name is in the header beside the field`,
      brand.word === null ? 'the wordmark is hidden' : `it says "${brand.word}"`,
    );
  } else {
    is(brand.mark, `${width}px: the mark still carries the way home`, 'nothing of the brand is left');
  }
  is(brand.home === '/', `${width}px: and the brand is a link to the homepage`, `href is ${brand.home}`);

  /* Typing must not move the board. A panel that pushes content is the bug
     this codebase has already shipped once, with the out-today rail. */
  const before = await page.evaluate(() => document.querySelector('.landed')?.getBoundingClientRect().top);
  await page.click('.gsearch input');
  await page.type('.gsearch input', 'a', { delay: 30 });
  await page.waitForTimeout(300);
  is(
    !(await page.locator('.gsearch__panel').isVisible()),
    `${width}px: one letter opens nothing`,
    'it searched on a single character',
  );

  const feed = JSON.parse(await readFile(join(DIST, 'data/releases.json'), 'utf8'));
  const row = feed.weeks
    .flatMap((w) => w.releases)
    .find((r) => (r.regions ?? []).includes('IN') && r.slug && r.title.length > 5);

  await page.fill('.gsearch input', row ? row.title.slice(0, 6) : 'the');
  await page.waitForTimeout(700);

  is(
    await page.locator('.gsearch__panel').isVisible(),
    `${width}px: the results panel opens`,
    'nothing appeared',
  );
  const after = await page.evaluate(() => document.querySelector('.landed')?.getBoundingClientRect().top);
  is(before === after, `${width}px: and floats over the board rather than pushing it`, `${before} then ${after}`);

  const labels = await page.evaluate(() =>
    [...document.querySelectorAll('.gsearch__label')].map((el) => el.firstChild?.textContent?.trim()),
  );
  is(
    labels[0] === 'On New on OTT',
    `${width}px: what the site can answer about comes first`,
    `sections: ${labels.join(', ') || 'none'}`,
  );
  is(
    !labels.includes('Everywhere else'),
    `${width}px: and nothing is offered from a source that answered nothing`,
    'an empty remote section rendered',
  );

  /* The panel must not overflow its viewport — it is the widest thing in the
     header and the first to run off a 390px screen. */
  const fits = await page.evaluate(() => {
    const r = document.querySelector('.gsearch__panel').getBoundingClientRect();
    return r.left >= -1 && r.right <= window.innerWidth + 1;
  });
  is(fits, `${width}px: the panel stays inside the viewport`, 'it overflowed');

  // A result leads somewhere. Enter on the first row is the keyboard path, and
  // the one most likely to rot, since the mouse path is what gets clicked in
  // review.
  if (row) {
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(120);
    await Promise.all([
      page.waitForURL(/\/ott-release-date\//, { timeout: 8000 }).catch(() => {}),
      page.keyboard.press('Enter'),
    ]);
    await page.waitForTimeout(400);
    is(
      /\/ott-release-date\//.test(page.url()),
      `${width}px: Enter on the first result opens its page`,
      `it went to ${page.url()}`,
    );
  }

  /* Exactly the keystrokes, and nothing on mount. The probe that used to run
     on every page load existed only to choose between two placeholders; there
     is one now, so the request is gone and must stay gone. */
  is(asked > 0, `${width}px: the proxy was actually asked`, 'no request was made');
  is(errors.length === 0, `${width}px: no console errors`, errors[0]);
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
  await page.waitForSelector('.weekbar .hmenu__toggle');

  await page.locator('.hmenu__toggle').click();
  await page.waitForTimeout(300);
  /* The two image buttons, which are the only .hmenu__item that are buttons
     rather than links — the four above them are navigation. */
  const share = page.locator('.hmenu__panel button.hmenu__item');
  const items = await share.count();
  is(items === 2, `${width}px: it offers both a board and a poster image`, `${items} options`);

  for (const [i, kind] of [[0, 'board'], [1, 'posters']]) {
    if (!(await page.locator('.hmenu__panel').isVisible())) {
      await page.locator('.hmenu__toggle').click();
      await page.waitForTimeout(250);
    }
    const [dl] = await Promise.all([
      page.waitForEvent('download', { timeout: 40_000 }),
      share.nth(i).click(),
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
  // bug people report as "the site froze". It also restores the body scroll it
  // locks on a phone, which is the same bug wearing a worse hat.
  if (!(await page.locator('.hmenu__panel').isVisible())) {
    await page.locator('.hmenu__toggle').click();
    await page.waitForTimeout(250);
  }
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  is(
    !(await page.locator('.hmenu__panel').isVisible()),
    `${width}px: Escape closes the header menu`,
    'it stayed open',
  );
  is(
    await page.evaluate(() => getComputedStyle(document.body).overflow !== 'hidden'),
    `${width}px: and gives the page its scroll back`,
    'the body is still locked',
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
   * A poster on the board is never cropped. The opened sheet is.
   *
   * Stated by the owner as a rule, after a fix for a padded <img> was read as
   * cropping: "don't crop the main screen poster, I asked you to crop the
   * poster when the user clicks on it and it opens as separate". The two
   * surfaces want opposite things — the board is a wall of complete artwork you
   * scan, the sheet is one title with a cinematic backdrop — and the difference
   * is entirely in the frame each uses.
   *
   * So this checks the frame, not the picture. TMDB posters are 2:3, and a
   * container at any other ratio must crop or letterbox whatever is put in it,
   * whichever object-fit is chosen. Checking the ratio catches the mistake
   * before an image is even involved, and works with no network.
   */
  const frames = await page.evaluate(() =>
    [...document.querySelectorAll('.card__poster, .landed__art')].slice(0, 8).map((el) => {
      const r = el.getBoundingClientRect();
      return { cls: el.className, ratio: r.width / r.height };
    }),
  );
  const offRatio = frames.filter((f) => Math.abs(f.ratio - 2 / 3) > 0.02);
  is(
    frames.length > 0 && offRatio.length === 0,
    `${width}px: poster frames are 2:3, so nothing on the board is cropped`,
    frames.length === 0
      ? 'no poster frames found'
      : offRatio.map((f) => `${f.cls} at ${f.ratio.toFixed(3)}`).join('; '),
  );

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
   * literally, "ott" — quieter than a crash and worse to look at.
   *
   * The first version of this guessed from casing: an all-lower-case word was
   * taken to be the fallback showing through, "because every real name in the
   * registry is capitalised". That was asserted without reading the registry
   * and it is false — aha and hoichoi both style themselves lower-case, and
   * both are real. It passed for three days only because neither had a title
   * in the open week; the Monday refresh added one and the suite went red over
   * a correctly-rendered chip.
   *
   * So it asks the registry instead of inferring from shape. That is also the
   * stronger test: an unknown id fails it whatever its casing, where the old
   * rule would have waved through a capitalised one.
   */
  const knownNames = new Set(
    [...(await readFile(join(ROOT, 'src/data/platforms.ts'), 'utf8')).matchAll(
      /\bshort:\s*'([^']+)'/g,
    )].map((m) => m[1].toLowerCase()),
  );
  const unknown = (await page.locator('.chip--logo').allInnerTexts())
    .map((t) =>
      t
        .replace(/\s+/g, ' ')
        .replace(/\s*\d+\s*$/, '') // the count the chip carries
        .replace(/^[^\p{L}]+/u, '') // the monogram shown before a logo loads
        .trim()
        .toLowerCase(),
    )
    .filter((name) => name && !knownNames.has(name));
  is(
    unknown.length === 0,
    `${width}px: every chip names a platform rather than an id`,
    `not in the registry: ${unknown.join(', ')}`,
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
  /*
   * Languages, asked about the two things that can actually go wrong.
   *
   * This used to assert that every code in the feed appeared in the LANGUAGES
   * table, which made it a treadmill: TMDB sent `ca` on one Catalan film and
   * the whole suite went red — and with it the deploy — over a chip that would
   * have read "CA". Cosmetic, and the third time a cosmetic gap has stopped a
   * publish.
   *
   * The table cannot be complete and does not need to be. What must hold is
   * that a reader never sees a bare code, and that a language's name is only
   * ever a link when the build actually produces that page. The second is the
   * one with teeth: naming `ca` better without checking would have shipped an
   * anchor to /catalan, which is exactly as dead as /ca.
   */
  const feedRaw = await readFile(join(ROOT, 'dist/data/releases.json'), 'utf8').catch(() => null);
  if (feedRaw) {
    const codes = new Set();
    for (const w of JSON.parse(feedRaw).weeks)
      for (const r of w.releases) for (const l of r.languages ?? []) codes.add(l);

    /* Compiled rather than regexed out of the source, so this measures what
       the app renders and not what the file looks like. */
    const dir = mkdtempSync(join(tmpdir(), 'lang-'));
    execFileSync(
      'npx',
      ['--yes', 'esbuild', 'src/data/platforms.ts', '--bundle', '--format=esm',
       `--outfile=${join(dir, 'platforms.mjs')}`],
      { stdio: 'pipe' },
    );
    execFileSync(
      'npx',
      ['--yes', 'esbuild', 'src/lib/route.ts', '--bundle', '--format=esm',
       `--outfile=${join(dir, 'route.mjs')}`],
      { stdio: 'pipe' },
    );
    const { languageName, hasLanguageRoute } = await import(join(dir, 'platforms.mjs'));
    const { routeFilters } = await import(join(dir, 'route.mjs'));

    const bare = [...codes].filter((c) => languageName(c) === c.toUpperCase() && c.length <= 3);
    is(
      bare.length === 0,
      'no language reaches a reader as a bare code',
      `would print: ${bare.join(', ')}`,
    );

    /*
     * The anchor a title page draws, resolved by the thing that has to resolve
     * it. Two modules derive this URL from the same table by different routes
     * — one lowercases the display name, the other keys a map on it — and they
     * agree until a name has a space or a hyphen in it. A prerendered page is
     * deliberately not the test: /japanese answers from the client router with
     * four titles and no static page, and that is fine.
     */
    const dangling = [...codes]
      .filter(hasLanguageRoute)
      .filter((c) => routeFilters(`/${languageName(c).toLowerCase()}`)?.languages?.[0] !== c);
    is(
      dangling.length === 0,
      'every language the app links to is an address it can resolve',
      `unresolvable: ${dangling.map((c) => `/${languageName(c).toLowerCase()}`).join(', ')}`,
    );

    /* And the ones it must not link, because nothing answers them. */
    const unlinked = [...codes].filter((c) => !hasLanguageRoute(c));
    if (unlinked.length) {
      console.log(`         (${unlinked.join(', ')} named but not linked — no route for them)`);
    }
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
    for (const sel of ['.iglink', '.hmenu__toggle']) {
      const el = document.querySelector(sel);
      if (!el) { out[sel] = 'absent'; continue; }
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left - 4, r.top + r.height / 2);
      out[sel] = hit && (hit === el || el.contains(hit)) ? 'hit' : 'miss';
    }
    return out;
  });
  is(reach['.iglink'] === 'hit', 'a thumb landing beside a header icon still hits it',
     `.iglink: ${reach['.iglink']}`);
  is(reach['.hmenu__toggle'] === 'hit', 'and beside the menu button',
     `.hmenu__toggle: ${reach['.hmenu__toggle']}`);

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


/*
 * ---------------------------------------------------------------------------
 * A title the calendar has never heard of
 *
 * Search reaches past this site's 963 rows into TMDB's million, and those rows
 * used to be inert because there was nowhere to send anybody. There is now: a
 * sheet, not a page, so nothing is published and nothing is crawled — and what
 * makes it worth opening is that TMDB knows which Indian service carries the
 * film, which is the question this whole site exists to answer.
 *
 * The part that breaks silently is the wiring: a result carrying an id, the
 * sheet asking about that id, and the provider coming back as a platform this
 * site can name. Neither the worker tests nor the unit tests can see across
 * that seam.
 */
console.log('\nA title only search can reach');
{
  /* The shared helper, so this counts the same things every other section
     counts: fonts aborted, poster CDN stubbed, and the console noise that
     comes from that setup filtered out rather than reported as the site's. */
  const { ctx, page, errors } = await newPage(browser, { width: 390, height: 844, touch: true });
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.landed__cell', { timeout: 15_000 }).catch(() => {});

  await page.locator('input[type="search"], .search input').first().fill('a film only');
  await page.waitForTimeout(700);

  const row = page.locator('button.gsearch__row').filter({ hasText: 'A Film Only TMDB Has' }).first();
  is(await row.count() > 0, 'a result the calendar lacks is something you can open', 'the row is not a button');

  if (await row.count() > 0) {
    await row.click();
    const opened = await page.waitForSelector('.sheet', { timeout: 8000 }).then(() => true).catch(() => false);
    is(opened, 'opening one gets a sheet rather than a dead end', 'no sheet appeared');

    if (opened) {
      await page.waitForTimeout(500);
      const sheet = await page.evaluate(() => {
        const s = document.querySelector('.sheet');
        return {
          title: s.querySelector('.sheet__title')?.textContent?.trim() ?? '',
          headings: [...s.querySelectorAll('.sheet__section h3')].map((e) => e.textContent.trim()),
          buttons: [...s.querySelectorAll('.btn')].map((e) => e.textContent.trim()),
          text: s.textContent ?? '',
        };
      });

      is(sheet.title === 'A Film Only TMDB Has', 'the sheet is about the film that was tapped', `titled "${sheet.title}"`);
      is(
        sheet.headings.includes('Streaming in India'),
        'it answers where to watch, which is the reason to open it',
        `sections: ${sheet.headings.join(' / ')}`,
      );
      /* The seam: TMDB provider 8 has to arrive as this site's Netflix. */
      is(
        sheet.buttons.some((b) => /Netflix/.test(b)),
        'a TMDB provider id becomes a service this site can name',
        `buttons: ${sheet.buttons.join(' / ') || '(none)'}`,
      );
      /*
       * The sheet says neither of the two sentences it used to.
       *
       * "Not in the India release calendar" was written when these rows were
       * inert and became false the moment the sheet started naming the service
       * streaming the thing. "Details from TMDB" went with it, because the
       * footer already carries the attribution TMDB's terms actually ask for,
       * in the wording they ask for it — repeating a credit on every overlay
       * is not what the terms require and it read as a disclaimer on the
       * answer above it.
       *
       * So the requirement is still asserted; it is just asserted where the
       * credit really lives. A sheet that has stopped crediting TMDB while the
       * page behind it has too is the failure worth catching.
       */
      is(
        !/not in the India release calendar/i.test(sheet.text),
        'the sheet does not define the title by what it is not',
        'the apology is still there',
      );
      const credited = await page.evaluate(() =>
        /themoviedb\.org/.test(document.querySelector('.footer__credit')?.innerHTML ?? '') &&
        /not endorsed or certified by TMDB/i.test(document.body.textContent ?? ''),
      );
      is(credited, 'and the site still credits TMDB where its terms ask', 'the attribution is gone');

      /* A sheet is not a page. If this ever starts changing the URL it has
         become one, and the reasoning that allowed it stops applying. */
      is(
        new URL(page.url()).pathname === '/',
        'opening a catalogue title publishes nothing and changes no URL',
        `the URL became ${page.url()}`,
      );

      /*
       * "More like this" reopens in place rather than stacking sheets. A stack
       * needs a back affordance and a history entry, and this is deliberately
       * not a page — so the close button has to keep meaning "done", however
       * far the reader wandered.
       */
      const next = page.locator('.sheet__more button').first();
      is(await next.count() > 0, 'there is somewhere to go next', 'no recommendations row');
      if (await next.count() > 0) {
        await next.click();
        await page.waitForTimeout(600);
        is(
          (await page.locator('.sheet').count()) === 1,
          'a recommendation replaces the sheet rather than stacking another on it',
          `${await page.locator('.sheet').count()} sheets are open`,
        );
        is(
          new URL(page.url()).pathname === '/',
          'and wandering still publishes nothing',
          `the URL became ${page.url()}`,
        );
      }

      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
      is((await page.locator('.sheet').count()) === 0, 'Escape closes it wherever you got to', 'the sheet stayed open');
    }
  }

  is(errors.length === 0, 'no console errors opening a catalogue title', errors.slice(0, 2).join(' | '));
  await ctx.close();
}

/*
 * ---------------------------------------------------------------------------
 * "More like this", on a title the site does have
 *
 * The row started inside the sheet that TMDB-only search results opened, which
 * was the narrowest possible place for it: the one kind of title with no page.
 * Asked for everywhere instead — somebody opening a film from the board wants
 * the next thing as much as somebody who found it through search.
 *
 * The seam this guards is that the detail sheet asks for it at all. It has no
 * TMDB call of its own, so the row depends on a hook firing on the row's id,
 * and a row whose id is not a TMDB one must ask for nothing rather than
 * request a title that cannot exist.
 */
console.log('\nMore like this, on the board');
{
  const { ctx, page, errors } = await newPage(browser, { width: 390, height: 844, touch: true });
  const asked = [];
  page.on('request', (r) => r.url().includes('/api/title') && asked.push(r.url()));
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.landed__cell', { timeout: 15_000 }).catch(() => {});

  /* Deliberately a row with a TMDB id. Twenty-two of the feed's rows are
     hand-seeded and carry ids like `th-mirzapur-the-movie`; those correctly
     show no row, and clicking whichever card happens to be first would make
     this test pass or fail on that coincidence. */
  const feed = JSON.parse(await readFile(join(DIST, 'data/releases.json'), 'utf8'));
  const named = new Set(
    feed.weeks
      .flatMap((w) => w.releases)
      .filter((r) => /^[mt]-\d+$/.test(String(r.id).replace(/~[a-z]+$/, '')))
      .map((r) => r.title),
  );

  let opened = null;
  for (const cell of await page.locator('.landed__cell button').all()) {
    const name = (await cell.locator('.landed__name').textContent().catch(() => ''))?.trim();
    if (name && named.has(name)) {
      opened = name;
      await cell.click();
      break;
    }
  }
  is(Boolean(opened), 'a calendar title opens its sheet', 'no card with a TMDB id was found');

  if (opened) {
    await page.waitForSelector('.sheet', { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(900);
    is(asked.length > 0, 'the sheet asks what is like it', 'nothing was requested');
    is(
      (await page.locator('.sheet__more button').count()) > 0,
      'and shows the row, not only on titles we lack a page for',
      'no recommendations rendered',
    );
  }

  is(errors.length === 0, 'no console errors', errors.slice(0, 2).join(' | '));
  await ctx.close();
}

/*
 * ---------------------------------------------------------------------------
 * The tab that was open when a deploy landed
 *
 * Asset filenames are hashed, so the old ones stop existing the moment a new
 * build publishes. Any tab still holding the previous page then asks for a
 * file that is gone, and because not_found_handling is single-page-application
 * the server answers 200 with index.html — so the browser refuses to run HTML
 * as a module, the prerendered fallback stays on screen, and the page looks
 * broken. Reported from a phone minutes after a publish, with the site's own
 * banner confidently blaming the reader's network.
 *
 * A deleted asset and a blocked one are distinguishable: the first answers
 * with HTML, the second does not answer. So the recovery has to fire on the
 * first and not on the second, and it has to fire exactly once, because a
 * reload loop is a worse failure than the banner it replaces.
 */
console.log('\nA tab left open across a deploy');
{
  const { ctx, page, errors } = await newPage(browser, { width: 390, height: 844 });
  const indexHtml = await readFile(join(DIST, 'index.html'), 'utf8');

  /*
   * The first page load names a bundle that does not exist, which is what a
   * tab held across a deploy is: the markup is the old build's, the filename
   * in it was deleted by the new one. The reload then gets the current markup,
   * naming the bundle that does.
   *
   * Modelled by rewriting the document rather than by intercepting the asset,
   * which is how the first version of this got it wrong: intercepting made the
   * recovery's own probe re-request the same URL and receive real JavaScript,
   * so it concluded the file was fine. A deleted file stays deleted, and the
   * probe has to see that.
   */
  let firstLoad = true;
  let askedForGone = 0;
  await page.route(`${BASE}/`, async (route) => {
    if (!firstLoad) return route.continue();
    firstLoad = false;
    const bundle = /\/assets\/[^"]+\.js/.exec(indexHtml)?.[0] ?? '';
    return route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: indexHtml.replace(bundle, '/assets/index-DELETED.js'),
    });
  });
  page.on('request', (r) => r.url().includes('index-DELETED.js') && (askedForGone += 1));

  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);

  is(askedForGone > 0, 'a stale page asks for a bundle that is gone', 'the deleted bundle was never requested');
  is(
    (await page.locator('.landed__cell').count()) > 0,
    'and recovers itself rather than sitting there broken',
    'the app never booted',
  );
  is(
    (await page.getByText('This page did not finish loading').count()) === 0,
    'without blaming the reader for a deploy',
    'the network-filter banner was shown for a deleted asset',
  );
  await ctx.close();
}

{
  /* And the case the banner was written for, which must still reach it: an
     asset that does not answer at all is a filter, not a deploy. */
  const { ctx, page } = await newPage(browser, { width: 390, height: 844 });
  let reloads = 0;
  page.on('framenavigated', (f) => f === page.mainFrame() && (reloads += 1));
  await page.route('**/assets/**', (r) => r.abort());
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);
  is(reloads === 1, 'a blocked asset is not reloaded at', `the page navigated ${reloads} times`);
  is(
    (await page.getByText('This page did not finish loading').count()) > 0,
    'it still says so plainly',
    'a genuinely blocked page said nothing',
  );
  await ctx.close();
}

await browser.close();
server.close();

console.log(`\n${checks - failures} passed, ${failures} failed`);
if (KEEP) console.log(`screenshots in ${SHOTS}`);
process.exit(failures ? 1 : 0);
