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

  // Release dates. 7 has the platform written on the digital date itself, the
  // way a distributor types it when the date is announced.
  if (/\\/release_dates$/.test(p)) {
    const id = p.split('/')[3];
    if (id === '7') {
      return json({
        results: [
          { iso_3166_1: 'IN', release_dates: [{ type: 4, note: 'Prime Video' }] },
        ],
      });
    }
    return json({ results: [] });
  }

  // Series detail: 100 is an Apple TV+ show, 101 is on a channel this site does
  // not carry. Both are announced; only one can be named.
  if (/^\\/3\\/tv\\/\\d+$/.test(p)) {
    const id = p.split('/')[3];
    return json({
      id: Number(id),
      networks: id === '100' ? [{ name: 'Apple TV+' }] : [{ name: 'Doordarshan Regional' }],
      production_companies: [],
    });
  }

  // Movie detail. 6 was made by Netflix and nobody is listed as carrying it —
  // the studio is the only thing that can place it.
  if (/^\\/3\\/movie\\/\\d+$/.test(p)) {
    const id = p.split('/')[3];
    return json({
      id: Number(id),
      production_companies: id === '6' ? [{ name: 'Netflix' }] : [{ name: 'Some Films Pvt Ltd' }],
    });
  }

  if (p.endsWith('/discover/movie')) {
    // The theatrical pass asks for types 2|3, the digital one for 4.
    if (q.with_release_type === '2|3') return json({ results: [movie(2)], total_pages: 1 });
    if (q.with_release_type === '4') {
      // 1 is already on Netflix, 2 already in cinemas, 3 is digital-only and
      // still ahead, 4 is a digital date TMDB has already named, 5 has arrived
      // with nobody attached — the case that must not ship — 6 has nobody
      // carrying it but Netflix as its studio, and 7 has nobody and no studio
      // but names Prime Video on the release date itself.
      return json({
        results: [
          movie(1),
          movie(2),
          movie(3),
          movie(4),
          movie(5, { release_date: TODAY }),
          movie(6),
          movie(7),
        ],
        total_pages: 1,
      });
    }
    // The provider pass.
    return json({ results: [movie(1)], total_pages: 1 });
  }
  // The series pass asks by first_air_date and no monetization filter; the
  // provider pass asks with one. Only the former returns the new shows, which
  // is the whole point — a series with no provider yet is invisible to the other.
  if (p.endsWith('/discover/tv')) {
    if (q['first_air_date.gte'] && !q.with_watch_monetization_types) {
      return json({
        results: [
          { id: 100, name: 'Series 100', original_language: 'en', first_air_date: SOON,
            genre_ids: [], popularity: 10, vote_average: 7, vote_count: 100,
            overview: 'x', poster_path: '/p.jpg' },
          { id: 101, name: 'Series 101', original_language: 'hi', first_air_date: SOON,
            genre_ids: [], popularity: 9, vote_average: 7, vote_count: 100,
            overview: 'x', poster_path: '/p.jpg' },
        ],
        total_pages: 1,
      });
    }
    return json({ results: [], total_pages: 1 });
  }
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

  const log = execFileSync(
    process.execPath,
    ['--import', `file://${preload}`, 'scripts/fetch-releases.mjs', '--weeks-back', '0', '--weeks-ahead', '1', '--theatre-weeks-back', '0'],
    {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
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
  return { feed, calls, log };
}

const { feed, calls, log } = run();
const rows = feed.weeks.flatMap((w) => w.releases);
const byId = new Map(rows.map((r) => [r.id, r]));

test('a digital date with no service is not written at all', () => {
  /*
   * Titles 3 and 5 exist only in the release-type-4 response and TMDB has
   * nobody for either — 3 still ahead of its date, 5 already arrived.
   *
   * This shipped a synthetic `ott` platform for them and it was rejected under
   * all three names it was given: "Digital", then "Platform TBA", then
   * "Releasing on OTT". The clearest report — "only 1 in Netflix rest all in
   * OTT, there should be exact OTT names rather than this ambiguous thing" —
   * is right: a bucket labelled with the category is the question repeated
   * back, not an answer to it.
   *
   * It was load-bearing for a second defect too. A row on a platform that is
   * not a platform belongs to neither rail, so filtering to it emptied the
   * band above the board.
   *
   * The cost is coverage, and it is paid deliberately. What covers the window
   * instead is the re-check pass, data/upcoming-ott.json, and the fact that
   * the feed rebuilds daily rather than once on Friday.
   */
  for (const id of ['m-3~ott', 'm-5~ott']) {
    const ghost = byId.get(id);
    assert.ok(!ghost, `${id} shipped as ${ghost && JSON.stringify(ghost.platforms)}`);
  }
});

test('who made it answers when who is carrying it will not', () => {
  /*
   * Title 6 has a digital date, nobody listed as carrying it, and Netflix as
   * its production company. A platform that commissioned a film is where that
   * film lands, and TMDB knows the studio long before it knows the provider —
   * on a real run this is the difference between dropping two titles and
   * listing them, which is small and is not nothing when the alternative is
   * the current week going almost empty.
   *
   * It has to happen here rather than in enrichment, where the same rule
   * already lived: the row it rescues is dropped before enrichment sees it.
   */
  const saved = byId.get('m-6~ott');
  assert.ok(saved, 'a row the studio could place was dropped anyway');
  assert.deepEqual(saved.platforms, ['netflix'], `got ${saved.platforms.join(', ')}`);
});

test('a studio nobody has heard of does not become a platform', () => {
  // Title 3's producer matches nothing in the registry, so the studio lookup
  // adds nothing and the drop stands. A pill reading "Some Films Pvt Ltd" is
  // the placeholder problem again wearing a different name.
  assert.ok(!byId.get('m-3~ott'), 'an unrecognised studio placed a row');
});

test('no row anywhere in the feed is missing a platform', () => {
  // The rule above stated at the feed level, so a second route to the same
  // half-written row — a curated entry, an archive merge — fails here too.
  // A row that cannot say where you watch it has nothing to tell anybody.
  for (const r of rows) {
    assert.ok(r.platforms.length, `${r.id} (${r.title}) has no platform`);
  }
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
   * The suffix is an id namespace and nothing else. It says "this row is the
   * film's streaming date", so every row wearing it names a service and none
   * of them is in cinemas — a suffixed row claiming a cinema listing would be
   * the "why the hell are these in cinemas" defect from the other direction.
   */
  for (const r of rows) {
    if (!r.id.endsWith('~ott')) continue;
    assert.ok(r.platforms.length, `${r.id} is a streaming date that names no service`);
    assert.ok(!r.platforms.includes('theatres'), `${r.id} is a streaming date shown in cinemas`);
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

test('a real provider is never overwritten by a second pass', () => {
  // Title 1 comes back from the provider pass on Netflix *and* from the digital
  // pass. Whatever the second pass thinks, Netflix is the fact already held.
  const known = byId.get('m-1');
  assert.ok(known, 'the Netflix title vanished');
  assert.deepEqual(known.platforms, ['netflix'], `got ${known.platforms.join(', ')}`);
});

test('a cinema listing is not also "coming to streaming"', () => {
  /*
   * Title 2 is in cinemas this week and appears in the digital response too.
   *
   * Reported as "why the hell are these in cinemas - they are OTT release
   * man!" when the re-check attached a service *alongside* theatres and the
   * card wore a Netflix badge in the cinema rail. A film is in cinemas or it
   * is streaming; the two states are two rows, never one.
   */
  const cinema = byId.get('m-2');
  assert.ok(cinema, 'the theatrical title vanished');
  assert.deepEqual(cinema.platforms, ['theatres'], `got ${cinema.platforms.join(', ')}`);
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

test('a dropped title is named in the run report, not silently discarded', () => {
  /*
   * Dropping the unplaceable rows is only defensible if somebody can see what
   * was dropped: data/upcoming-ott.json is how these titles get listed, and a
   * hand file nobody knows to update is a hand file that stays empty.
   *
   * Titles 3 and 5 are the two the fixture cannot place.
   */
  assert.match(log, /digital row\(s\) came back without a subscription service and were dropped/);
  assert.match(log, /upcoming-ott\.json/);
  for (const t of ['Title 3', 'Title 5']) {
    assert.ok(log.includes(t), `${t} was dropped without being reported`);
  }
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

test('the platform written on the release date is read', () => {
  /*
   * Title 7 has a digital date, nobody carrying it, and no studio that means
   * anything — but "Prime Video" typed onto the release date itself.
   *
   * TMDB's per-country release dates each carry a free-text note, and it is the
   * only field on any endpoint that can name a service *before* the title is
   * available: a distributor types it in when the date is announced, rather
   * than a robot deriving it from availability on the day. The digital pass
   * asked discover for the date and watch/providers for the service and never
   * looked at the note sitting on the same record as the date, while dropping
   * 140 rows a run for having no service.
   */
  const noted = byId.get('m-7~ott');
  assert.ok(noted, 'a row the release note could place was dropped anyway');
  assert.deepEqual(noted.platforms, ['prime'], `got ${noted.platforms.join(', ')}`);
  assert.ok(
    calls.some((c) => /\/movie\/7\/release_dates$/.test(c.path)),
    'the release note was never read',
  );
});

test('a series starting this week arrives, named by its network', () => {
  /*
   * The hole the owner photographed: 4–10 September carried Netflix 13 and
   * Apple TV+ 4, and 11–17 September carried Netflix 1 with nothing beyond it.
   *
   * Series were most of the difference and had no route into a future week at
   * all. Every TV query went through discover with a monetization filter, which
   * is a filter on already having a provider, which is a filter on already
   * being out. A network is known from announcement — Silo is Apple TV+ months
   * before it airs — so this asks by first_air_date instead and reads it.
   */
  const show = byId.get('t-100');
  assert.ok(show, 'a series starting this week is missing from the feed');
  assert.deepEqual(show.platforms, ['appletv'], `got ${show.platforms.join(', ')}`);
  assert.equal(show.kind, 'series');
});

test('a series on a channel the site does not carry is dropped, not guessed', () => {
  // Series 101 airs the same week on a network with no registry entry. The
  // same rule as everywhere else: name a real service or do not ship the row.
  assert.ok(!byId.get('t-101'), 'a series was placed on a platform the site has no page for');
});

test('each source reports what it actually placed', () => {
  /*
   * I told the owner the studio lookup recovers about two rows in 142. It
   * recovered none, and that only surfaced because the run happened to print
   * enough to check by hand. A pass whose value nobody measures outlives its
   * usefulness silently, so every one of them counts out loud.
   */
  assert.match(log, /Named by: provider \d+, release note \d+, studio \d+, network \d+\./);
});

test('every platform in the registry can be named from free text', () => {
  /*
   * Three passes now read a platform out of free text — a release note, a TV
   * network, a production company — and each matches against an alias table.
   * A registry platform missing from that table is invisible to all three: its
   * titles name their service, match nothing, and are dropped exactly like
   * titles nobody can place.
   *
   * ZEE5 was missing from the first version and nothing would have said so.
   * The site would simply never have mentioned ZEE5 again.
   *
   * Asserted against the registry itself rather than a copied list, since a
   * copied list is the thing that went out of date.
   */
  const registry = readFileSync(join(ROOT, 'src/data/platforms.ts'), 'utf8');
  const ids = [...registry.matchAll(/\{\s*id:\s*'([^']+)'/g)].map((m) => m[1]);
  const src = readFileSync(join(ROOT, 'scripts/fetch-releases.mjs'), 'utf8');
  const table = src.slice(src.indexOf('const SERVICE_NAMES'), src.indexOf('assertEveryServiceNamed'));
  for (const id of ids) {
    if (id === 'theatres') continue; // Not a streaming service.
    assert.ok(table.includes(`'${id}'`), `SERVICE_NAMES has no pattern for ${id}`);
  }
});
