#!/usr/bin/env node
/**
 * Post-build SEO pass over dist/index.html.
 *
 * The app is client-rendered, so a crawler that does not execute JavaScript sees
 * an empty <div id="root"> — no titles, no platforms, no dates. Google can run
 * JS but does it slowly and unreliably, and the crawlers behind WhatsApp,
 * Telegram, Slack, X and Bing largely do not run it at all. For a site whose
 * entire value is its content, shipping none of it in the HTML is the single
 * biggest thing holding search back, and no domain name compensates for it.
 *
 * So this injects, from the feed that is already on disk at build time:
 *   - a title and description naming the actual week, not just the brand
 *   - the week's releases as real markup inside #root, which React replaces on
 *     mount, so JS and non-JS readers get the same content
 *   - JSON-LD describing the site and the week as an ItemList
 *   - a canonical URL and an OG image
 *
 * Usage: runs automatically as part of `npm run build`.
 *        SITE_URL=https://example.com npm run build   to pin the canonical host.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HTML = resolve(ROOT, 'dist/index.html');
const FEED = resolve(ROOT, 'dist/data/releases.json');

const SITE_URL = (process.env.SITE_URL ?? 'https://firstday.newreleases.workers.dev').replace(/\/$/, '');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function formatRange(weekId) {
  const a = new Date(`${weekId}T00:00:00Z`);
  const b = new Date(a.getTime() + 6 * 86_400_000);
  const left = a.getUTCMonth() === b.getUTCMonth()
    ? String(a.getUTCDate())
    : `${a.getUTCDate()} ${MONTHS[a.getUTCMonth()]}`;
  return `${left}–${b.getUTCDate()} ${MONTHS[b.getUTCMonth()]} ${b.getUTCFullYear()}`;
}

const html = await readFile(HTML, 'utf8');
const feed = JSON.parse(await readFile(FEED, 'utf8'));

/**
 * Human names, not ids. "Netflix" and "Hindi" are what people actually search
 * for; "netflix" and "hi" are internal keys and carry no search value at all.
 * Both tables are read from the app's own source so they cannot drift.
 */
const registry = await readFile(resolve(ROOT, 'src/data/platforms.ts'), 'utf8');
const platformName = new Map(
  [...registry.matchAll(/\{\s*id:\s*'([^']+)',\s*name:\s*'([^']+)'/g)].map(([, id, name]) => [id, name]),
);
const languageName = new Map(
  [...(registry.match(/LANGUAGES[^{]*\{([\s\S]*?)\n\};/) ?? ['', ''])[1].matchAll(/(\w+):\s*'([^']+)'/g)].map(
    ([, code, name]) => [code, name],
  ),
);
const KIND = { film: 'Film', series: 'Series', documentary: 'Documentary', reality: 'Reality', anime: 'Anime', special: 'Special' };
const pname = (id) => platformName.get(id) ?? id;
const lname = (code) => languageName.get(code) ?? code.toUpperCase();

// The week a visitor actually lands on: today's if stocked, else the nearest.
const DAY = 86_400_000;
const now = new Date();
const base = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
const currentWeek = new Date(base.getTime() - ((base.getUTCDay() + 2) % 7) * DAY)
  .toISOString()
  .slice(0, 10);

const stocked = feed.weeks.filter((w) => w.releases.length);
const week =
  stocked.find((w) => w.id === currentWeek) ??
  stocked.reduce(
    (best, w) =>
      Math.abs(Date.parse(w.id) - Date.parse(currentWeek)) <
      Math.abs(Date.parse(best.id) - Date.parse(currentWeek))
        ? w
        : best,
    stocked[0],
  );

if (!week) {
  console.log('No stocked week in the feed — leaving the HTML unchanged.');
  process.exit(0);
}

const range = formatRange(week.id);
const rows = week.releases.filter((r) => r.regions.includes('IN'));
const platforms = [...new Set(rows.flatMap((r) => r.platforms))];

// Lead with what people search for — "new releases this week", "OTT" — and keep
// the brand at the end where a title tag usually carries it.
const title = `New releases this week (${range}) — OTT & theatres | firstday`;
const topPlatforms = [...new Set(rows.flatMap((r) => r.platforms))].map(pname).slice(0, 5);
const description =
  `Every new film, series and show released this week — ${range}. ` +
  `${rows.length} releases across ${platforms.length} platforms including ` +
  `${topPlatforms.join(', ')}. Updated twice a week. No login.`;

// --- content for crawlers that do not run JS -------------------------------
const byPlatform = new Map();
for (const r of rows) {
  for (const id of r.platforms) {
    if (!byPlatform.has(id)) byPlatform.set(id, []);
    byPlatform.get(id).push(r);
  }
}

const sections = [...byPlatform.entries()]
  .sort((a, b) => b[1].length - a[1].length)
  .map(([id, list]) => {
    const items = list
      .map(
        (r) =>
          `<li>${esc(r.title)} — ${esc(KIND[r.kind] ?? r.kind)}` +
          `${r.languages?.length ? ` · ${esc(r.languages.map(lname).join(', '))}` : ''}` +
          `${r.genres?.length ? ` · ${esc(r.genres.slice(0, 2).join(', '))}` : ''}</li>`,
      )
      .join('');
    return `<section><h2>${esc(pname(id))}</h2><ul>${items}</ul></section>`;
  })
  .join('');

/**
 * React replaces this on mount, but on a slow connection it is on screen for a
 * moment first — so it gets enough styling to read as the page loading rather
 * than as a broken one. Deliberately visible, not hidden: text a crawler can see
 * and a visitor cannot is cloaking, and it is the honest version that ranks.
 */
const prerendered =
  `<main class="seo-fallback"><h1>New releases this week — ${esc(range)}</h1>` +
  `<p>${esc(rows.length)} releases across ${esc(platforms.length)} platforms.</p>` +
  sections +
  `</main>`;

// --- structured data --------------------------------------------------------
const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'WebSite',
      name: 'firstday',
      url: `${SITE_URL}/`,
      description: 'Every new release, every platform, one page.',
    },
    {
      '@type': 'ItemList',
      name: `New releases ${range}`,
      numberOfItems: rows.length,
      itemListElement: rows.slice(0, 50).map((r, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        item: {
          '@type': r.kind === 'series' ? 'TVSeries' : 'Movie',
          name: r.title,
          datePublished: r.releaseDate,
          ...(r.genres?.length ? { genre: r.genres } : {}),
          ...(r.posterUrl ? { image: r.posterUrl } : {}),
          ...(r.synopsis ? { description: r.synopsis } : {}),
        },
      })),
    },
  ],
};

let out = html
  .replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(title)}</title>`)
  .replace(/<meta\s+name="description"[\s\S]*?\/>/, `<meta name="description" content="${esc(description)}" />`)
  .replace(/<meta\s+property="og:title"[\s\S]*?\/>/, `<meta property="og:title" content="${esc(title)}" />`)
  .replace(/<meta\s+property="og:description"[\s\S]*?\/>/, `<meta property="og:description" content="${esc(description)}" />`);

const head = `    <link rel="canonical" href="${SITE_URL}/" />
    <meta property="og:url" content="${SITE_URL}/" />
    <meta property="og:site_name" content="firstday" />
    <meta property="og:image" content="${SITE_URL}/og.png" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta name="twitter:image" content="${SITE_URL}/og.png" />
    <style>
      .seo-fallback { max-width: 1180px; margin: 0 auto; padding: 32px 20px; color: #8d94a4; }
      .seo-fallback h1 { color: #f2f4f9; font-size: 28px; margin: 0 0 4px; }
      .seo-fallback h2 { color: #b6bdcc; font-size: 15px; margin: 24px 0 6px; }
      .seo-fallback ul { margin: 0; padding-left: 18px; line-height: 1.7; }
    </style>
    <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
`;
out = out.replace('</head>', `${head}  </head>`);
out = out.replace('<div id="root"></div>', `<div id="root">${prerendered}</div>`);

await writeFile(HTML, out);

// A sitemap that lists the weeks actually carried, not just the root.
const urls = [`${SITE_URL}/`, ...feed.weeks.filter((w) => w.releases.length).map((w) => `${SITE_URL}/?w=${w.id}`)];
const sitemap =
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
  urls
    .map((u) => `  <url><loc>${esc(u)}</loc><lastmod>${feed.generatedAt.slice(0, 10)}</lastmod><changefreq>weekly</changefreq></url>`)
    .join('\n') +
  `\n</urlset>\n`;
await writeFile(resolve(ROOT, 'dist/sitemap.xml'), sitemap);

await writeFile(
  resolve(ROOT, 'dist/robots.txt'),
  `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`,
);

console.log(
  `SEO: titled "${title}"\n     prerendered ${rows.length} releases across ${byPlatform.size} platforms\n     sitemap with ${urls.length} urls, robots.txt, JSON-LD`,
);
