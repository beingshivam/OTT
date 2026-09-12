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

import { execSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BRAND, HEADLINE, INSTAGRAM_URL } from './brand.mjs';

/** Kept beside the app's own wording in App.tsx — one sentence, two places,
 *  and they have to agree. */
const TAGLINE_LONG =
  "Everything releasing this week — tap any title to see where it's streaming and open it there. Nothing plays on this page.";
import { slugify } from './slug.mjs';
import { ANALYTICS_TOKEN } from './config.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HTML = resolve(ROOT, 'dist/index.html');
const FEED = resolve(ROOT, 'dist/data/releases.json');

/**
 * The canonical home of the site.
 *
 * This is now a domain we own, so it is stated rather than derived from the
 * Worker's name and account subdomain. Every canonical, sitemap entry and OG
 * tag points here, and the hosts that used to serve the same content beside it
 * have been switched off rather than left to canonical their way out of
 * trouble: the workers.dev production and preview URLs, a GitHub Pages copy on
 * a personal domain, and www, which now 301s here. Two hosts serving identical
 * content is how a site competes against itself, and a canonical tag is a hint
 * rather than a guarantee.
 *
 * SITE_URL in the environment still wins, for previews and branch deploys.
 */
const SITE_URL = (process.env.SITE_URL ?? 'https://newonott.in').replace(/\/$/, '');

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

/** One date, spelled out. Title tags and descriptions are read by people, and
 *  "2026-09-18" in a search result reads like a database row. */
function formatDate(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/**
 * Every page below is this file with a different head and body, so anything
 * done to it here reaches all 129 of them.
 *
 * The one edit: Vite stamps `crossorigin` on the stylesheet and the module it
 * emits. Both are same-origin, where the attribute changes nothing — the CORS
 * check does not apply to a request that never leaves the origin. It changes
 * something only when a middlebox puts itself in the path and answers a
 * sub-resource from somewhere else: an inspection proxy that redirects an asset
 * to its own notification host turns a plain request into a cross-origin one,
 * and `crossorigin` is what makes the browser refuse the result rather than
 * follow it. That fails the stylesheet and the bundle together while leaving
 * the page itself alone, which is the shape of the failure reported from a
 * corporate laptop — the prerendered text, unstyled, on white.
 *
 * This is a hypothesis, not a diagnosis: it cannot be reproduced from here, and
 * public/diag.html tests it directly on the machine that has the problem.
 * Dropping the attribute is worth doing either way, because on this site it
 * buys nothing. It exists so a browser can report full error detail for
 * cross-origin scripts and so SRI can be checked; there is no SRI here and no
 * cross-origin script.
 */
const html = (await readFile(HTML, 'utf8')).replace(
  /(<(?:script|link)\b[^>]*?)\s+crossorigin(?:="[^"]*")?/g,
  '$1',
);
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
/** The full rows, not just names: the per-platform pages need to know which
 *  regions a platform serves so an India page never links to a US-only one. */
const PLATFORM_ROWS = [
  ...registry.matchAll(/\{\s*id:\s*'([^']+)',\s*name:\s*'([^']+)'[\s\S]*?regions:\s*\[([^\]]*)\]/g),
].map(([, id, name, regions]) => ({
  id,
  name,
  regions: regions.split(',').map((x) => x.trim().replace(/'/g, '')).filter(Boolean),
}));

/**
 * Language collections (src/data/collections.ts) — groups people search for as
 * one thing. Parsed rather than duplicated so adding a row there is the whole
 * job of adding a page.
 */
const collectionSrc = await readFile(resolve(ROOT, 'src/data/collections.ts'), 'utf8');

/**
 * Read one field out of a collection literal.
 *
 * String scanning rather than a composed RegExp: the first attempt built
 * patterns with new RegExp and the escaping did not survive, which failed the
 * build loudly — the right outcome, and avoidable. Fields are found at their
 * own indentation so a word inside the comment above one cannot be mistaken
 * for the field itself.
 */
const fieldAt = (block, name) => {
  const i = block.indexOf(`\n    ${name}:`);
  return i === -1 ? -1 : i + name.length + 6;
};
const strField = (block, name) => {
  const i = fieldAt(block, name);
  if (i === -1) return undefined;
  const q = block.indexOf("'", i);
  if (q === -1) return undefined;
  let out = '';
  for (let j = q + 1; j < block.length; j++) {
    if (block[j] === '\\') { out += block[++j]; continue; }
    if (block[j] === "'") break;
    out += block[j];
  }
  return out;
};
const arrayField = (block, name) => {
  const i = fieldAt(block, name);
  if (i === -1) return undefined;
  const open = block.indexOf('[', i);
  const close = block.indexOf(']', open);
  if (open === -1 || close === -1) return undefined;
  return block.slice(open + 1, close).split(',').map((x) => x.trim().replace(/'/g, '')).filter(Boolean);
};

const COLLECTIONS = collectionSrc
  .split(/\n  \{\n/)
  .slice(1)
  .map((block) => '\n' + block.split(/\n  \},/)[0])
  .filter((block) => block.includes('slug:'))
  .map((block) => ({
    slug: strField(block, 'slug'),
    label: strField(block, 'label'),
    chip: strField(block, 'chip'),
    title: strField(block, 'title'),
    description: strField(block, 'description'),
    languages: arrayField(block, 'languages'),
    kinds: arrayField(block, 'kinds'),
    genres: arrayField(block, 'genres'),
  }));

if (!COLLECTIONS.length) throw new Error('No collections parsed from src/data/collections.ts');
for (const c of COLLECTIONS) {
  if (!c.slug || !c.label || !c.chip || !c.title || !c.description) {
    throw new Error(`Collection "${c.slug ?? '(unnamed)'}" is missing a field its page needs.`);
  }
  if (!c.languages && !c.kinds && !c.genres) {
    throw new Error(`Collection "${c.slug}" selects nothing — it would list the entire feed.`);
  }
}

/** Membership, mirroring inCollection() in src/data/collections.ts: every
 *  dimension that is set must match, any value within one. */
const inCollection = (c, r) => {
  if (c.languages && !(r.languages ?? []).some((l) => c.languages.includes(l))) return false;
  if (c.kinds && !c.kinds.includes(r.kind)) return false;
  if (c.genres && !(r.genres ?? []).some((g) => c.genres.includes(g))) return false;
  return true;
};

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

// The brand is now the search term, so it leads instead of trailing: "New on
// OTT this week" is the query people type, and repeating "OTT" to append the
// brand — as the old "… — OTT & theatres | New on OTT" did — spends characters
// Google truncates on a word already in the sentence.
const title = `${BRAND} this week (${range}) — every platform, plus cinemas`;
const topPlatforms = [...new Set(rows.flatMap((r) => r.platforms))].map(pname).slice(0, 5);
/**
 * Says where to watch, not just what is out.
 *
 * This described "N releases across M platforms" and stopped there, which
 * reads as a place that carries the releases. A reader wrote in unsure
 * whether she could watch things here — and this line is what shows in a
 * Google result, so it is where the misunderstanding starts for anyone who
 * arrives from search.
 */
const description =
  `Every new film, series and show released this week — ${range}. ` +
  `${rows.length} releases across ${platforms.length} platforms including ` +
  `${topPlatforms.join(', ')}. See which platform each one is on and open it there. ` +
  `Updated twice a week. No login.`;

// --- what every page is built from ------------------------------------------

/**
 * Rows grouped into <section>s, which is the whole of the crawlable content.
 *
 * The homepage and the week pages group by platform ("what is on Netflix this
 * week"); the platform and language pages group by week ("what has Netflix had
 * lately"). Same rows, different question, which is the point — pages that
 * merely reshuffle the same list are the thin programmatic content Google
 * demotes, and each of these answers something the others do not.
 */
function sectionsBy(rows, key) {
  const groups = new Map();
  for (const r of rows) {
    for (const g of key(r)) {
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(r);
    }
  }
  return groups;
}

const rowMarkup = (r) =>
  `<li>${r.slug ? `<a href="/ott-release-date/${r.slug}">${esc(r.title)}</a>` : esc(r.title)}` +
  ` — ${esc(KIND[r.kind] ?? r.kind)}` +
  `${r.languages?.length ? ` · ${esc(r.languages.map(lname).join(', '))}` : ''}` +
  `${r.genres?.length ? ` · ${esc(r.genres.slice(0, 2).join(', '))}` : ''}</li>`;

const sectionMarkup = (groups, heading) =>
  [...groups.entries()]
    .map(([g, list]) => `<section><h2>${esc(heading(g))}</h2><ul>${list.map(rowMarkup).join('')}</ul></section>`)
    .join('');

/**
 * The same links the app renders (components/BrowseLinks.tsx), with the same
 * labels.
 *
 * A page nothing links to is invisible to a crawler no matter what the sitemap
 * claims, and these are the only route between them. Present before React
 * mounts, and carrying *identical* text — markup shown to a crawler that a
 * person never sees is cloaking, and an early version of this drifted: the
 * prerender said "In cinemas" where the component said "New on In Theatres".
 */
function browseMarkup(pages) {
  const row = (label, list) =>
    `<div><h2>${esc(label)}</h2><div>` +
    list.map((pg) => `<a href="/${pg.path}">${esc(pg.linkText)}</a>`).join(' ') +
    `</div></div>`;
  return (
    `<nav class="browse">` +
    row('Collections', pages.filter((p) => p.group === 'collection')) +
    row('Platforms', pages.filter((p) => p.group === 'platform')) +
    row('Languages', pages.filter((p) => p.group === 'language')) +
    row('Months', pages.filter((p) => p.group === 'month')) +
    row('Weeks', pages.filter((p) => p.group === 'week')) +
    `</nav>`
  );
}

const buildSha =
  process.env.WORKERS_CI_COMMIT_SHA ??
  process.env.CF_PAGES_COMMIT_SHA ??
  process.env.GITHUB_SHA ??
  (() => {
    try {
      return execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
        .toString()
        .trim();
    } catch {
      return 'unknown';
    }
  })();

const buildMeta =
  `    <meta name="build-commit" content="${esc(buildSha.slice(0, 12))}" />\n` +
  `    <meta name="build-time" content="${new Date().toISOString()}" />\n`;

/**
 * Cloudflare Web Analytics, when a token is configured. Injected at build time
 * rather than by the app so it keeps its `defer` and does not wait on React —
 * a beacon that only fires after hydration misses the visitors who bounce,
 * which are exactly the ones worth counting.
 */
const analytics = ANALYTICS_TOKEN
  ? `    <script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token":"${ANALYTICS_TOKEN}"}'></script>\n`
  : '';

/**
 * Enough styling that the pre-hydration paint reads as the page loading.
 *
 * The background and the font are here for a narrower reason than the rest: if
 * the stylesheet is the thing that failed, this is all there is. Grey text at
 * #8d94a4 was written against the app's near-black background, and on the white
 * a bare document defaults to it is close to unreadable — the state reported
 * from a locked-down laptop, where it read as a broken site rather than a
 * blocked one.
 *
 * It goes on `html`, not `body`, on purpose. This block sits after the
 * stylesheet in the head, so a `body` rule here would win over app.css and
 * paint over the real background on every normal load. A background on `html`
 * shows only where `body` has none — which is precisely the case where the
 * stylesheet never arrived.
 */
const FALLBACK_CSS = `    <style>
      html { background: #06070a; }
      .seo-fallback { max-width: 1180px; margin: 0 auto; padding: 32px 20px; color: #8d94a4;
        font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; }
      .seo-fallback h1 { color: #f2f4f9; font-size: 28px; margin: 0 0 4px; }
      .seo-fallback h2 { color: #b6bdcc; font-size: 15px; margin: 24px 0 6px; }
      .seo-fallback ul { margin: 0; padding-left: 18px; line-height: 1.7; }
      .seo-fallback a { color: #b6bdcc; text-decoration: none; }
      .crumbs { font-size: 12px; color: #6a7080; margin-bottom: 10px; }
      .crumbs a { color: #6a7080; }
      .browse { margin-top: 28px; padding-top: 20px; border-top: 1px solid #ffffff14; }
      .browse > div { display: flex; align-items: baseline; gap: 14px; margin-bottom: 12px; flex-wrap: wrap; }
      .browse h2 { flex: none; width: 78px; margin: 0; font-size: 10.5px; letter-spacing: .12em; text-transform: uppercase; }
      .browse a { display: inline-block; padding: 4px 11px; margin: 0 2px 4px 0; border: 1px solid #ffffff14; border-radius: 999px; font-size: 12px; }
    </style>
`;

/**
 * Turn one page definition into a file.
 *
 * Every page is the same built bundle with a different head and a different
 * prerendered body — no router, no server. Cloudflare serves /netflix from
 * dist/netflix/index.html, and the app reads the path on mount (lib/route.ts)
 * so what renders matches what the page promised.
 */
async function renderPage(page, pages) {
  const canonical = `${SITE_URL}/${page.path}`;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebSite',
        name: BRAND,
        url: `${SITE_URL}/`,
        description: 'Every new release, every platform, one page.',
        sameAs: [INSTAGRAM_URL],
      },
      // Breadcrumbs on the child pages only. A crumb trail on the homepage is
      // a trail of one, which tells a crawler nothing it did not have.
      ...(page.path
        ? [
            {
              '@type': 'BreadcrumbList',
              /**
               * The same trail the page renders. A title page goes through
               * /theatres because that is the link it shows; structured data
               * describing a route the reader cannot take is a claim the page
               * does not keep.
               */
              itemListElement: [
                { '@type': 'ListItem', position: 1, name: BRAND, item: `${SITE_URL}/` },
                ...(page.group === 'title'
                  ? [{ '@type': 'ListItem', position: 2, name: 'In cinemas', item: `${SITE_URL}/theatres` }]
                  : []),
                {
                  '@type': 'ListItem',
                  position: page.group === 'title' ? 3 : 2,
                  name: page.crumb,
                  item: canonical,
                },
              ],
            },
          ]
        : []),
      {
        '@type': 'ItemList',
        name: page.h1,
        numberOfItems: page.rows.length,
        itemListElement: page.rows.slice(0, 50).map((r, i) => ({
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

  const head =
    `    <link rel="canonical" href="${canonical}" />\n` +
    `    <meta property="og:url" content="${canonical}" />\n` +
    `    <meta property="og:site_name" content="${esc(BRAND)}" />\n` +
    `    <meta property="og:image" content="${SITE_URL}/og.png" />\n` +
    `    <meta property="og:image:width" content="1200" />\n` +
    `    <meta property="og:image:height" content="630" />\n` +
    `    <meta name="twitter:image" content="${SITE_URL}/og.png" />\n` +
    FALLBACK_CSS +
    `    <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>\n` +
    /**
     * The title's own row, carried in the page.
     *
     * A title page outlives the eight-week feed the app loads, so once its week
     * rolls off, the app looks the slug up, finds nothing and renders "we don't
     * have that title any more" — under prerendered markup that has the whole
     * film on it. A crawler would see the page and a visitor would see the
     * apology.
     *
     * Embedding beats fetching an archive file: no second request, no waterfall
     * before the page can render, and it stays one small object per page however
     * large the archive grows. `<` is escaped so a synopsis containing "</script>"
     * cannot close this tag early.
     */
    (page.embed
      ? `    <script type="application/json" id="title-data">${JSON.stringify(page.embed).replace(/</g, '\\u003c')}</script>\n`
      : '') +
    buildMeta +
    analytics;

  /**
   * React replaces this on mount, but on a slow connection it is on screen for
   * a moment first — so it gets enough styling to read as the page loading
   * rather than a broken one. Deliberately visible, not hidden: text a crawler
   * can see and a visitor cannot is cloaking, and the honest version is what
   * ranks.
   */
  /** The crumb trail, rendered before React mounts and matching what the app
   *  shows. Also the home link every sub-page was missing: the wordmark was a
   *  <span>, so 80 of 81 pages had no way back at all. */
  const crumbs = page.path
    ? `<nav class="crumbs"><a href="/">${esc(BRAND)}</a> › ` +
      (page.group === 'title' ? `<a href="/theatres">In cinemas</a> › ` : '') +
      `<span>${esc(page.crumb)}</span></nav>`
    : '';

  const prerendered =
    `<main class="seo-fallback">${crumbs}<h1>${esc(page.h1)}</h1>` +
    `<p>${esc(page.lede)}</p>` +
    /* The same sentence the app shows under the week bar, so the
       pre-hydration paint and a crawler both get it. */
    (page.path ? '' : `<p>${esc(TAGLINE_LONG)}</p>`) +
    (page.facts ?? '') +
    page.body +
    browseMarkup(pages) +
    `</main>`;

  const out = html
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(page.title)}</title>`)
    .replace(/<meta\s+name="description"[\s\S]*?\/>/, `<meta name="description" content="${esc(page.description)}" />`)
    .replace(/<meta\s+property="og:title"[\s\S]*?\/>/, `<meta property="og:title" content="${esc(page.title)}" />`)
    .replace(/<meta\s+property="og:description"[\s\S]*?\/>/, `<meta property="og:description" content="${esc(page.description)}" />`)
    .replace('</head>', `${head}  </head>`)
    .replace('<div id="root"></div>', `<div id="root">${prerendered}</div>`);

  const dir = page.path ? resolve(ROOT, 'dist', page.path) : resolve(ROOT, 'dist');
  await mkdir(dir, { recursive: true });
  await writeFile(resolve(dir, 'index.html'), out);
}

/**
 * The facts a page leads with, in the prerendered copy too.
 *
 * The component renders these for a reader (components/PageIntro.tsx); a
 * crawler has to see them as well, or the twenty-four documents it compares
 * differ only by which rows they list — which is the thin-page problem the
 * pages were built to escape.
 */
const STRONG_VOTES = 50;

function factsMarkup({ rows, thisWeek, cross, cross2 }) {
  const parts = [];

  const biggest = [...(thisWeek.length ? thisWeek : rows)]
    .sort((a, b) => (b.heat ?? 0) - (a.heat ?? 0))
    .slice(0, 3);
  if (biggest.length) {
    parts.push(
      `<p><strong>${thisWeek.length ? 'Biggest this week' : 'Biggest right now'}:</strong> ` +
        biggest.map((r) => esc(r.title)).join(', ') +
        `</p>`,
    );
  }

  for (const c of [cross, cross2]) {
    if (!c || !c.items.length) continue;
    parts.push(
      `<p><strong>${esc(c.label)}:</strong> ` +
        c.items.map((i) => `${esc(i.text)} (${i.n})`).join(', ') +
        `</p>`,
    );
  }

  const best = [...rows]
    .filter((r) => r.rating != null && (r.votes == null || r.votes >= STRONG_VOTES))
    .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))[0];
  if (best) {
    parts.push(`<p><strong>Best rated:</strong> ${esc(best.title)} — ${best.rating.toFixed(1)}</p>`);
  }

  return parts.join('');
}

const tally = (rows, pick) => {
  const counts = new Map();
  for (const r of rows) for (const k of pick(r)) counts.set(k, (counts.get(k) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
};

// --- the page set -----------------------------------------------------------

const REGION = 'IN';

/** Read from the app rather than repeated, so the links it renders and the
 *  pages this writes cannot disagree. See lib/route.ts for why it exists. */
const routeSrc = await readFile(resolve(ROOT, 'src/lib/route.ts'), 'utf8');
const MAX_PAGE_SHARE = Number(
  (routeSrc.match(/export const MAX_PAGE_SHARE\s*=\s*([\d.]+)/) ?? [])[1] ??
    (() => {
      throw new Error('src/lib/route.ts no longer exports MAX_PAGE_SHARE.');
    })(),
);
const MIN_PAGE_ROWS = Number(
  (routeSrc.match(/export const MIN_PAGE_ROWS\s*=\s*(\d+)/) ?? [])[1] ??
    (() => {
      throw new Error('src/lib/route.ts no longer exports MIN_PAGE_ROWS.');
    })(),
);
/**
 * The month slugs, read out of the app's own route table rather than kept here.
 *
 * The path the build writes and the path the app resolves have to be spelled
 * identically or a chip lands on the SPA fallback, and two hand-kept lists of
 * twelve month names is exactly the kind of pair that drifts silently.
 */
const MONTH_SLUGS = (() => {
  const block = routeSrc.match(/export const MONTH_SLUGS\s*=\s*\[([\s\S]*?)\]/);
  if (!block) throw new Error('src/lib/route.ts no longer exports MONTH_SLUGS.');
  const names = [...block[1].matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
  if (names.length !== 12) throw new Error(`MONTH_SLUGS has ${names.length} entries, expected 12.`);
  return names;
})();

const stockedWeeks = feed.weeks.filter((w) => w.releases.some((r) => r.regions.includes(REGION)));
/** Stamped with their week on the way out: a release row carries no week id of
 *  its own, and the platform and language pages group by week. */
const everything = stockedWeeks.flatMap((w) =>
  w.releases.filter((r) => r.regions.includes(REGION)).map((r) => ({ ...r, weekId: w.id })),
);

const TODAY = new Date().toISOString().slice(0, 10);

/** The id suffix a streaming-date row carries, so it is a separate calendar
 *  entry from the same film's cinema listing. See fetch-releases.mjs. */
const DIGITAL_SUFFIX = 'ott';

/**
 * Every title the feed has ever carried, not just the ones in it today.
 *
 * The feed is a rolling eight-week window, so generating title pages from it
 * meant every page had a three-week fuse: the film's week fell off the back,
 * the page stopped being written, and the URL died. A page that deletes itself
 * never gets to be the page that ranks — and search rewards a URL that has been
 * answering the same question for a year.
 *
 * scripts/archive.mjs keeps the permanent record and this reads it. Missing
 * file means it has never run, which is not a reason to fail a build: the
 * window still covers the current weeks, so the site is correct, just not yet
 * accumulating.
 *
 * Deliberately only the title pages. Every other page here — platform,
 * language, collection, week, month — is also rendered by the app from the
 * live feed, and widening those to the archive would have the prerendered
 * /netflix list three hundred titles while the app showed thirty-seven. A
 * title page has no such problem: it is one title, and the build embeds that
 * title's own data into the page.
 */
const archived = await readFile(resolve(ROOT, 'data/archive.json'), 'utf8')
  .then((s) => JSON.parse(s).titles)
  .catch(() => []);

const liveIds = new Set(everything.map((r) => r.id));
/** Live rows win: they came from this refresh and the archive may be a run
 *  behind on a platform that has just picked a film up. */
const titleCandidates = [
  ...everything,
  ...archived.filter((r) => !liveIds.has(r.id) && (r.regions ?? []).includes(REGION)),
];

/**
 * Every theatrical film with enough on it to fill a page — before it opens as
 * well as after.
 *
 * This used to require `releaseDate <= TODAY`, on the reasoning that a film
 * which is not out yet has no "when does it stream" question worth answering.
 * That reasoning was sound about the OTT question and wrong about the page:
 * the pre-release window is where the search volume actually is. People look
 * up a film's release date, cast and runtime in the weeks *before* it opens,
 * far more than after, and the gate was withholding a page from 41 titles
 * that already had a synopsis and a cast sitting in the feed.
 *
 * It also argued against the note directly above it. A page indexed and
 * ageing before demand arrives is the difference between ranking and watching
 * someone else rank — which is an argument for publishing earlier, not for
 * waiting until the film opens.
 *
 * So the page now has three states and says something true in each: what the
 * release date is before it opens, that streaming is unannounced after it
 * opens, and which platform has it once one does. The URL never changes, so a
 * page earns its age through all three.
 *
 * The other two conditions still hold, and both are about not shipping thin
 * pages: without a synopsis and a cast there is nothing on the document but a
 * date, and those two fields are what make 88 pages 88 documents rather than
 * one template repeated.
 */
const titlePages = titleCandidates
  .filter((r) => r.platforms.includes('theatres') && r.synopsis && r.cast?.length)
  // Newest first, so the sitemap leads with what people are searching now.
  .sort((a, b) => b.releaseDate.localeCompare(a.releaseDate));

/*
 * One URL per film, even when two films share a name.
 *
 * Two titles slugified to "spark" and the build threw — correctly, since a page
 * that two rows both claim is a page one of them silently loses. It only threw
 * on 12 September because that is the day TMDB happened to hand us the second
 * one, which means every refresh from then on would have failed until somebody
 * looked. A calendar that stops updating because two films share a word is not
 * a calendar.
 *
 * So a collision is resolved rather than fatal. The first title to claim a slug
 * keeps the bare one — titlePages is sorted newest-first, so that is the more
 * recent film and the one people are more likely to be searching — and the next
 * takes its year, then a counter if even that repeats. No existing URL moves,
 * because the winner is unchanged; the loser gains a suffix instead of an
 * exception.
 */
const slugById = new Map();
const claimed = new Set();
const collisions = [];
for (const r of titlePages) {
  const base = slugify(r.title);
  if (!base) continue;
  let slug = base;
  if (claimed.has(slug)) {
    const year = (r.releaseDate ?? '').slice(0, 4);
    slug = year ? `${base}-${year}` : base;
    for (let n = 2; claimed.has(slug); n++) slug = `${base}-${year || 'x'}-${n}`;
    collisions.push(`${r.title} -> /${slug}`);
  }
  claimed.add(slug);
  slugById.set(r.id, slug);
}
if (collisions.length) {
  console.log(`     ${collisions.length} title(s) shared a slug and were given their own: ${collisions.join(', ')}`);
}

/**
 * Stamped onto the feed's own rows, before any page markup is built.
 *
 * Every prerendered list — the homepage, each week, /theatres, each collection
 * — links a title that has a page, and those links are the only route a
 * crawler has to the 47 title pages. A sitemap entry for a page nothing links
 * to is a page that does not get crawled.
 */
/**
 * A streaming-date row carries its own id and the same film's page.
 *
 * `m-1408162~ott` is Vishwanath & Sons reaching OTT — a separate calendar
 * entry, deliberately, but not a separate film. Looked up by the bare id so
 * the "Coming soon" card links to the page that answers the question it
 * raises, instead of being the one card in the row that goes nowhere.
 */
const slugFor = (id) => slugById.get(id) ?? slugById.get(String(id).replace(/~[a-z]+$/, ''));

for (const w of feed.weeks) {
  for (const r of w.releases) {
    const slug = slugFor(r.id);
    if (slug) r.slug = slug;
  }
}
for (const r of everything) {
  const slug = slugFor(r.id);
  if (slug) r.slug = slug;
}

const weekRangeOf = (id) => formatRange(id);
const platformsPresent = PLATFORM_ROWS.filter(
  (p) =>
    p.regions.includes(REGION) &&
    everything.filter((r) => r.platforms.includes(p.id)).length >= MIN_PAGE_ROWS,
);
const languagesPresent = [...languageName].filter(
  ([code]) => everything.filter((r) => (r.languages ?? []).includes(code)).length >= MIN_PAGE_ROWS,
);

const pages = [];

/** The homepage: this week, grouped by platform. Unchanged in substance. */
pages.push({
  path: '',
  group: 'root',
  crumb: BRAND,
  rows,
  title,
  description,
  h1: `New releases this week — ${range}`,
  lede: `${rows.length} releases across ${platforms.length} platforms.`,
  body: sectionMarkup(sectionsBy(rows, (r) => r.platforms), pname),
});

for (const p of platformsPresent) {
  const list = everything.filter((r) => r.platforms.includes(p.id));
  const theatres = p.id === 'theatres';
  pages.push({
    path: p.id,
    group: 'platform',
    crumb: p.name,
    linkText: theatres ? 'In cinemas' : p.name,
    rows: list,
    title: theatres
      ? `New movies in cinemas this week in India — ${BRAND}`
      : `New on ${p.name} India — every new release, updated weekly`,
    description: theatres
      ? `Every film opening in Indian cinemas this week and the weeks around it. ${list.length} titles, updated every Friday. No login.`
      : `Everything new on ${p.name} in India — ${list.length} films, series and shows across ${stockedWeeks.length} weeks, updated every Friday. No app, no login.`,
    h1: theatres ? 'New in cinemas' : `New on ${p.name}`,
    lede: `${list.length} releases across ${stockedWeeks.length} weeks, updated every Friday.`,
    facts: factsMarkup({
      rows: list,
      thisWeek: list.filter((r) => r.weekId === week.id),
      cross: {
        label: 'Mostly in',
        items: tally(list, (r) => r.languages ?? [])
          .slice(0, 4)
          .map(([c, n]) => ({ text: lname(c), n })),
      },
    }),
    body: sectionMarkup(sectionsBy(list, (r) => [r.weekId]), weekRangeOf),
  });
}

for (const c of COLLECTIONS) {
  const list = everything.filter((r) => inCollection(c, r));
  /**
   * Two guards, both read from the app so the chips and the pages agree:
   * enough rows to be worth a page, and not so many that the page is really
   * the homepage again — /movies would have been 143 of 183 rows.
   */
  if (list.length < MIN_PAGE_ROWS || list.length > everything.length * MAX_PAGE_SHARE) continue;

  /** A language collection's interesting cut is which of its own languages
   *  turned up; a genre or kind collection's is which platforms carry it. */
  const languageCut = {
    label: 'Languages',
    items: tally(list, (r) => (r.languages ?? []).filter((l) => !c.languages || c.languages.includes(l)))
      .slice(0, c.languages ? c.languages.length : 4)
      .map(([code, n]) => ({ text: lname(code), n })),
  };
  const platformCut = {
    label: 'Mostly on',
    items: tally(list, (r) => r.platforms).slice(0, 4).map(([id, n]) => ({ text: pname(id), n })),
  };

  pages.push({
    path: c.slug,
    group: 'collection',
    crumb: c.label,
    linkText: c.chip,
    rows: list,
    title: c.title,
    description: c.description.replace('{n}', String(list.length)),
    h1: c.label,
    lede: `${list.length} titles across ${stockedWeeks.length} weeks, updated every Friday.`,
    facts: factsMarkup({
      rows: list,
      thisWeek: list.filter((r) => r.weekId === week.id),
      cross: c.languages ? languageCut : platformCut,
      cross2: c.languages ? platformCut : languageCut,
    }),
    body: sectionMarkup(sectionsBy(list, (r) => [r.weekId]), weekRangeOf),
  });
}

for (const [code, name] of languagesPresent) {
  const list = everything.filter((r) => (r.languages ?? []).includes(code));
  pages.push({
    path: name.toLowerCase(),
    group: 'language',
    crumb: name,
    linkText: name,
    rows: list,
    title: `New ${name} movies and series — every OTT platform, updated weekly`,
    description: `Every new ${name} film, series and show across streaming platforms and cinemas — ${list.length} titles, updated every Friday. No app, no login.`,
    h1: `New ${name} releases`,
    lede: `${list.length} ${name} titles across every platform and cinemas, updated every Friday.`,
    facts: factsMarkup({
      rows: list,
      thisWeek: list.filter((r) => r.weekId === week.id),
      cross: {
        label: 'Mostly on',
        items: tally(list, (r) => r.platforms)
          .slice(0, 4)
          .map(([id, n]) => ({ text: pname(id), n })),
      },
    }),
    body: sectionMarkup(sectionsBy(list, (r) => [r.weekId]), weekRangeOf),
  });
}

/**
 * The back catalogue, as a page.
 *
 * A reader asked for it: a release calendar can only answer "what is new", and
 * plenty of evenings the question is "what is worth watching". This is the
 * other lens on the same board — a different set of titles rather than a filter
 * over the week, which is why it reads its own file.
 *
 * Grouped by language, never ranked across them. TMDB vote counts are wildly
 * uneven between languages, so one merged "best of" ordering would put a
 * 40,000-vote English title above an 80-vote Malayalam one and present the
 * result as a judgement about the films. Within a language the comparison is
 * fair, so that is the only comparison offered.
 */
const catalogue = await readFile(resolve(ROOT, 'public/data/catalogue.json'), 'utf8')
  .then((raw) => JSON.parse(raw).titles ?? [])
  .catch(() => []);

if (catalogue.length >= MIN_PAGE_ROWS) {
  const byLang = new Map();
  for (const r of catalogue) {
    const code = r.languages?.[0];
    if (!code) continue;
    if (!byLang.has(code)) byLang.set(code, []);
    byLang.get(code).push(r);
  }
  /** Only languages with enough to be worth a heading, biggest first. */
  const groups = [...byLang.entries()]
    .filter(([, rows]) => rows.length >= MIN_PAGE_ROWS)
    .sort((a, b) => b[1].length - a[1].length);

  const platformCount = new Set(catalogue.flatMap((r) => r.platforms ?? [])).size;
  const body = groups
    .map(([code, rows]) => {
      const top = [...rows].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0)).slice(0, 12);
      return (
        `<section><h2>Best ${esc(lname(code))} on streaming</h2><ul>` +
        top
          .map(
            (r) =>
              `<li>${esc(r.title)} (${esc(r.year)}) — ` +
              `${esc(r.rating?.toFixed(1) ?? '')} · ${esc((r.platforms ?? []).map(pname).join(', '))}</li>`,
          )
          .join('') +
        `</ul></section>`
      );
    })
    .join('');

  pages.push({
    path: 'streaming',
    group: 'lens',
    crumb: 'Now streaming',
    linkText: 'Now streaming',
    rows: catalogue,
    title: 'Best movies and shows streaming in India right now — every platform',
    description:
      `${catalogue.length} well-rated films and series you can watch right now in India, ` +
      `across ${platformCount} streaming services — grouped by language, and every one included with a subscription rather than rented.`,
    h1: 'Good things streaming right now',
    lede:
      `${catalogue.length} titles across ${platformCount} platforms, ranked within each language ` +
      `because a Tamil film and an English one do not get compared on vote counts here.`,
    facts: '',
    body,
  });
}

/**
 * Everything still to come.
 *
 * Overlaps the month pages by construction — it is their future half — and
 * that is the point rather than an oversight: "what is releasing in October"
 * and "what is coming next" are different questions from different people, and
 * this one re-sorts by how soon rather than by when in the month. It is also
 * the only page here whose contents change without a rebuild, since the app
 * recomputes the cutoff on load.
 */
const upcomingRows = everything.filter((r) => r.releaseDate > TODAY);
if (upcomingRows.length >= MIN_PAGE_ROWS) {
  const cinema = upcomingRows.filter((r) => r.platforms.includes('theatres')).length;
  const soonest = [...upcomingRows].sort((a, b) => a.releaseDate.localeCompare(b.releaseDate))[0];
  pages.push({
    path: 'upcoming',
    group: 'month',
    crumb: 'Coming soon',
    linkText: 'Coming soon',
    rows: upcomingRows,
    title: 'Upcoming OTT and movie releases in India — what’s coming next',
    description:
      `${upcomingRows.length} films, series and shows still to come in India — ${cinema} opening in cinemas, ` +
      `the rest landing on streaming. Next up: ${soonest.title} on ${formatDate(soonest.releaseDate)}.`,
    h1: 'Coming soon',
    lede: `${upcomingRows.length} releases still to come — next up is ${soonest.title} on ${formatDate(soonest.releaseDate)}.`,
    facts: factsMarkup({
      rows: upcomingRows,
      thisWeek: [],
      cross: {
        label: 'Mostly on',
        items: tally(upcomingRows, (r) => r.platforms)
          .slice(0, 4)
          .map(([id, n]) => ({ text: pname(id), n })),
      },
    }),
    body: sectionMarkup(sectionsBy(upcomingRows, (r) => [r.weekId]), weekRangeOf),
  });
}

/**
 * Everything still playing in cinemas.
 *
 * The homepage rail names its own total — "In cinemas · 89 titles" — and shows
 * twenty. The other sixty-nine were reachable only by already knowing a title
 * and searching for it, which is how a film five weeks into a healthy run reads
 * as absent from a site whose whole claim is that it knows what is on.
 *
 * Six weeks back, matching lib/rails.ts. Both count every film playing rather
 * than every film with artwork — the rail gates its *cards* on having a poster,
 * as a poster row must, and for a while reported that filtered number as its
 * total: the heading said 89 and the page it linked to said 93. Ordered newest-first by week like the
 * month pages, because a reader who has arrived here has already been shown the
 * big three and is now after the long tail.
 *
 * Worth a page of its own rather than a filter on a week: "movies in cinemas
 * now" is a question with no good answer anywhere else in India, and it is the
 * one this site can answer that a streaming-only competitor structurally
 * cannot.
 */
const CINEMA_WINDOW_DAYS = 42;
const cinemaFrom = new Date(Date.parse(`${TODAY}T00:00:00Z`) - (CINEMA_WINDOW_DAYS - 1) * 86_400_000)
  .toISOString()
  .slice(0, 10);
/* Still only in a cinema — the same rule as the rail, and for the same reason:
   a film you can stream tonight is not an answer to "what is on near me".
   See `showing` in src/lib/rails.ts. */
const inCinemasRows = everything.filter(
  (r) =>
    r.platforms.includes('theatres') &&
    !r.platforms.some((p) => p !== 'theatres') &&
    r.releaseDate >= cinemaFrom &&
    r.releaseDate <= TODAY,
);
if (inCinemasRows.length >= MIN_PAGE_ROWS) {
  const langs = tally(inCinemasRows, (r) => r.languages).length;
  pages.push({
    path: 'in-cinemas',
    group: 'month',
    crumb: 'In cinemas',
    linkText: 'In cinemas now',
    rows: inCinemasRows,
    title: 'Movies in cinemas now in India — every film currently running',
    description:
      `All ${inCinemasRows.length} films playing in Indian cinemas right now, across ${langs} languages — ` +
      `release dates, runtimes, cast and where to book.`,
    h1: 'Playing in cinemas now',
    lede:
      `${inCinemasRows.length} films are currently running in Indian cinemas, from this Friday's ` +
      `openings back through the last six weeks.`,
    facts: factsMarkup({
      rows: inCinemasRows,
      thisWeek: [],
      cross: {
        label: 'Mostly in',
        items: tally(inCinemasRows, (r) => r.languages)
          .slice(0, 4)
          .map(([code, n]) => ({ text: lname(code), n })),
      },
    }),
    body: sectionMarkup(sectionsBy(inCinemasRows, (r) => [r.weekId]), weekRangeOf),
  });
}

/**
 * One page per calendar month, plus everything not out yet.
 *
 * A month is how people ask this question outside the industry. Nobody types
 * "releases for the week of 4 September" — they type "movies releasing in
 * September" and "upcoming OTT releases", both of which are large, recurring
 * and permanently seasonal. The week pages are the archive; these are the two
 * shapes the demand actually arrives in.
 *
 * A month spans weeks, which is why it needed the span route rather than a
 * filter: the board on these pages reads across the feed and the week stepper
 * above it is hidden, because a control that steps a week nothing renders from
 * is a control that does nothing.
 *
 * MIN_PAGE_ROWS applies, so a month clipped at the edge of the eight-week
 * window does not get a page holding two stray titles. MAX_PAGE_SHARE does
 * not: it exists to stop a page becoming a second copy of the homepage, and
 * the homepage is one week — a month is a different question with a different
 * answer even when it is most of the feed.
 */
const monthsPresent = [...new Set(everything.map((r) => r.releaseDate.slice(0, 7)))]
  .sort()
  .map((ym) => ({ ym, list: everything.filter((r) => r.releaseDate.startsWith(ym)) }))
  .filter(({ list }) => list.length >= MIN_PAGE_ROWS);

for (const { ym, list } of monthsPresent) {
  const [year, month] = ym.split('-');
  /**
   * The full month name, matching what BrowseLinks renders.
   *
   * This said "Aug 2026" while the component said "August 2026" — the same
   * prerender-versus-app drift that made the platform row say "In cinemas" to
   * a crawler and "New on In Theatres" to a reader. A crawler being shown
   * different link text than a person is the cloaking problem these chips
   * exist to avoid, even when the difference is three letters.
   */
  const full = new Date(`${ym}-01T00:00:00Z`).toLocaleDateString('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const cinema = list.filter((r) => r.platforms.includes('theatres')).length;
  pages.push({
    path: `releases/${MONTH_SLUGS[Number(month) - 1]}-${year}`,
    group: 'month',
    crumb: full,
    linkText: full,
    rows: list,
    title: `${full} OTT and movie releases in India — every platform, plus cinemas`,
    description:
      `Everything releasing in ${full}: ${list.length} films, series and shows across ` +
      `${new Set(list.flatMap((r) => r.platforms)).size} streaming platforms and Indian cinemas. Updated every Friday.`,
    h1: `Releases in ${full}`,
    lede:
      `${list.length} releases in ${full} — ${cinema} in cinemas, ${list.length - cinema} straight to streaming.`,
    facts: factsMarkup({
      rows: list,
      thisWeek: list.filter((r) => r.weekId === week.id),
      cross: {
        label: 'Mostly on',
        items: tally(list, (r) => r.platforms)
          .slice(0, 4)
          .map(([id, n]) => ({ text: pname(id), n })),
      },
    }),
    body: sectionMarkup(sectionsBy(list, (r) => [r.weekId]), weekRangeOf),
  });
}

/**
 * One page per week, newest first.
 *
 * These are the entries that compound. The homepage churns — every Friday its
 * content is replaced and the previous week is gone — so nothing the site
 * publishes accumulates. An archive page keeps it: a permanent URL for "what
 * came out the week of X", one more of them every Friday, forever.
 */
for (const w of [...stockedWeeks].sort((a, b) => b.id.localeCompare(a.id))) {
  const list = w.releases.filter((r) => r.regions.includes(REGION));
  const wRange = formatRange(w.id);
  pages.push({
    path: `w/${w.id}`,
    group: 'week',
    crumb: wRange,
    linkText: wRange,
    rows: list,
    title: `New OTT releases ${wRange} — every platform, plus cinemas`,
    description: `Everything released ${wRange}: ${list.length} films, series and shows across ${new Set(list.flatMap((r) => r.platforms)).size} platforms and Indian cinemas.`,
    h1: `New releases — ${wRange}`,
    lede: `${list.length} releases across ${new Set(list.flatMap((r) => r.platforms)).size} platforms.`,
    facts: factsMarkup({ rows: list, thisWeek: [], cross: null }),
    body: sectionMarkup(sectionsBy(list, (r) => r.platforms), pname),
  });
}

/**
 * A page per theatrical film: "when is <title> coming to OTT?"
 *
 * The highest-volume recurring pattern in Indian entertainment search, and the
 * one this site can answer better than anyone: it already knows what opened in
 * cinemas and it re-checks streaming providers twice a week, so the page flips
 * from "not announced" to the answer within days of the actual drop.
 *
 * Published the week the film opens, not the week it streams. A page indexed
 * and ageing before the demand arrives is the difference between ranking for
 * the query and watching someone else rank for it.
 *
 * Three conditions, and all three are about not shipping thin pages:
 *
 *   already opened   a film that is not out yet has no "when does it stream"
 *                    question worth a page, and the honest answer would be a
 *                    shrug on an empty document
 *   has a synopsis   without one there is nothing on the page but a date
 *   has a cast       same, and together they are what makes 116 pages 116
 *                    documents rather than one template repeated
 *
 * The slug is computed here and stamped into the shipped feed, so the app
 * resolves the path by reading a field rather than re-deriving it — one
 * implementation of the rule, and no way for the two to disagree.
 */
for (const r of titlePages) {
  const slug = slugById.get(r.id);
  if (!slug) continue;

  const streaming = r.platforms.filter((p) => p !== 'theatres');
  /** Three states, one URL. The page is written for whichever is true today
   *  and rewrites itself on the next build as the film moves through them. */
  const upcoming = r.releaseDate > TODAY;
  const opensOn = formatDate(r.releaseDate);

  /**
   * The film's own streaming date, which lives on a different row.
   *
   * A title with an announced digital date is two rows in this feed, not one:
   * the cinema listing in the week it opened, and a second row in the week it
   * reaches OTT. The page is built from the first, so it was answering "when
   * is this coming to OTT" with "not announced" while the feed three weeks
   * along held the date. Three films on 11 September — Vishwanath & Sons,
   * The End of Oak Street, Thudakkam — and that is the one question this page
   * exists to answer.
   *
   * The suffix is an id namespace, not a platform — the row it finds names a
   * real service, because a streaming date that cannot say where is no longer
   * written at all. So this answers with both halves, where it used to be able
   * to give only the date.
   */
  const dated = titleCandidates.find(
    (x) => x.id === `${r.id}~${DIGITAL_SUFFIX}`,
  );
  /* Both halves or neither: an archive row predating the rule could still
     carry a date with no service, and half an answer is the thing this page
     refuses to print. */
  const streamsOn =
    dated?.platforms?.length && dated.releaseDate >= TODAY ? dated.releaseDate : null;

  const answer = streaming.length
    ? `Streaming now on ${streaming.map(pname).join(', ')}.`
    : streamsOn
      ? `Streaming on ${dated.platforms.map(pname).join(', ')} from ${formatDate(streamsOn)}.`
      : upcoming
        ? `In cinemas from ${opensOn}. No streaming date yet — a film is normally picked up by a platform after its theatrical run, and this page updates automatically when one announces.`
        : `Not announced yet — no streaming date has been confirmed. This page updates automatically; every platform is re-checked twice a week.`;

  const langs = (r.languages ?? []).map(lname);

  /**
   * How a person would name this thing out loud: "Telugu movie", "Hindi series".
   *
   * The title tags carried neither word. A page about a Telugu film never said
   * "Telugu" anywhere in its tag, which drops the term people most often pair
   * with a title they half-remember — and the established sites in this space
   * put it first ("Thakavi Tamil Movie Streaming Online Watch on Amazon").
   * Ugly, and it matches the query.
   *
   * The kind word is dropped when the title already contains it, so
   * "Mirzapur: The Movie" does not become "Mirzapur: The Movie Hindi movie".
   */
  const KIND_WORD = {
    film: 'movie',
    series: 'series',
    documentary: 'documentary',
    reality: 'show',
    anime: 'anime',
    special: 'special',
  };
  const kindWord = KIND_WORD[r.kind] ?? 'title';
  const descriptor = [
    langs[0],
    r.title.toLowerCase().includes(kindWord) ? '' : kindWord,
  ]
    .filter(Boolean)
    .join(' ');

  /**
   * The descriptor rides in brackets after the title rather than inline.
   *
   * Inline, it had to be a noun phrase for the sentence around it to work, and
   * it is not always one: "Mirzapur: The Movie" already contains "movie", so
   * the kind word is dropped, the descriptor collapses to "Hindi", and the tag
   * read "where to watch the Hindi online". Bracketed, both "(Telugu movie)"
   * and "(Hindi)" are grammatical, and no template downstream has to care which
   * it got.
   */
  const qualified = descriptor ? `${r.title} (${descriptor})` : r.title;
  const on = streaming.length ? streaming.map(pname).join(', ') : '';
  // From the archive too, so a page whose week has rolled out of the window
  // keeps its context instead of quietly losing a section as it ages.
  const alsoThatWeek = titleCandidates
    .filter((x) => x.weekId === r.weekId && x.id !== r.id && x.platforms.includes('theatres'))
    .slice(0, 6);

  pages.push({
    path: `ott-release-date/${slug}`,
    group: 'title',
    crumb: r.title,
    rows: [r],
    /** Carried into the page so it still renders once this title has aged out
     *  of the feed the app loads. See the head assembly in renderPage. */
    embed: { ...r, slug },
    /**
     * Three states, and the tag tracks them because the query does.
     *
     * Before a film opens people search its release date. After it opens they
     * search when it will stream. Once it is streaming they search where to
     * watch it — the highest-intent of the three and the one worth being
     * literal about, so that tag leads with the word "Watch" and names the
     * platform.
     *
     * The important terms go first: a tag is truncated for display at roughly
     * sixty characters, and the half that survives should be the half carrying
     * the title, the language and the intent.
     */
    title: streaming.length
      ? `Watch ${qualified} online — streaming on ${on}`
      : upcoming
        ? `${qualified} release date — in cinemas ${opensOn}`
        : `${qualified} OTT release date — where to watch online`,
    description: streaming.length
      ? `${r.title}${langs.length ? ` (${langs.join(', ')})` : ''} is streaming now on ${on} in India. ` +
        `Cast, runtime, certificate and trailer, plus every other new release this week.`
      : upcoming
        ? `${r.title}${langs.length ? ` (${langs.join(', ')})` : ''} opens in Indian cinemas on ${opensOn}. ` +
          `Cast, runtime, certificate and trailer — plus the OTT date, tracked twice a week from the day it lands.`
        : `${r.title}${langs.length ? ` (${langs.join(', ')})` : ''} released in cinemas on ${opensOn}. ` +
          `No OTT platform has dated it yet — we re-check every platform twice a week and this page says so the day that changes.`,
    /**
     * The heading asked "When is X coming to OTT?" even when the answer block
     * directly beneath it said "Streaming now on Netflix" — the page
     * contradicting itself in its own h1, on the one state where the reader
     * has already found what they came for.
     */
    h1: streaming.length
      ? `Where to watch ${r.title}`
      : upcoming
        ? `When does ${r.title} release?`
        : `When is ${r.title} coming to OTT?`,
    lede: answer,
    facts:
      `<p><strong>${upcoming ? 'In cinemas from' : 'In cinemas'}:</strong> ${esc(opensOn)}</p>` +
      (langs.length ? `<p><strong>Language:</strong> ${esc(langs.join(', '))}</p>` : '') +
      (r.genres?.length ? `<p><strong>Genre:</strong> ${esc(r.genres.join(', '))}</p>` : '') +
      (r.certification ? `<p><strong>Certificate:</strong> ${esc(r.certification)}</p>` : '') +
      (r.runtimeMinutes ? `<p><strong>Runtime:</strong> ${esc(r.runtimeMinutes)} min</p>` : '') +
      (r.rating != null ? `<p><strong>Rating:</strong> ${esc(r.rating.toFixed(1))}</p>` : ''),
    body:
      `<section><h2>What it's about</h2><p>${esc(r.synopsis)}</p></section>` +
      `<section><h2>Cast</h2><p>${esc(r.cast.join(' · '))}</p></section>` +
      (alsoThatWeek.length
        ? `<section><h2>${upcoming ? 'Also opening that week' : 'Also in cinemas that week'}</h2><ul>` +
          alsoThatWeek.map((x) => `<li>${esc(x.title)}</li>`).join('') +
          `</ul></section>`
        : ''),
  });
}

/**
 * Two pages may never claim the same path.
 *
 * Platform ids and language names are both flat slugs, which keeps the URLs
 * clean and means a future platform called "Hindi" — or a language whose name
 * matches a platform id — would silently overwrite one page with the other and
 * leave a link pointing at the wrong content. Cheaper to fail the build.
 */
const seen = new Set();
for (const pg of pages) {
  if (seen.has(pg.path)) throw new Error(`Two pages both claim /${pg.path}`);
  seen.add(pg.path);
}

for (const pg of pages) await renderPage(pg, pages);

/**
 * The sitemap now lists pages that genuinely exist.
 *
 * It used to advertise a URL per week when every one of them served the same
 * document — a crawler was offered seven URLs, found one behind them, and had
 * six entries' worth of reason to trust the file less. Each entry here has its
 * own path, its own prerendered content and its own canonical.
 */
const lastmod = feed.generatedAt.slice(0, 10);
const sitemap =
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
  pages
    .map(
      (pg) =>
        `  <url><loc>${esc(`${SITE_URL}/${pg.path}`)}</loc><lastmod>${lastmod}</lastmod>` +
        `<changefreq>weekly</changefreq><priority>${pg.path === '' ? '1.0' : pg.group === 'week' ? '0.5' : '0.8'}</priority></url>`,
    )
    .join('\n') +
  `\n</urlset>\n`;
await writeFile(resolve(ROOT, 'dist/sitemap.xml'), sitemap);

/**
 * Stamp each title page's slug onto its row in the shipped feed.
 *
 * The app resolves /ott-release-date/<slug> by looking for this field rather
 * than slugifying titles itself. Two implementations of the slug rule would
 * drift on the first title with a colon in it, and the failure would be
 * silent: the page exists, the link points at it, and the app renders nothing.
 */
await writeFile(FEED, JSON.stringify(feed));

/**
 * The same build id at a URL, because meta tags are unreachable on a phone.
 *
 * Confirming which build is live otherwise means view-source, which iOS Safari
 * does not offer — so the question "did my fix deploy?" got answered by
 * squinting at whether some visual change appeared, which is exactly the guess
 * this is meant to remove. Opening /build.txt answers it in a tab: a commit
 * means this build is live, a 404 means it is not.
 */
await writeFile(
  resolve(ROOT, 'dist/build.txt'),
  `commit ${buildSha}\nbuilt  ${new Date().toISOString()}\n`,
);

await writeFile(
  resolve(ROOT, 'dist/robots.txt'),
  `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`,
);

/**
 * The manifest names the app on a phone home screen, and it is a static file in
 * public/ — so it is the one remaining place the brand could be left stale after
 * a rename. Rewrite it here from the same constant rather than trust a copy.
 */
const MANIFEST = resolve(ROOT, 'dist/manifest.webmanifest');
const manifest = JSON.parse(await readFile(MANIFEST, 'utf8'));
manifest.name = `${BRAND} — ${HEADLINE}`;
manifest.short_name = BRAND;
await writeFile(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);

/**
 * The week's email, shipped where the Worker can read it.
 *
 * `npm run digest` writes email/ at the repo root, which is right for a human
 * pasting it into Gmail and useless to the Worker: the welcome message it
 * sends a new subscriber has to come from somewhere at request time, and the
 * only thing a Worker can read cheaply is its own asset bundle.
 *
 * Copying rather than moving the source of truth. The digest stays committed
 * at the root where the docs say it is, and this puts a copy behind
 * /email/ so env.ASSETS.fetch can reach it. It is rebuilt by the same refresh
 * that rebuilds the calendar, so the welcome mail is always the current week
 * without a second thing to remember.
 *
 * Carries noindex (see public/_headers): it is a mail body, not a page, and
 * the site has spent enough of today closing duplicate copies of itself.
 */
const EMAIL_SRC = resolve(ROOT, 'email');
const EMAIL_OUT = resolve(ROOT, 'dist', 'email');
let emailed = 0;
try {
  await mkdir(EMAIL_OUT, { recursive: true });
  for (const name of ['latest.html', 'latest.txt', 'subject.txt']) {
    await writeFile(resolve(EMAIL_OUT, name), await readFile(resolve(EMAIL_SRC, name), 'utf8'));
    emailed++;
  }
} catch {
  // A build on a checkout where the digest has never been generated should
  // still produce a site. The Worker treats a missing body as "no welcome
  // mail this time" rather than as a failed signup.
}

/**
 * Counted by walking the groups that exist rather than naming them.
 *
 * The hand-written version listed six groups and silently stopped adding up
 * the moment a seventh was added — it reported 126 pages and then itemised
 * 122, which is the kind of discrepancy nobody reads closely enough to catch.
 */
const byGroup = new Map();
for (const p of pages) byGroup.set(p.group, (byGroup.get(p.group) ?? 0) + 1);
const tallied = [...byGroup].map(([g, n]) => `${n} ${g}`).join(', ');
console.log(
  `SEO: build ${buildSha.slice(0, 8)}\n` +
    `     home titled "${title}" — ${rows.length} releases\n` +
    `     ${pages.length} pages: ${tallied}\n` +
    `     sitemap, robots.txt, JSON-LD with breadcrumbs` +
    (emailed ? `\n     ${emailed} email files for the welcome send` : `\n     no digest found — welcome mail will be skipped`),
);
