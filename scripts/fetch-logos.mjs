#!/usr/bin/env node
/**
 * Writes public/data/logos.json — a map of our platform ids to real provider
 * logo URLs on TMDB's image CDN.
 *
 * TMDB's watch-provider list is the only source that carries the Indian
 * services (JioHotstar, ZEE5, SonyLIV, Sun NXT, hoichoi, aha) alongside
 * the global ones. Icon sets like Simple Icons cover the American platforms and
 * stop there, which would leave the board half-branded — worse than a
 * consistent monogram system.
 *
 * Usage: npm run logos   (reads .env)
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { callCount, requireToken, tmdb } from './tmdb.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const OUT = resolve(ROOT, 'public/data/logos.json');
const API = 'https://api.themoviedb.org/3';
const IMG = 'https://image.tmdb.org/t/p/w154';

requireToken();


/** Parse the registry rather than duplicating it — one source of truth. */
const src = await readFile(resolve(ROOT, 'src/data/platforms.ts'), 'utf8');
const platforms = [
  ...src.matchAll(/\{\s*id:\s*'([^']+)'[\s\S]*?tmdb:\s*\[([^\]]*)\]/g),
].map(([, id, tmdbIds]) => ({
  id,
  tmdb: tmdbIds.split(',').map((n) => Number(n.trim())).filter(Number.isFinite),
}));

// One call per region per media type covers every provider we care about.
const providers = new Map();
const failed = [];
for (const region of ['IN', 'US']) {
  for (const kind of ['movie', 'tv']) {
    let results;
    try {
      ({ results = [] } = await tmdb(`/watch/providers/${kind}`, { watch_region: region }));
    } catch (err) {
      // Keep going: the other three lists usually cover the same providers, and
      // writing most of the logos beats losing the pass to one dropped socket.
      failed.push(`${kind}/${region}`);
      console.warn(`  ! ${kind}/${region} list unavailable: ${err.message}`);
      continue;
    }
    for (const p of results) {
      if (p.logo_path && !providers.has(p.provider_id)) providers.set(p.provider_id, p.logo_path);
    }
  }
}

if (!providers.size) {
  console.error('No provider lists could be fetched — leaving the existing logos untouched.');
  process.exit(1);
}
console.log(`TMDB returned logos for ${providers.size} providers.`);

const logos = {};
const missing = [];
/**
 * A platform that lists provider ids but matches none of the live ones has gone
 * stale — the service rebranded and TMDB issued a new id. That is worth calling
 * out separately from Theatres, which has no provider by design: a stale entry
 * silently matches nothing in discover, so the platform looks like a quiet week
 * rather than a broken mapping. JioHotstar sat like that behind a one-line log
 * message, showing a single title, until someone went looking.
 */
const stale = [];
for (const { id, tmdb: ids } of platforms) {
  const hit = ids.find((n) => providers.has(n));
  if (hit) logos[id] = `${IMG}${providers.get(hit)}`;
  else if (ids.length) stale.push(id);
  else missing.push(id);
}

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(logos, null, 2) + '\n');

console.log(`Wrote ${Object.keys(logos).length} logos to ${OUT}.`);
if (missing.length) {
  // No provider ids at all — Theatres, by design. Keeps the monogram lockup.
  console.log(`No provider to look up for: ${missing.join(', ')} — these keep the monogram lockup.`);
}

if (stale.length) {
  const list = stale.join(', ');
  // ::warning is a no-op locally and a highlighted annotation on the Actions run
  // summary, which is the only place anyone would notice this unattended.
  console.log(
    `::warning title=Stale provider ids::${list} — every TMDB provider id in the registry for ` +
      `${stale.length === 1 ? 'this platform is' : 'these platforms are'} dead, so ` +
      `${stale.length === 1 ? 'it matches' : 'they match'} nothing in discover and ` +
      `${stale.length === 1 ? 'shows' : 'show'} no logo. The service has probably rebranded. ` +
      `Run: npm run providers -- ${stale.join(' ')}`,
  );
}
