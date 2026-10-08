/**
 * The platform registry, read once, for the scripts that need it.
 *
 * src/data/platforms.ts is the single source of truth and the build scripts
 * cannot import TypeScript, so each one grew its own regex over it:
 * fetch-releases.mjs for the TMDB ids, build-seo.mjs for names and regions,
 * and eval.mjs was about to grow a third.
 *
 * That mattered the moment a rule depended on the registry rather than just
 * reading it. 41 India title pages were naming HBO Max, Hulu or Paramount+ —
 * services with no Indian subscription — on pages whose job is to say where
 * to watch something. The fix filters those out at build time; the grader,
 * reading the unfiltered feed, then reported all 41 corrected pages as
 * contradicting their own data. Builder and grader disagreeing about one rule
 * is the failure that has cost the most time in this repo, and the cure each
 * time has been the same: one definition, imported.
 */

import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * id, name, regions and rank for every platform.
 *
 * Deliberately strict about shape: a row whose `regions` cannot be read would
 * otherwise be treated as serving nowhere and silently empty every page that
 * mentions it, which is a worse failure than stopping.
 */
export async function loadRegistry() {
  const src = await readFile(resolve(ROOT, 'src/data/platforms.ts'), 'utf8');
  const rows = [
    ...src.matchAll(
      /\{\s*id:\s*'([^']+)',\s*name:\s*'([^']+)'[\s\S]*?regions:\s*\[([^\]]*)\],\s*rank:\s*(\d)/g,
    ),
  ].map(([, id, name, regions, rank]) => ({
    id,
    name,
    regions: regions.split(',').map((x) => x.trim().replace(/'/g, '')).filter(Boolean),
    rank: Number(rank),
  }));
  if (!rows.length) throw new Error('platform registry parsed to nothing — has platforms.ts changed shape?');
  return rows;
}

/**
 * The services on a row a reader in this region could actually open, best
 * first.
 *
 * An id the registry does not know is kept rather than dropped: it is more
 * likely a platform added without this file noticing than a service that does
 * not exist, and dropping it would hide a real row. Ranked last of its kind,
 * for the same reason.
 */
export function platformsIn(ids, region, registry) {
  const by = new Map(registry.map((p) => [p.id, p]));
  return [...new Set(ids ?? [])]
    .filter((id) => !by.has(id) || by.get(id).regions.includes(region))
    .sort((a, b) => (by.get(a)?.rank ?? 2) - (by.get(b)?.rank ?? 2));
}

/** The row as this region should see it. */
export const inRegion = (row, region, registry) => ({
  ...row,
  platforms: platformsIn(row.platforms, region, registry),
});
