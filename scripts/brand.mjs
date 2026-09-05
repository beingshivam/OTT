/**
 * The brand strings, read out of the app's own source.
 *
 * The build scripts write the name into the page title, the OG tags, the
 * JSON-LD and the social card, so if they carried their own copy the site would
 * say one thing and its metadata another — which is exactly what happened the
 * last two times the site was renamed. Parsed rather than imported because
 * these are .ts files and the scripts run under plain node.
 */

import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const source = await readFile(resolve(ROOT, 'src/data/brand.ts'), 'utf8');

const read = (name) => {
  const match = source.match(new RegExp(`export const ${name}\\s*=\\s*'([^']*)'`));
  if (!match) throw new Error(`src/data/brand.ts no longer exports ${name}.`);
  return match[1];
};

export const BRAND = read('BRAND');
export const SLUG = read('SLUG');
export const TAGLINE = read('TAGLINE');
export const HEADLINE = read('HEADLINE');
export const INSTAGRAM = read('INSTAGRAM');
/** Built here rather than parsed: INSTAGRAM_URL is a template literal in the
 *  .ts file, so the single-quote pattern above cannot read it. */
export const INSTAGRAM_URL = `https://www.instagram.com/${INSTAGRAM}/`;
