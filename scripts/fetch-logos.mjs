#!/usr/bin/env node
/**
 * Writes public/data/logos.json — a map of our platform ids to real provider
 * logo URLs on TMDB's image CDN.
 *
 * TMDB's watch-provider list is the only source that carries the Indian
 * services (JioHotstar, SonyLIV, Sun NXT, hoichoi, aha, Simply South) alongside
 * the global ones. Icon sets like Simple Icons cover the American platforms and
 * stop there, which would leave the board half-branded — worse than a
 * consistent monogram system.
 *
 * Usage: TMDB_TOKEN=... node scripts/fetch-logos.mjs
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'public/data/logos.json');
const API = 'https://api.themoviedb.org/3';
const IMG = 'https://image.tmdb.org/t/p/w154';

const TOKEN = process.env.TMDB_TOKEN || process.env.TMDB_API_KEY;
if (!TOKEN) {
  console.error(
    'No TMDB credential found (set TMDB_TOKEN or TMDB_API_KEY).\n' +
      'Either the v4 API Read Access Token or the v3 API Key works.\n' +
      'The existing logos file has been left untouched.',
  );
  process.exit(1);
}

const IS_JWT = /^ey[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(TOKEN);

async function tmdb(path, params = {}) {
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  if (!IS_JWT) url.searchParams.set('api_key', TOKEN);

  const res = await fetch(url, {
    headers: IS_JWT
      ? { Authorization: `Bearer ${TOKEN}`, accept: 'application/json' }
      : { accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`TMDB ${res.status} ${res.statusText} for ${url.pathname}`);
  return res.json();
}

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
for (const region of ['IN', 'US']) {
  for (const kind of ['movie', 'tv']) {
    const { results = [] } = await tmdb(`/watch/providers/${kind}`, { watch_region: region });
    for (const p of results) {
      if (p.logo_path && !providers.has(p.provider_id)) providers.set(p.provider_id, p.logo_path);
    }
  }
}
console.log(`TMDB returned logos for ${providers.size} providers.`);

const logos = {};
const missing = [];
for (const { id, tmdb: ids } of platforms) {
  const hit = ids.find((n) => providers.has(n));
  if (hit) logos[id] = `${IMG}${providers.get(hit)}`;
  else missing.push(id);
}

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(logos, null, 2) + '\n');

console.log(`Wrote ${Object.keys(logos).length} logos to ${OUT}.`);
if (missing.length) {
  // Theatres has no provider by design; anything else here keeps its monogram.
  console.log(`No provider logo for: ${missing.join(', ')} — these keep the monogram lockup.`);
}
