/**
 * The outbound wrapper.
 *
 * Small enough to look obviously correct and worth testing anyway, because
 * both ways it can fail are silent. A template that stops being applied earns
 * nothing and nobody notices for a month; a destination that is not encoded
 * sends readers to a truncated redirect, and the site's own links look broken
 * to the one audience it cannot afford to lose. Neither shows up on screen.
 *
 * Run: npm run test:affiliates
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'aff-'));
execFileSync(
  'npx',
  [
    '--yes',
    'esbuild',
    'src/data/affiliates.ts',
    '--bundle',
    '--format=esm',
    `--outfile=${join(dir, 'affiliates.mjs')}`,
  ],
  { stdio: 'pipe' },
);
const { outbound, AFFILIATES } = await import(join(dir, 'affiliates.mjs'));

const BMS = 'https://in.bookmyshow.com/explore/movies?q=Mirzapur%3A%20The%20Movie';

test('an unenrolled platform is left completely alone', () => {
  const link = outbound('theatres', BMS);
  assert.equal(link.href, BMS, 'the URL was rewritten with no programme behind it');
  assert.equal(link.sponsored, false);
});

test('a platform with no programme at all is left alone', () => {
  // Netflix runs no affiliate programme anywhere, so there is nothing to wrap.
  const link = outbound('netflix', 'https://www.netflix.com/search?q=x');
  assert.equal(link.href, 'https://www.netflix.com/search?q=x');
  assert.equal(link.sponsored, false);
});

test('an unknown platform id cannot throw', () => {
  const link = outbound('not-a-platform', 'https://example.com/');
  assert.equal(link.href, 'https://example.com/');
  assert.equal(link.sponsored, false);
});

/**
 * The enrolled path, exercised against a stand-in template rather than a real
 * one — the real template is a value pasted in later, and a test that only
 * passes once someone has signed up is a test that never runs.
 */
function withTemplate(id, template, fn) {
  const before = AFFILIATES[id].template;
  AFFILIATES[id].template = template;
  try {
    fn();
  } finally {
    AFFILIATES[id].template = before;
  }
}

test('an enrolled platform is wrapped and flagged sponsored', () => {
  withTemplate('theatres', 'https://linksredirect.com/?cid=123&source=linkkit&url={url}', () => {
    const link = outbound('theatres', BMS);
    assert.ok(link.href.startsWith('https://linksredirect.com/?cid=123'));
    assert.equal(link.sponsored, true, 'a paid link must be marked, or rel="sponsored" is missed');
  });
});

test('the destination is URL-encoded into the template', () => {
  withTemplate('theatres', 'https://n.example/?url={url}', () => {
    const link = outbound('theatres', BMS);
    // Unencoded, the destination's own ?q= would terminate the network's query
    // string and the redirect would arrive without a title to search for.
    assert.ok(!link.href.includes('?q='), 'destination query string leaked into the wrapper');
    assert.ok(link.href.includes(encodeURIComponent(BMS)));
    // And it has to survive the round trip.
    assert.equal(decodeURIComponent(link.href.split('url=')[1]), BMS);
  });
});

test('every key in the table names a real platform', () => {
  const platforms = readFileSync('src/data/platforms.ts', 'utf8');
  for (const id of Object.keys(AFFILIATES)) {
    assert.ok(
      platforms.includes(`id: '${id}'`),
      `affiliates.ts has "${id}", which is not a platform — its links would never be wrapped`,
    );
  }
});

test('no template is a half-filled placeholder', () => {
  // A template carrying the network's example id, or missing {url} entirely,
  // is worse than an empty one: it renders a live link that goes nowhere useful
  // and earns nothing.
  for (const [id, p] of Object.entries(AFFILIATES)) {
    if (!p.template) continue;
    assert.ok(p.template.includes('{url}'), `${id}: template has no {url} placeholder`);
    assert.ok(
      !/cid=(00000|XXXX|YOUR)/i.test(p.template),
      `${id}: template still contains a placeholder id`,
    );
    assert.ok(p.network, `${id}: an earning programme must name its network for the disclosure`);
  }
});
