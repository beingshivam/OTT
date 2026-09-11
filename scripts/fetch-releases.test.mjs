/**
 * The digital-release pass, run against a TMDB that does what I say it does.
 *
 * Two different things could be wrong with this feature and only one of them is
 * testable here. Whether TMDB's `with_release_type=4` actually returns useful
 * Indian titles is a question about TMDB, and no local fixture settles it —
 * that answer arrives with the first real refresh. What a fixture *can* settle
 * is the part I control and would not notice being wrong: that the query asks
 * for the right thing, and that the fold never overwrites a real platform with
 * "somewhere, eventually".
 *
 * That second rule is the dangerous one. Get it backwards and every Netflix
 * row in the calendar quietly turns into "Digital release" — a regression that
 * looks like a data problem, arrives on a Friday, and reads as the site not
 * knowing where anything is.
 *
 * Runs the real script with a stubbed global fetch and FEED_OUT pointed at a
 * temp file, so the calendar it writes over is one this test made.
 *
 * Run: npm run test:fetch
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = new URL('..', import.meta.url).pathname;

/**
 * One TMDB, faked. Keyed loosely on the path and the params that distinguish
 * the three discovery passes from each other.
 */
const STUB = `
const movie = (id, over = {}) => ({
  id,
  title: 'Title ' + id,
  original_language: 'hi',
  release_date: SOON,
  genre_ids: [],
  popularity: 10,
  vote_average: 7,
  vote_count: 100,
  overview: 'x',
  poster_path: '/p.jpg',
  ...over,
});

import fsSync from 'node:fs';
globalThis.__calls = [];
process.on('exit', () => {
  try {
    fsSync.writeFileSync(process.env.CALL_LOG, JSON.stringify(globalThis.__calls));
  } catch {}
});
globalThis.fetch = async (url) => {
  const u = new URL(String(url));
  const p = u.pathname;
  const q = Object.fromEntries(u.searchParams);
  globalThis.__calls.push({ path: p, q });

  const json = (body) => ({ ok: true, status: 200, json: async () => body });

  if (p.endsWith('/genre/movie/list') || p.endsWith('/genre/tv/list')) return json({ genres: [] });

  // Providers: 1 is on Netflix (8); 4 is on Prime (9) and reaches the feed only
  // through the digital pass; nothing else has a service yet.
  if (/\\/watch\\/providers$/.test(p)) {
    const id = p.split('/')[3];
    if (id === '1') return json({ results: { IN: { flatrate: [{ provider_id: 8 }] } } });
    if (id === '4') return json({ results: { IN: { flatrate: [{ provider_id: 9 }] } } });
    return json({ results: {} });
  }

  if (p.endsWith('/discover/movie')) {
    // The theatrical pass asks for types 2|3, the digital one for 4.
    if (q.with_release_type === '2|3') return json({ results: [movie(2)], total_pages: 1 });
    if (q.with_release_type === '4') {
      // 1 is already on Netflix, 2 already in cinemas, 3 is digital-only and
      // still ahead, 4 is a digital date TMDB has already named, and 5 has
      // arrived with nobody attached — the case that must not ship.
      return json({
        results: [movie(1), movie(2), movie(3), movie(4), movie(5, { release_date: TODAY })],
        total_pages: 1,
      });
    }
    // The provider pass.
    return json({ results: [movie(1)], total_pages: 1 });
  }
  if (p.endsWith('/discover/tv')) return json({ results: [], total_pages: 1 });
  if (p.endsWith('/trending/all/week')) return json({ results: [] });
  return json({ results: [], total_pages: 1 });
};
`;

function run() {
  const dir = mkdtempSync(join(tmpdir(), 'feed-'));
  const out = join(dir, 'releases.json');
  const today = new Date().toISOString().slice(0, 10);
  // Three days out, so the pre-release case and the arrived case are both in
  // the same week and the same run.
  const soon = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
  const preload = join(dir, 'stub.mjs');
  writeFileSync(
    preload,
    `const TODAY = ${JSON.stringify(today)};\nconst SOON = ${JSON.stringify(soon)};\n${STUB}`,
  );

  execFileSync(
    process.execPath,
    ['--import', `file://${preload}`, 'scripts/fetch-releases.mjs', '--weeks-back', '0', '--weeks-ahead', '1', '--theatre-weeks-back', '0'],
    {
      cwd: ROOT,
      stdio: 'pipe',
      env: {
        ...process.env,
        TMDB_TOKEN: 'test-key',
        REGIONS: 'IN',
        FEED_OUT: out,
        CALL_LOG: join(dir, 'calls.json'),
      },
    },
  );

  const feed = JSON.parse(readFileSync(out, 'utf8'));
  const calls = JSON.parse(readFileSync(join(dir, 'calls.json'), 'utf8'));
  rmSync(dir, { recursive: true, force: true });
  return { feed, calls };
}

const TODAY = new Date().toISOString().slice(0, 10);
const { feed, calls } = run();
const rows = feed.weeks.flatMap((w) => w.releases);
const byId = new Map(rows.map((r) => [r.id, r]));

test('a digital date with no service still reaches the calendar, before the date', () => {
  // Title 3 exists only in the release-type-4 response. Without this pass it
  // would not be in the feed at all, which is why "Coming soon" was cinema and
  // almost nothing else. Dated ahead, so it is a promise rather than a shrug.
  const only = byId.get('m-3~ott');
  assert.ok(only, 'the digital-only title is missing from the feed entirely');
  assert.deepEqual(only.platforms, ['ott']);
  assert.ok(only.releaseDate > TODAY, 'the fixture no longer tests the pre-release case');
});

test('a date that has arrived still ships, service named or not', () => {
  /*
   * This asserted the opposite for about an hour, and the hour was expensive.
   *
   * The reasoning was that a released title nobody can place is an admission
   * rather than news — true of the *label* beside it, and I applied it to the
   * row. The current week emptied: seven titles dated 11 September vanished,
   * one of them a Netflix release confirmed by hand, and the site said nothing
   * was releasing that week at all.
   *
   * These rows are also the only cover for the window that matters most. TMDB
   * attaches providers on or after release day, so the current week is always
   * sparse on its own Friday and fills in behind itself — last Friday's
   * seventeen drops arrived days late. Without them, Friday is an empty site.
   */
  const out = byId.get('m-5~ott');
  assert.ok(out, 'a released title with no service named has been hidden again');
  assert.deepEqual(out.platforms, ['ott']);
});

test('a streaming date is its own row, not the cinema listing wearing its id', () => {
  /*
   * The invariant this protects is "no duplicate ids", and breaking it did real
   * damage before anyone noticed. The digital pass deduplicates within a week,
   * so a film in cinemas in August and on OTT in September came back as two
   * rows sharing one id. The archive merge keys on id, so the streaming row
   * *overwrote* the cinema listing in the permanent record — 146 entries — and
   * the title page, which looks a film up by id, answered "when is this coming
   * to OTT" with whichever row it happened to find.
   */
  const ids = new Set(rows.map((r) => r.id));
  for (const id of ids) {
    if (!id.endsWith('~ott')) continue;
    assert.ok(
      !ids.has(id.replace(/~ott$/, '')),
      `${id} collides with the cinema listing it was meant to be distinct from`,
    );
  }
  /*
   * One direction only. The suffix says "this row is the film's streaming
   * date", not "this row has no platform" — a digital row whose service TMDB
   * already knows carries that service and keeps its suffix, because it is
   * still a separate calendar entry from the cinema listing. What must never
   * happen is the reverse: the placeholder appearing on a row that is not a
   * streaming date, which would be a cinema listing claiming to be an OTT one.
   */
  for (const r of rows) {
    if (!r.platforms.includes('ott')) continue;
    assert.ok(r.id.endsWith('~ott'), `${r.id} wears the placeholder without being a streaming date`);
  }
});

test('a date outside the week is not dragged into it', () => {
  // Discover returns a film for a window its digital date is only adjacent to,
  // and the clamp that handles a stray date elsewhere then invented a second
  // release on the week's first day: Spidey and the Avengers shipped twice,
  // dated the 24th in one week and the 25th in the next.
  for (const week of feed.weeks) {
    for (const r of week.releases) {
      if (!r.id.endsWith('~ott')) continue;
      assert.ok(
        r.releaseDate >= week.start && r.releaseDate <= week.end,
        `${r.id} is dated ${r.releaseDate} in the week ${week.start}–${week.end}`,
      );
    }
  }
});

test('a real provider is never overwritten by an unknown one', () => {
  // Title 1 comes back from the provider pass on Netflix *and* from the digital
  // pass. Netflix is a fact; "ott" is an absence of one.
  const known = byId.get('m-1');
  assert.ok(known, 'the Netflix title vanished');
  assert.ok(!known.platforms.includes('ott'), `got ${known.platforms.join(', ')}`);
  assert.ok(known.platforms.includes('netflix'));
});

test('a cinema listing is not also "coming to streaming"', () => {
  // Title 2 is in cinemas this week and appears in the digital response too.
  const cinema = byId.get('m-2');
  assert.ok(cinema, 'the theatrical title vanished');
  assert.ok(!cinema.platforms.includes('ott'), `got ${cinema.platforms.join(', ')}`);
  assert.ok(cinema.platforms.includes('theatres'));
});

test('a digital date asks who has it before saying nobody knows', () => {
  /*
   * Reported from the site: a film released on OTT *today* showing "Platform
   * TBA" when its service had been announced for weeks. This pass shipped
   * without ever calling watch/providers, and it is the only pass that can
   * cover these rows — the provider discovery above asks TMDB for titles whose
   * *primary* release date falls in the week, so a film that opened in cinemas
   * in August and streams in September is never returned for the week it
   * actually lands in.
   */
  const named = byId.get('m-4~ott');
  assert.ok(named, 'the digital row is missing');
  assert.deepEqual(named.platforms, ['prime'], `got ${named.platforms.join(', ')}`);
  assert.ok(
    calls.some((c) => /\/movie\/4\/watch\/providers$/.test(c.path)),
    'the digital pass never asked who has it',
  );
});

test('the placeholder is what is left when TMDB really has nobody', () => {
  // Title 3 has a date and no provider anywhere. That is the state the
  // placeholder exists for, and it has to survive — the fix above must not
  // turn "no service yet" into no row.
  const pending = byId.get('m-3~ott');
  assert.ok(pending, 'the unplaced digital title vanished');
  assert.deepEqual(pending.platforms, ['ott']);
});

test('the digital query asks TMDB for digital dates, by region', () => {
  // Cheap to get wrong and invisible when you do: the wrong release type
  // returns plausible rows that are simply the wrong list.
  const digital = calls.filter((c) => c.q.with_release_type === '4');
  assert.ok(digital.length > 0, 'no digital query was ever made');
  for (const c of digital) {
    assert.equal(c.q.region, 'IN');
    assert.ok(c.q['release_date.gte'] && c.q['release_date.lte'], 'the window was not bounded');
  }
});
