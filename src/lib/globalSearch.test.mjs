/**
 * The seam between the two corpora.
 *
 * One box searches two things — 963 rows already in the browser, and a million
 * more behind /api/search — and almost every way this can go wrong is a way of
 * blurring that line. The same film offered twice because one copy carries a
 * `~ott` suffix. TMDB timing out and taking the local results down with it. An
 * empty state that says "nothing matches" when what it searched was this site
 * alone, because the Worker has no TMDB credential bound yet.
 *
 * None of that is visible in a screenshot of a working search, which is why it
 * is pinned here.
 *
 * Run: npm run test:search
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

/* The source is TypeScript and this is plain node, so it is compiled once
   rather than duplicated here — a copy of the logic in a test only ever proves
   the copy works. */
const dir = mkdtempSync(join(tmpdir(), 'search-'));
execFileSync(
  'npx',
  [
    '--yes',
    'esbuild',
    'src/lib/globalSearch.ts',
    '--bundle',
    '--format=esm',
    `--outfile=${join(dir, 'globalSearch.mjs')}`,
  ],
  { stdio: 'pipe' },
);
const { PLACEHOLDER, withoutLocal, localMatches, askRemote, EMPTY } = await import(
  join(dir, 'globalSearch.mjs')
);

const row = (over = {}) => ({
  id: 'm-1',
  title: 'Kantara',
  kind: 'film',
  platforms: ['netflix'],
  languages: ['kn'],
  genres: ['Drama'],
  releaseDate: '2026-09-25',
  regions: ['IN'],
  cast: [],
  ...over,
});

const hit = (over = {}) => ({ kind: 'film', id: 'm-99', title: 'Some Film', ...over });

/* ------------------------------------------------------------------ copy -- */

test('the placeholder fits the narrowest phone', () => {
  // The field is about 200px wide at 360px once the icon and the clear button
  // have taken their padding. This is not a style preference: the copy that
  // was here before ran past it and truncated mid-word.
  assert.ok(PLACEHOLDER.length <= 20, PLACEHOLDER);
  assert.match(PLACEHOLDER, /1M\+/);
});

/* --------------------------------------------------------------- overlap -- */

test('a remote title the site already has is not offered a second time', () => {
  const kept = withoutLocal([hit({ id: 'm-1' }), hit({ id: 'm-2' })], [row({ id: 'm-1' })]);
  assert.deepEqual(kept.map((h) => h.id), ['m-2']);
});

test("a film's streaming row counts as the same film", () => {
  // The feed carries Kantara twice: `m-1` in cinemas and `m-1~ott` when the
  // streaming date lands. Without the suffix strip the reader is shown their
  // own site's film again under "Everywhere else", as though it were new.
  const kept = withoutLocal([hit({ id: 'm-1' })], [row({ id: 'm-1~ott' })]);
  assert.deepEqual(kept, []);
});

test('people always survive, because the site has no page for a person', () => {
  const people = withoutLocal([{ kind: 'person', id: 'p-1', name: 'Rajinikanth' }], [row({ id: 'p-1' })]);
  assert.equal(people.length, 1);
});

/* ----------------------------------------------------------------- local -- */

test('a title matches on any part of its name, in any case', () => {
  assert.equal(localMatches([row()], 'KANTA').length, 1);
  assert.equal(localMatches([row()], 'tara').length, 1);
});

test('an actor finds their films before the remote half has answered', () => {
  const rows = [row({ id: 'm-7', title: 'Jailer', cast: ['Rajinikanth', 'Mohanlal'] })];
  assert.deepEqual(localMatches(rows, 'rajini').map((r) => r.id), ['m-7']);
});

test('titles rank above cast, whatever order the feed is in', () => {
  const rows = [
    row({ id: 'm-1', title: 'Jailer', cast: ['Rajinikanth'] }),
    row({ id: 'm-2', title: 'Rajinikanth: The Man', cast: [] }),
  ];
  // The cast match comes first in the feed and must still come second on screen:
  // someone typing a name that is also a title means the title.
  assert.deepEqual(localMatches(rows, 'rajinikanth').map((r) => r.id), ['m-2', 'm-1']);
});

test('a name buried mid-word does not outrank the name itself', () => {
  // The bug this band scheme exists for: "raji" returned Apa*raji*to above
  // every Rajinikanth film in the feed, because both are substrings.
  const rows = [
    row({ id: 'm-1', title: 'Aparajito', cast: [] }),
    row({ id: 'm-2', title: 'Jailer', cast: ['Rajinikanth'] }),
    row({ id: 'm-3', title: 'Rajini Murugan', cast: [] }),
  ];
  assert.deepEqual(localMatches(rows, 'raji').map((r) => r.id), ['m-3', 'm-2', 'm-1']);
});

test('a word after a colon is still the start of a word', () => {
  const rows = [row({ id: 'm-1', title: 'Mirzapur: The Movie' })];
  assert.equal(localMatches(rows, 'the movie').length, 1);
});

test('a query with regex punctuation searches for that punctuation', () => {
  // "S.S. Rajamouli" and "(2024)" both reach this as typed.
  const rows = [row({ id: 'm-1', title: 'Jailer (2023)' })];
  assert.equal(localMatches(rows, '(2023)').length, 1);
  assert.equal(localMatches(rows, 'j..ler').length, 0);
});

test('a film with a streaming date is one result, not two', () => {
  const rows = [row({ id: 'm-1' }), row({ id: 'm-1~ott', releaseDate: '2026-11-01' })];
  assert.equal(localMatches(rows, 'kantara').length, 1);
});

test('one letter searches nothing', () => {
  // Every keystroke runs this over a thousand rows; "a" would match most of
  // them and answer nobody.
  assert.deepEqual(localMatches([row()], 'k'), []);
  assert.deepEqual(localMatches([row()], '  '), []);
});

test('the local half is capped, so the dropdown cannot become the board', () => {
  const rows = Array.from({ length: 40 }, (_, i) => row({ id: `m-${i}`, title: `Kantara ${i}` }));
  assert.equal(localMatches(rows, 'kantara').length, 6);
  assert.equal(localMatches(rows, 'kantara', 3).length, 3);
});

/* ---------------------------------------------------------------- remote -- */

const withFetch = async (impl, fn) => {
  const real = globalThis.fetch;
  globalThis.fetch = impl;
  try {
    return await fn();
  } finally {
    globalThis.fetch = real;
  }
};

test('a good answer comes back whole', async () => {
  const state = await withFetch(
    async () =>
      new Response(
        JSON.stringify({ remote: true, results: [hit({ id: 'm-5' })], total: 812 }),
        { status: 200 },
      ),
    () => askRemote('kantara'),
  );
  assert.equal(state.remote, true);
  assert.equal(state.total, 812);
  assert.deepEqual(state.hits.map((h) => h.id), ['m-5']);
});

test('the query is escaped rather than pasted into the URL', async () => {
  let asked = '';
  await withFetch(
    async (u) => {
      asked = String(u);
      return new Response('{}', { status: 200 });
    },
    () => askRemote('tumbbad & co'),
  );
  assert.ok(asked.includes('q=tumbbad%20%26%20co'), asked);
});

test('TMDB being down leaves the local results standing', async () => {
  // The alternative is an error message where the half that worked used to be.
  // The reader can do nothing about TMDB, and the row they wanted may well be
  // in the half they already have.
  const onThrow = await withFetch(async () => {
    throw new Error('network');
  }, () => askRemote('kantara'));
  assert.deepEqual(onThrow, EMPTY);

  const onError = await withFetch(
    async () => new Response('nope', { status: 502 }),
    () => askRemote('kantara'),
  );
  assert.deepEqual(onError, EMPTY);
});

test('a superseded keystroke aborts without throwing into the UI', async () => {
  const ac = new AbortController();
  ac.abort();
  const state = await withFetch(
    (_u, init) => {
      // Mirrors what a real fetch does with an already-aborted signal.
      const err = new Error('aborted');
      err.name = 'AbortError';
      init?.signal?.throwIfAborted?.();
      return Promise.reject(err);
    },
    () => askRemote('kantara', ac.signal),
  );
  assert.deepEqual(state, EMPTY);
});

test('a degraded answer is not the same as no credential', async () => {
  // `remote: true, degraded: true` is "we can search, TMDB blinked".
  // `remote: false` is "no credential, this was our rows only". The header no
  // longer distinguishes them — it is one line now — so the empty state is
  // what has to, and it reads these two flags to do it.
  const state = await withFetch(
    async () =>
      new Response(JSON.stringify({ remote: true, results: [], total: 0, degraded: true }), {
        status: 200,
      }),
    () => askRemote('kantara'),
  );
  assert.equal(state.remote, true);
  assert.equal(state.degraded, true);

  const noCredential = await withFetch(
    async () => new Response(JSON.stringify({ remote: false, results: [], total: 0 }), { status: 200 }),
    () => askRemote('kantara'),
  );
  assert.equal(noCredential.remote, false);
  assert.equal(noCredential.degraded, false);
});

test('a body missing its fields does not crash the dropdown', async () => {
  const state = await withFetch(
    async () => new Response('{}', { status: 200 }),
    () => askRemote('kantara'),
  );
  assert.deepEqual(state.hits, []);
  assert.equal(state.total, 0);
});
