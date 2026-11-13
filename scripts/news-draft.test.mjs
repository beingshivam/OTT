/**
 * The newsroom's one promise: an article goes live only when its date is
 * verified, and never when it is withdrawn, stale, or over the daily cap.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = new URL('..', import.meta.url).pathname;

const film = (id, over = {}) => ({
  id, title: `Film ${id}`, kind: 'film', platforms: ['theatres'], languages: ['ta'], origin: ['IN'],
  releaseDate: '2026-10-01', heat: 30, slug: `film-${id}`, cast: ['A', 'B'], ...over,
});
const arrival = (id, over = {}) => ({
  id: `${id}~ott`, title: `Film ${id}`, platforms: ['prime'], releaseDate: '2026-11-12', firstSeen: '2026-11-11', heat: 30, ...over,
});

function run(titles, today, news = null, env = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'news-'));
  const archive = join(dir, 'archive.json');
  const newsDir = join(dir, 'news');
  writeFileSync(archive, JSON.stringify({ titles }));
  if (news) {
    execFileSync('mkdir', ['-p', newsDir]);
    for (const a of news) writeFileSync(join(newsDir, `${a.slug}.json`), JSON.stringify(a));
  }
  execFileSync(process.execPath, ['scripts/news-draft.mjs'], {
    cwd: ROOT, encoding: 'utf8', env: { ...process.env, ARCHIVE_IN: archive, NEWS_DIR: newsDir, TODAY: today, ...env },
  });
  const out = {};
  let entries = [];
  try {
    entries = readdirSync(newsDir, { withFileTypes: true });
  } catch {
    /* Nothing drafted, so no folder. */
  }
  for (const f of entries.filter((e) => e.isFile())) {
    const a = JSON.parse(readFileSync(join(newsDir, f.name), 'utf8'));
    out[a.slug] = a;
  }
  rmSync(dir, { recursive: true, force: true });
  return out;
}

/* Five earlier Tamil films, 28 days each, so the language has a measured
   window to compare against — the rule needs five before it claims one. */
const history = ['h1', 'h2', 'h3', 'h4', 'h5'].flatMap((id) => [
  film(id, { releaseDate: '2026-08-01', heat: 1 }),
  arrival(id, { releaseDate: '2026-08-29', firstSeen: '2026-08-20', heat: 1 }),
]);

test('a provider-confirmed date publishes on the day it is drafted', () => {
  const out = run([...history, film('m-1'), arrival('m-1')], '2026-11-11');
  const a = Object.values(out)[0];
  assert.equal(a.status, 'published');
  assert.match(a.headline, /Film m-1 OTT release date: streaming on Prime Video from 12 November/);
  assert.match(a.paragraphs.join(' '), /42 days after .* 14 days slower than the typical 28 days for Tamil films, based on 5 recent/,
    'the gap comparison — the reason to read it — is missing or wrong');
  assert.ok(!a.paragraphs.some((p) => /^starring/.test(p)), 'a sentence opened in lowercase');
});

test('an announced date waits until it arrives, then publishes in the present tense', () => {
  const rows = [film('m-2'), arrival('m-2', { namedBy: 'note' })];
  let out = run(rows, '2026-11-11');
  const slug = Object.keys(out)[0];
  assert.equal(out[slug].status, 'draft', 'an unconfirmed future date went live');
  out = run(rows, '2026-11-12', Object.values(out));
  assert.equal(out[slug].status, 'published');
  assert.match(out[slug].headline, /is now streaming on Prime Video/, 'published in the wrong tense');
});

test('a withdrawn or stale date never publishes', () => {
  const draft = (id, platform = 'prime') => ({
    slug: `film-${id}-ott-release-date-prime-video`, status: 'draft', titleId: id, platform, headline: 'x', paragraphs: [],
    createdAt: '2026-11-01T00:00:00Z',
  });
  const out = run(
    [film('m-3'), film('m-4'), arrival('m-4', { releaseDate: '2026-10-20', firstSeen: '2026-10-18' })],
    '2026-11-13',
    [draft('m-3'), draft('m-4')],
  );
  assert.equal(out['film-m-3-ott-release-date-prime-video'].status, 'withdrawn');
  assert.equal(out['film-m-4-ott-release-date-prime-video'].status, 'expired');
});

test('no more than the daily cap goes out', () => {
  const rows = ['a', 'b', 'c', 'd', 'e'].flatMap((x) => [film(`m-${x}`), arrival(`m-${x}`)]);
  const out = run(rows, '2026-11-11', null, { NEWS_PER_DAY: '2' });
  const statuses = Object.values(out).map((a) => a.status).sort();
  assert.deepEqual(statuses, ['draft', 'draft', 'draft', 'published', 'published']);
});

test('an import or a title nobody looks at is not news', () => {
  const out = run(
    [film('m-5', { origin: ['US'], languages: ['en'] }), arrival('m-5'), film('m-6', { heat: 2 }), arrival('m-6', { heat: 2 })],
    '2026-11-11',
  );
  assert.equal(Object.keys(out).length, 0);
});
