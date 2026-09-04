#!/usr/bin/env node
/**
 * Folds `npm run build` output into one self-contained HTML file: styles, script
 * and the release feed all inlined, no relative fetches, no asset directory.
 *
 * Useful for hosts that take a single page, for handing someone a file they can
 * open offline, and for previewing a build without running a server.
 *
 * Usage: npm run build && node scripts/build-single.mjs [outfile] [--fragment]
 *
 *   --fragment  emit only <title>/<style>/<body content>, for hosts that supply
 *               their own <!doctype>/<html>/<head> wrapper.
 */

import { readFile, writeFile, readdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BRAND, HEADLINE } from './brand.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = resolve(ROOT, 'dist');

const args = process.argv.slice(2);
const fragment = args.includes('--fragment');
const outFile = resolve(ROOT, args.find((a) => !a.startsWith('--')) ?? `dist/${BRAND}.html`);

const FONTS =
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Instrument+Serif:ital@1&display=swap';

/** A literal </script> inside inlined text would close the tag early. */
const safe = (text) => text.replace(/<\/script/gi, '<\\/script');

const assets = await readdir(resolve(DIST, 'assets')).catch(() => {
  throw new Error('No dist/assets — run `npm run build` first.');
});
const cssFile = assets.find((f) => f.endsWith('.css'));
const jsFile = assets.find((f) => f.endsWith('.js'));
if (!cssFile || !jsFile) throw new Error('Build output is missing a CSS or JS bundle.');

const [css, js, feed] = await Promise.all([
  readFile(resolve(DIST, 'assets', cssFile), 'utf8'),
  readFile(resolve(DIST, 'assets', jsFile), 'utf8'),
  readFile(resolve(ROOT, 'public/data/releases.json'), 'utf8'),
]);

const title = fragment ? BRAND : `${BRAND} — ${HEADLINE}`;

const head = `<title>${title}</title>
<link rel="stylesheet" href="${FONTS}" />
<style>
${css}
</style>`;

const body = `<div id="root"></div>

<script id="release-feed" type="application/json">
${safe(feed)}
</script>

<script type="module">
${safe(js)}
</script>`;

const page = fragment
  ? `${head}\n\n${body}\n`
  : `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="theme-color" content="#06070a" />
<meta name="description" content="Every film, series and show landing this week across Netflix, Prime Video, JioHotstar, Apple TV+, theatres and more. One page. No login." />
${head}
</head>
<body>
${body}
</body>
</html>
`;

await writeFile(outFile, page);
console.log(
  `Wrote ${outFile} (${(Buffer.byteLength(page) / 1024).toFixed(0)} KB, ${fragment ? 'fragment' : 'standalone'}).`,
);
