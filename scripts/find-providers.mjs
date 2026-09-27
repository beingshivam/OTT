#!/usr/bin/env node
/**
 * Looks up TMDB watch-provider ids by name.
 *
 * The registry pins each platform to provider ids, and those ids go stale:
 * services rebrand and merge — Disney+ Hotstar became JioHotstar — and TMDB
 * issues a new id rather than editing the old one. When that happens the
 * platform silently loses its logo and stops matching in discover, with nothing
 * in the output to say why.
 *
 * This turns that into one command:
 *   npm run providers -- hotstar
 *
 * It reports every provider whose name matches, which region lists it appears
 * in, and whether the registry already claims it.
 *
 * Usage: npm run providers -- <search term> [more terms...]
 */

import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { callCount, requireToken, tmdb } from './tmdb.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

requireToken();

const terms = process.argv.slice(2).filter((a) => !a.startsWith('--'));
/**
 * With no search term: every provider the region has, and whether we carry it.
 *
 * Searching by name answers "did this one move", which is the question when a
 * service rebrands. It cannot answer "what are we not carrying at all", and
 * that turned out to be the more expensive question.
 *
 * The catalogue fetch asks TMDB's discover with `with_watch_providers` set to
 * the registry's sixteen Indian ids, so a title streaming only on a service
 * the registry has never heard of is invisible to this site — it is not
 * ranked low, it does not exist. Tamil returned 112 titles and Telugu 63
 * against Japanese 172, which is backwards for an Indian OTT site, and the
 * floors were not the cause: the popular pass already reaches down to twelve
 * votes for Tamil. Missing platforms would explain it, and the regional South
 * Indian and Punjabi services are exactly the ones a registry built around
 * the national players would omit.
 *
 * So this lists the lot, marks what the registry claims, and lets the gap be
 * read rather than guessed at from a list of names somebody remembered.
 */
const LIST_ALL = process.argv.slice(2).includes('--all');
if (!terms.length && !LIST_ALL) {
  console.error(
    'Usage: npm run providers -- <search term>\n' +
      '  e.g. npm run providers -- hotstar zee\n' +
      '       npm run providers -- --all      (every provider in the region)',
  );
  process.exit(1);
}

const REGIONS = (process.env.REGIONS ?? 'IN,US').split(',').map((r) => r.trim()).filter(Boolean);

/** Which ids the registry already claims, so the output says what is new. */
const src = await readFile(resolve(ROOT, 'src/data/platforms.ts'), 'utf8');
const claimed = new Map();
for (const [, id, ids] of src.matchAll(/\{\s*id:\s*'([^']+)'[\s\S]*?tmdb:\s*\[([^\]]*)\]/g)) {
  for (const n of ids.split(',').map((x) => Number(x.trim())).filter(Number.isFinite)) {
    claimed.set(n, id);
  }
}

const found = new Map();
const skipped = [];
for (const region of REGIONS) {
  for (const kind of ['movie', 'tv']) {
    // One flaky call should narrow the answer, not destroy it.
    let results;
    try {
      ({ results = [] } = await tmdb(`/watch/providers/${kind}`, { watch_region: region }));
    } catch (err) {
      skipped.push(`${kind}/${region}: ${err.message}`);
      continue;
    }
    for (const p of results) {
      const entry = found.get(p.provider_id) ?? {
        // A provider without a name would otherwise take the whole lookup down.
        name: p.provider_name ?? '(unnamed)',
        logo: Boolean(p.logo_path),
        regions: new Set(),
      };
      entry.regions.add(region);
      found.set(p.provider_id, entry);
    }
  }
}

if (!found.size) {
  console.error('Could not reach TMDB at all:\n  ' + skipped.join('\n  '));
  process.exit(1);
}
console.log(`Searched ${found.size} providers across ${REGIONS.join(', ')}.`);
if (skipped.length) console.log(`(incomplete — ${skipped.length} list(s) failed: ${skipped.join('; ')})`);
console.log('');

if (LIST_ALL) {
  /* Carried first so the gap is the tail of the list rather than scattered
     through it, and alphabetical inside each half so a name is findable. */
  const rows = [...found.entries()].map(([id, e]) => ({
    id,
    name: e.name,
    regions: [...e.regions].sort().join(','),
    mine: claimed.get(id) ?? null,
  }));
  const ours = rows.filter((r) => r.mine).sort((a, b) => a.name.localeCompare(b.name));
  const theirs = rows.filter((r) => !r.mine).sort((a, b) => a.name.localeCompare(b.name));

  console.log(`Carried by the registry (${ours.length}):`);
  for (const r of ours) console.log(`  ${String(r.id).padStart(5)}  ${r.name.padEnd(34)} ${r.regions.padEnd(6)} → ${r.mine}`);
  console.log(`\nNot carried (${theirs.length}) — a title only on one of these is invisible to the fetch:`);
  for (const r of theirs) console.log(`  ${String(r.id).padStart(5)}  ${r.name.padEnd(34)} ${r.regions}`);
  console.log('');
}

for (const term of terms) {
  const needle = term.toLowerCase();
  const hits = [...found.entries()]
    .filter(([, v]) => v.name.toLowerCase().includes(needle))
    .sort((a, b) => a[1].name.localeCompare(b[1].name));

  console.log(`"${term}" — ${hits.length} match${hits.length === 1 ? '' : 'es'}`);
  if (!hits.length) console.log('   (nothing; try a shorter term)');

  for (const [id, v] of hits) {
    const owner = claimed.get(id);
    const mark = owner ? `already mapped to "${owner}"` : 'NOT in the registry';
    console.log(
      `   ${String(id).padStart(6)}  ${v.name.padEnd(34)} ${[...v.regions].join('/')}  ` +
        `${v.logo ? 'logo' : 'no logo'}  — ${mark}`,
    );
  }
  console.log('');
}

console.log(`${callCount()} API calls.`);
