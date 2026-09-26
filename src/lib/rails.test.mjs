/**
 * The selection behind the poster rail, tested where it is cheap to test.
 *
 * The rendering is checked in a real browser (scripts/e2e.mjs). What lives here
 * is the part a screenshot cannot tell you: that the window is the window, that
 * the ordering claim the label makes is the ordering the row has, and that the
 * per-language guard holds on the rows built to spread a field — and only
 * there, since the cinema row is a deliberate exception to it.
 *
 * Run: npm run test:rail
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

/**
 * The source is TypeScript and this is plain node, so it is compiled once into
 * a temp directory rather than being duplicated here. A copy of the logic in a
 * test only ever proves the copy works.
 */
const dir = mkdtempSync(join(tmpdir(), 'rail-'));
execFileSync(
  'npx',
  ['--yes', 'esbuild', 'src/lib/rails.ts', '--bundle', '--format=esm', `--outfile=${join(dir, 'rails.mjs')}`],
  { stdio: 'pipe' },
);
const {
  justLanded,
  landingSoon,
  popularNow,
  inCinemas,
  landedOnOtt,
  CINEMA_DAYS,
  WINDOW_DAYS,
  SOON_DAYS,
  MAX_ITEMS,
  TRENDING_IN_CINEMAS,
  NEW_IN_CINEMAS,
  NARROWED_DAYS,
} = await import(join(dir, 'rails.mjs'));

const TODAY = new Date('2026-09-07T12:00:00');
const iso = (daysAgo) =>
  new Date(TODAY.getTime() - daysAgo * 86_400_000).toISOString().slice(0, 10);

let n = 0;
const row = (over = {}) => ({
  id: `t${++n}`,
  title: `Title ${n}`,
  kind: 'film',
  platforms: ['netflix'],
  languages: ['hi'],
  genres: [],
  regions: ['IN'],
  releaseDate: iso(1),
  posterUrl: 'https://image.tmdb.org/x.jpg',
  heat: 1,
  ...over,
});

test('takes only what has already come out', () => {
  const { releases } = justLanded(
    [row({ releaseDate: iso(-3) }), row({ releaseDate: iso(0) }), row({ releaseDate: iso(2) })],
    'IN',
    TODAY,
  );
  const dates = releases.map((r) => r.releaseDate);
  assert.ok(!dates.includes(iso(-3)), 'a title three days out is not "just landed"');
  assert.equal(dates.length, 2);
});

test('the window is exactly the window it advertises', () => {
  const { releases } = justLanded(
    [row({ releaseDate: iso(WINDOW_DAYS - 1) }), row({ releaseDate: iso(WINDOW_DAYS) })],
    'IN',
    TODAY,
  );
  assert.equal(releases.length, 1, 'the last day inside the window is in, the next one is out');
});

test('drops rows with no poster, and rows from another region', () => {
  const { releases } = justLanded(
    [row({ posterUrl: undefined }), row({ regions: ['US'] }), row()],
    'IN',
    TODAY,
  );
  assert.equal(releases.length, 1);
});

test('newest day first — the label is a claim about time', () => {
  const { releases } = justLanded(
    [
      row({ releaseDate: iso(9), heat: 999, title: 'Old blockbuster' }),
      row({ releaseDate: iso(1), heat: 1, title: 'Yesterday, quietly' }),
    ],
    'IN',
    TODAY,
  );
  assert.equal(releases[0].title, 'Yesterday, quietly', 'heat must not outrank recency');
});

test('within one day, languages interleave instead of one taking the row', () => {
  const sameDay = { releaseDate: iso(1) };
  const { releases } = justLanded(
    [
      row({ ...sameDay, languages: ['hi'], heat: 100, title: 'Hindi 1' }),
      row({ ...sameDay, languages: ['hi'], heat: 90, title: 'Hindi 2' }),
      row({ ...sameDay, languages: ['hi'], heat: 80, title: 'Hindi 3' }),
      row({ ...sameDay, languages: ['ml'], heat: 5, title: 'Malayalam 1' }),
    ],
    'IN',
    TODAY,
  );
  assert.equal(
    releases[1].title,
    'Malayalam 1',
    'a Malayalam film should not sit behind every Hindi one on the same day — TMDB heat is not comparable across languages',
  );
});

test('a busy day cannot bury a quieter, more recent one', () => {
  const rows = [];
  for (let i = 0; i < 8; i++) rows.push(row({ releaseDate: iso(3), heat: 500 }));
  rows.push(row({ releaseDate: iso(0), heat: 1, title: 'Today' }));
  const { releases } = justLanded(rows, 'IN', TODAY);
  assert.equal(releases[0].title, 'Today');
});

test('caps the row', () => {
  const rows = [];
  for (let i = 0; i < MAX_ITEMS + 15; i++) rows.push(row());
  assert.equal(justLanded(rows, 'IN', TODAY).releases.length, MAX_ITEMS);
});

test('an empty feed is an empty row, not a crash', () => {
  assert.deepEqual(justLanded([], 'IN', TODAY).releases, []);
});

test('cinemas travel with streaming — that pairing is the point', () => {
  const { releases } = justLanded(
    [row({ platforms: ['theatres'], releaseDate: iso(1) }), row({ releaseDate: iso(1) })],
    'IN',
    TODAY,
  );
  assert.ok(
    releases.some((r) => r.platforms.includes('theatres')),
    'a theatrical release inside the window belongs in the row',
  );
});

test('reads across weeks, which is the whole reason it exists', () => {
  // Two feed weeks' worth of dates, all inside the fortnight.
  const rows = [iso(1), iso(5), iso(8), iso(12)].map((d) => row({ releaseDate: d }));
  const { releases } = justLanded(rows, 'IN', TODAY);
  assert.equal(releases.length, 4);
});

/** Verified against the real feed, so a change in its shape shows up here. */
test('the shipped feed produces a usable row', () => {
  const feed = JSON.parse(readFileSync('dist/data/releases.json', 'utf8'));
  const all = feed.weeks.flatMap((w) => w.releases);
  const { releases, from, to } = justLanded(all, 'IN', new Date());
  assert.ok(releases.length > 0, `no recent India titles in the feed between ${from} and ${to}`);
  for (const r of releases) {
    assert.ok(r.posterUrl, `${r.title} has no poster`);
    assert.ok(r.releaseDate >= from && r.releaseDate <= to, `${r.title} is outside the window`);
  }
  writeFileSync(
    join(dir, 'sample.json'),
    JSON.stringify(releases.map((r) => `${r.releaseDate} ${r.languages?.[0]} ${r.title}`), null, 2),
  );
  console.log(`      ${releases.length} in the row, ${from} to ${to}`);
});

// --- landing soon ------------------------------------------------------------

test('landing soon takes only what has not come out yet', () => {
  const { releases } = landingSoon(
    [row({ releaseDate: iso(1) }), row({ releaseDate: iso(0) }), row({ releaseDate: iso(-2) })],
    'IN',
    TODAY,
  );
  assert.equal(releases.length, 1, 'today and yesterday have already landed');
  assert.equal(releases[0].releaseDate, iso(-2));
});

test('landing soon is nearest-first — the opposite order to just landed', () => {
  const { releases } = landingSoon(
    [
      row({ releaseDate: iso(-18), heat: 999, title: 'Big, three weeks out' }),
      row({ releaseDate: iso(-2), heat: 1, title: 'This Friday' }),
    ],
    'IN',
    TODAY,
  );
  assert.equal(releases[0].title, 'This Friday', 'the nearest release leads a row about what is coming');
});

test('landing soon stops at its own horizon', () => {
  const { releases } = landingSoon(
    [row({ releaseDate: iso(-SOON_DAYS) }), row({ releaseDate: iso(-SOON_DAYS - 1) })],
    'IN',
    TODAY,
  );
  assert.equal(releases.length, 1);
});

test('the two rows never contain the same title', () => {
  const rows = [];
  for (let d = -SOON_DAYS; d <= WINDOW_DAYS; d++) rows.push(row({ releaseDate: iso(d) }));
  const landedIds = new Set(justLanded(rows, 'IN', TODAY).releases.map((r) => r.id));
  const soonIds = landingSoon(rows, 'IN', TODAY).releases.map((r) => r.id);
  const overlap = soonIds.filter((id) => landedIds.has(id));
  assert.deepEqual(overlap, [], 'a title cannot have both just landed and be landing soon');
});

// --- popular now -------------------------------------------------------------

test('popular now needs a rank, and ignores rows without one', () => {
  const out = popularNow([row({ popRank: 1 }), row({}), row({ popRank: 4 })], 'IN');
  assert.equal(out.length, 2);
});

test('popular now interleaves languages rather than sorting rank globally', () => {
  const out = popularNow(
    [
      row({ popRank: 1, languages: ['en'], title: 'English 1' }),
      row({ popRank: 2, languages: ['en'], title: 'English 2' }),
      row({ popRank: 3, languages: ['en'], title: 'English 3' }),
      row({ popRank: 1, languages: ['ml'], title: 'Malayalam 1' }),
    ],
    'IN',
  );
  assert.equal(
    out[1].title,
    'Malayalam 1',
    'ranks are positions within a language and do not compare across them',
  );
});

test('popular now carries a poster, because it renders as one', () => {
  const out = popularNow([row({ popRank: 1, posterUrl: undefined }), row({ popRank: 2 })], 'IN');
  assert.equal(out.length, 1);
});

/** The catalogue file, checked the same way as the feed. */
test('the shipped catalogue produces a usable row', () => {
  const cat = JSON.parse(readFileSync('public/data/catalogue.json', 'utf8'));
  const out = popularNow(cat.titles, 'IN');
  assert.ok(out.length >= 6, `only ${out.length} ranked titles with posters`);
  const langs = new Set(out.map((r) => r.languages?.[0]));
  assert.ok(langs.size >= 3, `the row is only ${[...langs].join(', ')} — the interleave is not working`);
  console.log(`      ${out.length} in the row, ${langs.size} languages: ${[...langs].join(', ')}`);
});

/**
 * The split under "On right now".
 *
 * The two sides run on different clocks on purpose — a cinema run outlasts a
 * streaming drop's news value by a month — and that asymmetry is the whole
 * reason the row was split, so it is the thing most worth pinning down.
 */

test('in cinemas reaches back further than the streaming side', () => {
  const old = row({ releaseDate: iso(30), platforms: ['theatres'] });
  assert.equal(inCinemas([old], 'IN', TODAY).releases.length, 1);
  assert.equal(
    landedOnOtt([row({ releaseDate: iso(30) })], 'IN', TODAY).releases.length,
    0,
    'the OTT side keeps the fortnight it always had',
  );
});

test('in cinemas stops at its own horizon', () => {
  const rows = [
    row({ releaseDate: iso(CINEMA_DAYS - 1), platforms: ['theatres'] }),
    row({ releaseDate: iso(CINEMA_DAYS + 5), platforms: ['theatres'] }),
  ];
  assert.equal(inCinemas(rows, 'IN', TODAY).releases.length, 1);
});

test('neither side takes what has not opened yet', () => {
  const future = [
    row({ releaseDate: iso(-2), platforms: ['theatres'] }),
    row({ releaseDate: iso(-2), platforms: ['netflix'] }),
  ];
  assert.equal(inCinemas(future, 'IN', TODAY).releases.length, 0);
  assert.equal(landedOnOtt(future, 'IN', TODAY).releases.length, 0);
});

test('a film that has reached streaming leaves the cinema row', () => {
  /*
   * This asserted the opposite, and shipped the result: Vishwanath & Sons led
   * the "In cinemas" row wearing a Netflix badge, DC beside it on Sun NXT.
   *
   * The old reasoning was that a film can be both and dropping it from either
   * side hides a real answer. Day-and-date releases exist, so that is not
   * wrong in general — it is wrong for this window. An Indian theatrical run
   * ends and *then* the film streams, and the row looks back six weeks, which
   * spans both. Somebody reading it is deciding whether to book a ticket, and a
   * film they can stream tonight is not an answer to that.
   *
   * The row keeps both platforms. Only the claim "on at the cinema right now"
   * is withdrawn, because only one of them can support it.
   */
  const both = [row({ platforms: ['theatres', 'netflix'] })];
  assert.equal(inCinemas(both, 'IN', TODAY).releases.length, 0, 'still offering a ticket for a film on Netflix');
  assert.equal(landedOnOtt(both, 'IN', TODAY).releases.length, 1, 'and it has to be somewhere');
});

test('a cinema-only film never appears on the OTT side', () => {
  const rows = [row({ platforms: ['theatres'] })];
  assert.equal(landedOnOtt(rows, 'IN', TODAY).releases.length, 0);
});

/*
 * A guess is not a landing.
 *
 * Reported from the site: Toxic: A Fairy Tale for Grown-ups sitting in "On
 * OTT", under a ZEE5 badge, dated today. TMDB has no India provider for that
 * film at all — not subscription, not rent, not buy. Its platform came from
 * free text a contributor typed onto a digital release date, and the row
 * carried `namedBy: 'note'` to say so. Nothing read the field, so the guess
 * rendered exactly like a fact.
 *
 * "On OTT", under a heading that reads "On right now", is this site telling
 * somebody they can press play tonight. Only a watch provider can support
 * that.
 */
test('a platform nobody confirmed is not something you can watch tonight', () => {
  const guessed = [row({ platforms: ['zee5'], namedBy: 'note' })];
  assert.equal(
    landedOnOtt(guessed, 'IN', TODAY).releases.length,
    0,
    'a contributor note put a film in the rail that promises you can watch it',
  );

  /* Every weaker source, not just the one that was reported — a studio
     inference and a broadcaster are guesses by the same argument. */
  for (const namedBy of ['note', 'studio', 'network']) {
    assert.equal(
      landedOnOtt([row({ platforms: ['netflix'], namedBy })], 'IN', TODAY).releases.length,
      0,
      `${namedBy} was treated as confirmation`,
    );
  }

  /* And the rail still works. This is the failure worth guarding against: a
     rule that empties the row is not a fix, it is the same bug pointing the
     other way. */
  assert.equal(
    landedOnOtt([row({ platforms: ['netflix'] })], 'IN', TODAY).releases.length,
    1,
    'a provider-confirmed title fell out of the rail too',
  );
});

/*
 * The count has to agree with the row.
 *
 * "On OTT — 41 titles" over a row that excludes unconfirmed ones would be the
 * same overclaim moved into the subtitle, which is where a number nobody
 * recomputes usually survives a fix.
 */
test('the subtitle counts what the row is allowed to show', () => {
  const mixed = [
    row({ platforms: ['netflix'] }),
    row({ platforms: ['zee5'], namedBy: 'note' }),
    row({ platforms: ['prime'] }),
  ];
  const rail = landedOnOtt(mixed, 'IN', TODAY);
  assert.equal(rail.releases.length, 2);
  assert.equal(rail.total, 2, `the heading still counted the guess (said ${rail.total})`);
});

test('both sides are newest first', () => {
  const older = iso(9);
  const newer = iso(2);
  const cin = inCinemas(
    [row({ releaseDate: older, platforms: ['theatres'] }), row({ releaseDate: newer, platforms: ['theatres'] })],
    'IN',
    TODAY,
  ).releases;
  assert.deepEqual([cin[0].releaseDate, cin[1].releaseDate], [newer, older]);

  const ott = landedOnOtt(
    [row({ releaseDate: older }), row({ releaseDate: newer })],
    'IN',
    TODAY,
  ).releases;
  assert.deepEqual([ott[0].releaseDate, ott[1].releaseDate], [newer, older]);
});

test('both sides respect region and require artwork', () => {
  const rows = [
    row({ platforms: ['theatres'], regions: ['US'] }),
    row({ platforms: ['theatres'], posterUrl: undefined }),
    row({ regions: ['US'] }),
    row({ posterUrl: undefined }),
  ];
  assert.equal(inCinemas(rows, 'IN', TODAY).releases.length, 0);
  assert.equal(landedOnOtt(rows, 'IN', TODAY).releases.length, 0);
});

test('one language cannot take the OTT row on a busy day', () => {
  // Behind the badged few this row is still the calendar it always was, and
  // the per-language rule still governs it: a quieter Tamil film must not sit
  // behind every Hindi one released the same day.
  const day = iso(3);
  const rows = [
    ...Array.from({ length: 5 }, () => row({ releaseDate: day, platforms: ['netflix'], languages: ['hi'], heat: 90 })),
    row({ releaseDate: day, platforms: ['netflix'], languages: ['ta'], heat: 10 }),
  ];
  const out = landedOnOtt(rows, 'IN', TODAY);
  const tail = out.releases.slice(out.trending ?? 0);
  assert.equal(tail[0].languages[0], 'ta', `the tail leads with ${tail[0].languages[0]}, not the other language`);
});

test('both sides cap the row', () => {
  const many = Array.from({ length: MAX_ITEMS + 12 }, (_, i) =>
    row({ releaseDate: iso((i % 10) + 1), platforms: ['theatres'] }),
  );
  assert.equal(inCinemas(many, 'IN', TODAY).releases.length, MAX_ITEMS);
});

test('the shipped feed fills both sides', () => {
  const feed = JSON.parse(readFileSync('public/data/releases.json', 'utf8'));
  const all = feed.weeks.flatMap((w) => w.releases);
  const cin = inCinemas(all, 'IN', new Date()).releases;
  const ott = landedOnOtt(all, 'IN', new Date()).releases;
  assert.ok(cin.length > 0, 'no cinema titles in the real feed');
  assert.ok(ott.length > 0, 'no streaming titles in the real feed');
  assert.ok(cin.every((r) => r.platforms.includes('theatres')));
  assert.ok(ott.every((r) => r.platforms.some((p) => p !== 'theatres')));
});

/**
 * The cinema row ranks by attention, end to end.
 *
 * The bug this encodes: a cinema run lasts six weeks, so strict date order
 * buries the biggest film on the board behind everything that merely opened
 * more recently. Mirzapur: The Movie was the highest-attention title in Indian
 * cinemas and sat nineteenth in this row.
 */
test('the biggest film in cinemas leads, however old it is', () => {
  const big = row({ releaseDate: iso(35), platforms: ['theatres'], heat: 95, title: 'Long runner' });
  const recent = Array.from({ length: 8 }, (_, i) =>
    row({ releaseDate: iso(i), platforms: ['theatres'], heat: 10 + i }),
  );
  const out = inCinemas([...recent, big], 'IN', TODAY);
  assert.equal(out.releases[0].title, 'Long runner', 'five weeks old and still the biggest');
  assert.equal(out.trending, TRENDING_IN_CINEMAS);
});

/**
 * The whole row, not just its head — which is the half the first version got
 * wrong and nobody noticed, because the three promoted cards looked right.
 *
 * Behind them the row was still chronological, so on a Friday it filled with
 * whatever had opened in the previous two days: twenty slots, three earned and
 * seventeen spent on small openings, several with no rating at all. A film with
 * real attention that opened last month could not get in at any position.
 */
test('a quiet opening today does not outrank a big film from last month', () => {
  const openedToday = Array.from({ length: MAX_ITEMS }, (_, i) =>
    row({ releaseDate: iso(0), platforms: ['theatres'], heat: 5, title: `Small ${i}` }),
  );
  const stillPlaying = row({
    releaseDate: iso(35),
    platforms: ['theatres'],
    heat: 42,
    title: 'Word of mouth',
  });
  const out = inCinemas([...openedToday, stillPlaying], 'IN', TODAY).releases;
  assert.equal(out[0].title, 'Word of mouth', `the row opened on ${out[0].title}`);
});

test('one language can take the whole shortlist when it owns the week', () => {
  // The deliberate exception to this site's interleave rule, and the reason it
  // needs a test of its own: everywhere else, four loud Hindi films crowding
  // out a quieter Tamil one is the bug. Here it is the answer. A reader asking
  // which films are big in cinemas right now is not asking for one per
  // language, and a rail that hands a slot to a heat-40 film because of its
  // language is answering a question nobody asked.
  const hindi = Array.from({ length: 4 }, (_, i) =>
    row({ releaseDate: iso(i + 2), platforms: ['theatres'], languages: ['hi'], heat: 90 - i }),
  );
  const tamil = row({ releaseDate: iso(9), platforms: ['theatres'], languages: ['ta'], heat: 40 });
  // Asserted over the row rather than over the badged head: the head is one
  // card now (see TRENDING_IN_CINEMAS) and one card cannot show whether a rule
  // about sharing slots between languages is in force. Four louder Hindi films
  // ahead of a quieter Tamil one is the observable form of the same property.
  const out = inCinemas([...hindi, tamil], 'IN', TODAY);
  const order = out.releases.map((r) => r.languages[0]);
  assert.deepEqual(
    order,
    ['hi', 'hi', 'hi', 'hi', 'ta'],
    `the interleave is still in the way: ${order.join(', ')}`,
  );
});

test('the interleave still holds on the rows built to spread a field', () => {
  // The exception is the ordering of the cinema row, not the rule itself.
  // Behind the badge the streaming row is a day-by-day calendar and the place
  // the per-language rule was written for, so it has to survive there.
  const day = iso(3);
  const rows = [
    ...Array.from({ length: 4 }, (_, i) =>
      row({ releaseDate: day, platforms: ['netflix'], languages: ['hi'], heat: 90 - i }),
    ),
    row({ releaseDate: day, platforms: ['netflix'], languages: ['ta'], heat: 40 }),
  ];
  const out = landedOnOtt(rows, 'IN', TODAY);
  const tail = out.releases.slice(out.trending ?? 0).map((r) => r.languages[0]);
  assert.equal(tail[0], 'ta', `the tail buried the quieter language: ${tail.join(', ')}`);
});

test('the streaming row leads on attention and then returns to its calendar', () => {
  // Asked for: strictly newest-first, a Friday fills every visible card with
  // whatever dropped that morning and the week's biggest arrival is behind it.
  const big = row({ releaseDate: iso(9), platforms: ['netflix'], heat: 99, title: 'The big one' });
  const today = Array.from({ length: 9 }, (_, i) =>
    row({ releaseDate: iso(0), platforms: ['netflix'], heat: i, title: `Quiet ${i}` }),
  );
  const out = landedOnOtt([...today, big], 'IN', TODAY);
  assert.equal(out.releases[0].title, 'The big one', `the row opened on ${out.releases[0].title}`);
  assert.equal(out.trending, TRENDING_IN_CINEMAS);
  const tail = out.releases.slice(out.trending).map((r) => r.releaseDate);
  assert.deepEqual([...tail].sort().reverse(), tail, 'the tail lost its date order');
});

test('a date with no service yet stays out of the row that names services', () => {
  /*
   * Every card in "On OTT" carries a platform pill, because "which OTT is it
   * on" is the commonest thing anyone has asked of this site.
   *
   * There used to be a synthetic `ott` platform standing in for a service TMDB
   * had not assigned, and it reached the site three ways at once: a pill
   * reading "Platform TBA", then "Digital", then a filter chip saying "On OTT
   * 6" next to a real "Netflix 1" — and selecting it emptied the rails,
   * because a fake platform is neither a cinema listing nor a named service.
   * It is gone; the fetcher no longer writes a streaming row it cannot place.
   *
   * What can still arrive is an archive row from before that rule with no
   * platforms at all, so the rails have to be indifferent to it rather than
   * merely unaware of it. It stays visible on the board and on its own page.
   */
  const rows = [
    ...Array.from({ length: 8 }, (_, i) =>
      row({ releaseDate: iso(i), platforms: ['netflix'], title: `Real ${i}` }),
    ),
    row({ releaseDate: iso(0), platforms: [], title: 'Date only' }),
  ];
  const out = landedOnOtt(rows, 'IN', TODAY);
  assert.ok(
    !out.releases.some((r) => r.title === 'Date only'),
    'a row that cannot name a service is in the row that exists to name services',
  );
  assert.equal(out.total, 8, 'and it is not counted there either');
});

test('an import is never crowned, and is not thrown off the row either', () => {
  /*
   * Reported: "doesn't make sense mutiny is on #2". It did not. TMDB
   * popularity for a British-American action picture is earned worldwide —
   * 343 against Hanuman Ansh's 34 — and read as Indian demand it put Statham
   * second in Indian cinemas. The badge is a claim about Indian cinemas; the
   * position is just the only attention number there is.
   */
  const local = Array.from({ length: 4 }, (_, i) =>
    row({ releaseDate: iso(i + 2), platforms: ['theatres'], heat: 70 - i, origin: ['IN'], title: `Local ${i}` }),
  );
  const loud = row({ releaseDate: iso(3), platforms: ['theatres'], heat: 95, origin: ['GB', 'US'], title: 'Import' });
  const out = inCinemas([...local, loud], 'IN', TODAY);
  const crowned = out.releases.slice(0, out.trending).map((r) => r.title);
  assert.ok(!crowned.includes('Import'), `the import was crowned: ${crowned.join(', ')}`);
  assert.ok(out.releases.some((r) => r.title === 'Import'), 'the import fell off the row entirely');
});

test('a co-production counts as local, and an unknown origin is not an import', () => {
  // Mirzapur: The Movie is IN/US and is the biggest film in Indian cinemas.
  // Eighteen of the ninety-three films in the window record no country at all,
  // including obviously Indian ones, so silence must never demote anything.
  const co = row({ releaseDate: iso(2), platforms: ['theatres'], heat: 95, origin: ['IN', 'US'], title: 'Co-production' });
  const quiet = row({ releaseDate: iso(3), platforms: ['theatres'], heat: 90, title: 'No origin recorded' });
  const rest = Array.from({ length: 4 }, (_, i) =>
    row({ releaseDate: iso(i + 4), platforms: ['theatres'], heat: 50 - i, origin: ['IN'] }),
  );
  // One case each, because the badged head is a single card now and two titles
  // cannot both hold it. Each is the loudest thing in its own row, so if origin
  // demoted it the card would go to something quieter.
  const withCo = inCinemas([co, ...rest], 'IN', TODAY);
  assert.equal(
    withCo.releases[0].title,
    'Co-production',
    `India among several was treated as foreign: the row opened on ${withCo.releases[0].title}`,
  );
  const withQuiet = inCinemas([quiet, ...rest], 'IN', TODAY);
  assert.equal(
    withQuiet.releases[0].title,
    'No origin recorded',
    `an unrecorded origin was treated as foreign: the row opened on ${withQuiet.releases[0].title}`,
  );
});

test('a row too short to have standouts says nothing rather than crowning everything', () => {
  // A badge on the whole row tells a reader nothing. That used to mean three
  // cards of three; with a single-card head it means one of one, which is the
  // same sentence about a shorter row.
  const alone = [row({ releaseDate: iso(0), platforms: ['theatres'], heat: 50 })];
  assert.equal(inCinemas(alone, 'IN', TODAY).trending, undefined);

  // And two is enough to distinguish one from the other, so the badge returns.
  const pair = Array.from({ length: 2 }, (_, i) =>
    row({ releaseDate: iso(i + 8), platforms: ['theatres'], heat: 50 - i }),
  );
  assert.equal(inCinemas(pair, 'IN', TODAY).trending, TRENDING_IN_CINEMAS);
});

test('the count is everything playing, not everything the row could show', () => {
  // The heading prints this number and /in-cinemas has to agree with it, so it
  // counts films without posters that the poster row itself cannot carry.
  const rows = [
    ...Array.from({ length: MAX_ITEMS + 5 }, (_, i) =>
      row({ releaseDate: iso(i % 30), platforms: ['theatres'], heat: i }),
    ),
    row({ releaseDate: iso(2), platforms: ['theatres'], posterUrl: undefined }),
  ];
  const out = inCinemas(rows, 'IN', TODAY);
  assert.equal(out.total, MAX_ITEMS + 6);
  assert.equal(out.releases.length, MAX_ITEMS);
});

test('ranking never duplicates a title', () => {
  const rows = Array.from({ length: 12 }, (_, i) =>
    row({ releaseDate: iso(i), platforms: ['theatres'], heat: i * 7 }),
  );
  const out = inCinemas(rows, 'IN', TODAY).releases;
  assert.equal(new Set(out.map((r) => r.id)).size, out.length, 'a title appears twice');
});

test('the shipped feed produces a row that is both a ranking and news', () => {
  /*
   * The same two properties this row has always owed, asked of the feed that
   * ships rather than of a fixture — but without naming anything in it.
   *
   * This test used to pin three live facts at a fixed date: that the row led
   * on Mirzapur: The Movie, and that Hanuman Ansh had a seat, evaluated at
   * 11 September. It passed for six weeks and then could never pass again.
   * The feed is a rolling window of about eleven weeks, and on Friday 25
   * September it rolled past 7 August and took Hanuman Ansh out of the data
   * altogether — so the gate failed, the commit step was skipped, and Friday's
   * calendar, the biggest release day of the week, did not publish. Mirzapur
   * was the same bomb on a longer fuse, and so was the hardcoded date.
   *
   * A test against live data cannot name a row in it. What it can do is state
   * the property the names were standing in for, which is the whole argument
   * of this row in one line: a ranking that is also news. An established film
   * deep into its run keeps its seat, and something from this week is on the
   * row beside it. Both halves have been reported as broken, in that order.
   */
  const feed = JSON.parse(readFileSync('public/data/releases.json', 'utf8'));
  const all = feed.weeks.flatMap((w) => w.releases);
  const now = new Date();
  const out = inCinemas(all, 'IN', now);

  assert.ok(out.releases.length > 0, 'the cinema row is empty against the shipped feed');
  assert.equal(new Set(out.releases.map((r) => r.id)).size, out.releases.length, 'a title appears twice');
  if (out.releases.length > TRENDING_IN_CINEMAS) {
    assert.equal(out.trending, TRENDING_IN_CINEMAS, 'the shipped row lost its badge');
  }

  const ago = (days) => new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);

  /* Still a ranking: chronology alone would have swept these off. */
  const established = out.releases.filter((r) => r.releaseDate < ago(14));
  assert.ok(
    established.length > 0,
    `the row is pure chronology — nothing on it opened before ${ago(14)}`,
  );

  /* Still news: whatever opened this week reaches it. Asserted only when the
     feed actually has such a film, because a week with no openings is a fact
     about the week rather than a failure of the row. */
  const openedThisWeek = all.filter(
    (r) =>
      r.regions?.includes('IN') &&
      r.platforms?.includes('theatres') &&
      r.posterUrl &&
      r.releaseDate >= ago(6) &&
      r.releaseDate <= now.toISOString().slice(0, 10),
  );
  if (openedThisWeek.length > 0) {
    const onRow = out.releases.filter((r) => r.releaseDate >= ago(6));
    assert.ok(
      onRow.length > 0,
      `${openedThisWeek.length} film(s) opened this week and none reached the row`,
    );
  }
});

test('a narrowed streaming row reaches back until it has something to say', () => {
  /*
   * "When I select this filter the top rails are gone."
   *
   * Most of that was a synthetic platform belonging to neither row, fixed at
   * the source. What was left is this: Shudder has one title in the whole feed
   * and it landed months ago, so a fortnight-wide row filtered to Shudder is
   * empty, the band collapses, and tapping a chip still makes two thirds of the
   * page vanish.
   *
   * A film that reached Shudder in July is on Shudder right now — that is what
   * a subscription is — so "On right now" over it is true and the row may
   * widen. The cinema row may not, and does not: a film that opened in July is
   * not still playing, which is the asymmetry this pair is built on.
   */
  const rows = [row({ releaseDate: iso(120), platforms: ['shudder'], title: 'Months ago' })];
  assert.equal(landedOnOtt(rows, 'IN', TODAY).releases.length, 0, 'the fortnight moved');
  const wide = landedOnOtt(rows, 'IN', TODAY, NARROWED_DAYS);
  assert.equal(wide.releases.length, 1, 'a narrowed reader still gets nothing');
  assert.equal(wide.releases[0].title, 'Months ago');
});

test('a widened row crowns nobody', () => {
  // "Trending" is a claim about now. Across a year it would badge whatever
  // happened to be the biggest thing of the year, on a row the reader reached
  // by asking for one platform.
  const rows = Array.from({ length: 8 }, (_, i) =>
    row({ releaseDate: iso(30 + i), platforms: ['netflix'], heat: i * 5, languages: ['hi'] }),
  );
  assert.equal(landedOnOtt(rows, 'IN', TODAY, NARROWED_DAYS).trending, undefined);
});

test('the cinema row does not widen, whatever the reader asked for', () => {
  // Only landedOnOtt takes the wider window, and this is the reason: a film
  // that opened four months ago is not in cinemas, and a row headed "In
  // cinemas" saying it is would be the Netflix-badge-in-the-cinema-rail defect
  // wearing a date instead of a platform.
  const rows = [row({ releaseDate: iso(120), platforms: ['theatres'], title: 'Long gone' })];
  assert.equal(inCinemas(rows, 'IN', TODAY).releases.length, 0);
});

test('a selection whose titles are all still ahead still fills the band', () => {
  /*
   * The third costume of "the top rails are gone", and one I created.
   *
   * Both rows above look backwards — a cinema run, and what has landed — so a
   * platform whose only title is still ahead of its date empties the band. That
   * was rare while the future weeks were empty. Then the release-note and
   * network passes filled those weeks up, and it became ordinary: Peacock has
   * exactly one Indian title and it is in October, Lionsgate one American title
   * at the end of September. Tapping either chip made two thirds of the page
   * disappear.
   *
   * So the band falls back to what the selection has coming, reaching as far
   * forward as the streaming row reaches back, under a heading that says so
   * rather than claiming the present tense.
   */
  const rows = [row({ releaseDate: iso(-40), platforms: ['peacock'], title: 'Out in October' })];
  assert.equal(landedOnOtt(rows, 'IN', TODAY, NARROWED_DAYS).releases.length, 0, 'it is not out yet');
  assert.equal(inCinemas(rows, 'IN', TODAY).releases.length, 0, 'and it is not in cinemas');
  assert.equal(landingSoon(rows, 'IN', TODAY).releases.length, 0, 'the usual horizon is three weeks');
  const wide = landingSoon(rows, 'IN', TODAY, NARROWED_DAYS);
  assert.equal(wide.releases.length, 1, 'a narrowed reader still gets an empty band');
  assert.equal(wide.releases[0].title, 'Out in October');
});

test('the forward row keeps nearest-first, however far it reaches', () => {
  // The point of the row is what is closest. Widening the horizon must not
  // quietly turn it into the same newest-first ordering as everything else.
  const rows = [
    row({ releaseDate: iso(-200), platforms: ['netflix'], title: 'Far' }),
    row({ releaseDate: iso(-5), platforms: ['netflix'], title: 'Near' }),
  ];
  const out = landingSoon(rows, 'IN', TODAY, NARROWED_DAYS).releases;
  assert.equal(out[0].title, 'Near');
});

test("today's openings are on the row, not behind the whole ranking", () => {
  /*
   * The reported defect, in miniature.
   *
   * Attention is earned after a film opens, so a title released this morning
   * has none and sorts below every film still playing from last month. On 18
   * September that put sixteen of the day's openings off a twenty-card row and
   * the seventeenth at card seventeen — on a release calendar, on release day.
   */
  const old = Array.from({ length: 20 }, (_, i) =>
    row({ releaseDate: iso(20), platforms: ['theatres'], heat: 100 - i, title: `Old ${i}` }),
  );
  const opened = row({ releaseDate: iso(0), platforms: ['theatres'], heat: 0, title: 'Opened today' });
  const out = inCinemas([...old, opened], 'IN', TODAY).releases;
  const at = out.findIndex((r) => r.title === 'Opened today');
  assert.ok(at >= 0, 'it is on the row at all');
  assert.equal(at, TRENDING_IN_CINEMAS, 'and directly behind the badged films');
});

test('the allowance is an allowance, not the whole row', () => {
  // The other half of the trade. Date order was tried and filled the row with
  // small openings while the big film of the month sat seventieth; today gets
  // a fixed number of places, and the ranking keeps the rest.
  const old = Array.from({ length: 20 }, (_, i) =>
    row({ releaseDate: iso(20), platforms: ['theatres'], heat: 100 - i, title: `Old ${i}` }),
  );
  const fresh = Array.from({ length: 12 }, (_, i) =>
    row({ releaseDate: iso(0), platforms: ['theatres'], heat: 0, title: `Fresh ${i}` }),
  );
  const out = inCinemas([...old, ...fresh], 'IN', TODAY).releases;
  const today = out.filter((r) => r.title.startsWith('Fresh'));
  assert.equal(today.length, NEW_IN_CINEMAS, 'six of the twelve, not all twelve');
  assert.equal(out[0].title, 'Old 0', 'and the biggest film still leads the row');
});

test("today's allowance spreads across languages", () => {
  /*
   * None of these titles has any attention yet — that is what makes them
   * today's — so ranking them against each other is ranking noise. A Friday
   * that opens across seven languages should look like one.
   */
  const fresh = [
    ...Array.from({ length: 6 }, (_, i) =>
      row({ releaseDate: iso(0), platforms: ['theatres'], languages: ['ta'], heat: 6 - i, title: `Tamil ${i}` }),
    ),
    row({ releaseDate: iso(0), platforms: ['theatres'], languages: ['ml'], heat: 1, title: 'Malayalam' }),
  ];
  const old = Array.from({ length: 10 }, (_, i) =>
    row({ releaseDate: iso(20), platforms: ['theatres'], heat: 100 - i, title: `Old ${i}` }),
  );
  const out = inCinemas([...old, ...fresh], 'IN', TODAY).releases;
  assert.ok(
    out.some((r) => r.title === 'Malayalam'),
    'the one Malayalam opening is not buried under six Tamil ones',
  );
});

test('the badge still counts only the films it was made about', () => {
  // The allowance sits behind the badged cards and must never be mistaken for
  // them: a film with no attention yet is not "trending".
  const rows = [
    ...Array.from({ length: 5 }, (_, i) =>
      row({ releaseDate: iso(20), platforms: ['theatres'], heat: 100 - i, title: `Old ${i}` }),
    ),
    row({ releaseDate: iso(0), platforms: ['theatres'], heat: 0, title: 'Opened today' }),
  ];
  const out = inCinemas(rows, 'IN', TODAY);
  assert.equal(out.trending, TRENDING_IN_CINEMAS);
  assert.ok(
    out.releases.slice(0, out.trending).every((r) => r.title !== 'Opened today'),
    'the badged cards are the ranked ones',
  );
});

test('a day with no openings changes nothing', () => {
  // The allowance is only spent when there is something to spend it on. On a
  // Tuesday the row is the ranking it always was.
  const rows = Array.from({ length: 8 }, (_, i) =>
    row({ releaseDate: iso(20 + i), platforms: ['theatres'], heat: 100 - i, title: `Old ${i}` }),
  );
  const out = inCinemas(rows, 'IN', TODAY).releases.map((r) => r.title);
  assert.deepEqual(out, rows.map((r) => r.title));
});

test('a Friday opening is still new on Saturday', () => {
  /*
   * The first version of the allowance reserved places for films dated exactly
   * today, and it lasted one day. Same feed, one turn of the clock: the
   * sixteen films that opened on Friday the 18th fell out of cards four to
   * nine and back to a single card at seventeen, and it was reported on the
   * Saturday morning.
   *
   * TODAY here is a Monday, so this is three days after the week opened — the
   * case the day-shaped rule could not survive.
   */
  const old = Array.from({ length: 20 }, (_, i) =>
    row({ releaseDate: iso(20), platforms: ['theatres'], heat: 100 - i, title: `Old ${i}` }),
  );
  const friday = row({
    releaseDate: iso(3),
    platforms: ['theatres'],
    heat: 0,
    title: 'Opened Friday',
  });
  const out = inCinemas([...old, friday], 'IN', TODAY).releases;
  assert.equal(
    out.findIndex((r) => r.title === 'Opened Friday'),
    TRENDING_IN_CINEMAS,
    'still directly behind the badged films, days after it opened',
  );
});

test('last week’s openings age out when this week’s arrive', () => {
  // The other side of it. The allowance is the current release week, so a film
  // stops being new when the next Friday's crop lands — not overnight, and not
  // never.
  // Ten, not twenty: the point is where it lands, so the row has to be short
  // enough that it lands anywhere at all rather than falling off the cap.
  const old = Array.from({ length: 10 }, (_, i) =>
    row({ releaseDate: iso(20), platforms: ['theatres'], heat: 100 - i, title: `Old ${i}` }),
  );
  // iso(4) is the Thursday before this week's Friday — last week's crop.
  const lastWeek = row({
    releaseDate: iso(4),
    platforms: ['theatres'],
    heat: 0,
    title: 'Last week',
  });
  const out = inCinemas([...old, lastWeek], 'IN', TODAY).releases;
  assert.equal(
    out.findIndex((r) => r.title === 'Last week'),
    out.length - 1,
    'it takes its place in the ranking like everything else — last, on no attention',
  );
});

test('the newest day leads the allowance', () => {
  // Within the week the allowance is still a calendar: Saturday's openings sit
  // in front of Friday's, the same ordering every other dated row uses.
  const old = Array.from({ length: 20 }, (_, i) =>
    row({ releaseDate: iso(20), platforms: ['theatres'], heat: 100 - i, title: `Old ${i}` }),
  );
  const friday = row({ releaseDate: iso(3), platforms: ['theatres'], heat: 50, title: 'Friday' });
  const sunday = row({ releaseDate: iso(1), platforms: ['theatres'], heat: 0, title: 'Sunday' });
  const out = inCinemas([...old, friday, sunday], 'IN', TODAY).releases;
  assert.ok(
    out.indexOf(out.find((r) => r.title === 'Sunday')) <
      out.indexOf(out.find((r) => r.title === 'Friday')),
    'the later opening comes first, whatever the attention numbers say',
  );
});

/*
 * ---------------------------------------------------------------------------
 * The row a phone can actually see
 *
 * Three separate reports, three separate fixes, and the same complaint each
 * time: "the rails are not refreshed". The first two fixes were about whether
 * a new film was in the row at all, and both were right — the allowance put
 * this week's openings in cards four to nine and the tests proved it.
 *
 * Nobody tested where four to nine is. A phone shows between two and three
 * cards, and the badged head was three, so every fix landed just past the edge
 * of the screen. Rebuilt from the data that shipped each morning, the cinema
 * row opened with the same three titles on all seven days to 24 September and
 * the streaming row had the same card two on all seven.
 *
 * So these two tests are about the visible window rather than the array. They
 * are the ones that would have caught it.
 */

/** What a 360px phone gets before it has to swipe, measured in the browser. */
const VISIBLE_ON_A_PHONE = 3;

test('a film that opens today reaches the cards a phone can see', () => {
  // The row it has to get past: a month of films that have had time to earn
  // attention, which a title released this morning cannot have by construction.
  const established = Array.from({ length: 12 }, (_, i) =>
    row({ releaseDate: iso(i + 10), platforms: ['theatres'], heat: 90 - i, title: `Playing ${i}` }),
  );
  const openedToday = row({
    releaseDate: iso(0),
    platforms: ['theatres'],
    heat: 0,
    title: 'Opened this morning',
  });

  const out = inCinemas([...established, openedToday], 'IN', TODAY).releases;
  const seen = out.slice(0, VISIBLE_ON_A_PHONE).map((r) => r.title);
  assert.ok(
    seen.includes('Opened this morning'),
    `a phone would show none of today's openings: ${seen.join(', ')}`,
  );
});

test('the head of each row changes when something new lands', () => {
  /*
   * The complaint itself, as a test. Not "is the new title present" but "did
   * the page change" — which is the only thing a returning reader can observe,
   * and the thing that was false for a week while every other test passed.
   */
  const yesterday = new Date(TODAY.getTime() - 86_400_000);
  const dayBefore = (n) => new Date(yesterday.getTime() - n * 86_400_000).toISOString().slice(0, 10);

  const backdrop = Array.from({ length: 12 }, (_, i) => [
    row({ releaseDate: dayBefore(i + 6), platforms: ['theatres'], heat: 90 - i, title: `Cinema ${i}` }),
    row({ releaseDate: dayBefore(i + 1), platforms: ['netflix'], heat: 90 - i, title: `Stream ${i}` }),
  ]).flat();

  const landedOvernight = [
    row({ releaseDate: iso(0), platforms: ['theatres'], heat: 1, title: 'Opened overnight' }),
    row({ releaseDate: iso(0), platforms: ['netflix'], heat: 1, title: 'Dropped overnight' }),
  ];

  const head = (rel) => rel.slice(0, VISIBLE_ON_A_PHONE).map((r) => r.title).join(' | ');

  const cinemaBefore = head(inCinemas(backdrop, 'IN', yesterday).releases);
  const cinemaAfter = head(inCinemas([...backdrop, ...landedOvernight], 'IN', TODAY).releases);
  assert.notEqual(
    cinemaAfter,
    cinemaBefore,
    `the cinema row looks identical two days running: ${cinemaAfter}`,
  );

  const ottBefore = head(landedOnOtt(backdrop, 'IN', yesterday).releases);
  const ottAfter = head(landedOnOtt([...backdrop, ...landedOvernight], 'IN', TODAY).releases);
  assert.notEqual(
    ottAfter,
    ottBefore,
    `the streaming row looks identical two days running: ${ottAfter}`,
  );
});

test('the badged head never fills the visible row on its own', () => {
  // The structural version of the above, and the one that fails loudly if
  // somebody widens the head again: whatever else changes, a phone must never
  // be looking at nothing but the ranking.
  assert.ok(
    TRENDING_IN_CINEMAS < VISIBLE_ON_A_PHONE,
    `${TRENDING_IN_CINEMAS} badged cards leaves no room for news in ${VISIBLE_ON_A_PHONE}`,
  );
});
