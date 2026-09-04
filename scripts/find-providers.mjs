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
if (!terms.length) {
  console.error('Usage: npm run providers -- <search term>\n  e.g. npm run providers -- hotstar zee');
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
