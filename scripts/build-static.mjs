#!/usr/bin/env node
/**
 * The pages that are not the app: news articles and the pages that say who
 * runs this site.
 *
 * Runs after build-seo. Every page here is a complete document of its own —
 * no app bundle, nothing that mounts over it — because an article and an
 * editorial policy are things to read, and the one guarantee worth having is
 * that the HTML Google fetches is exactly what a reader gets. Same approach
 * as /diag.
 *
 * Why these exist at all (the plan agreed on 13 Nov):
 *
 *   News. For Indian entertainment, Google Discover and Top Stories carry far
 *   more traffic than the ten blue links, and both want news articles: a
 *   headline, a date, a byline, a large image, NewsArticle markup. The
 *   refresh drafts one when a film's OTT date is announced
 *   (scripts/news-draft.mjs); nothing here is published until a person flips
 *   it (scripts/news-publish.mjs, or the "Publish article" workflow). Mass
 *   auto-published articles are scaled content in Google's spam policy, and
 *   the review step is what keeps this on the right side of it.
 *
 *   Trust. A site with no named people, no policy and no contact page reads
 *   to Google's quality raters as nobody's. /about, /editorial-policy and
 *   /contact say who, how and where.
 */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BRAND, CONTACT_EMAIL, INSTAGRAM_URL } from './brand.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = resolve(ROOT, 'dist');
const SITE = 'https://newonott.in';
const NEWS_DIR = resolve(ROOT, process.env.NEWS_DIR ?? 'data/news');

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const day = (iso) => {
  const d = new Date(iso);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};

const info = JSON.parse(await readFile(resolve(ROOT, 'data/site-info.json'), 'utf8').catch(() => '{}'));
const DESK = info.desk ?? `${BRAND} Desk`;
const EDITOR = info.editor?.name ?? null;

/* The publisher, identical on every page that names it. */
const ORGANIZATION = {
  '@type': 'Organization',
  '@id': `${SITE}/#organization`,
  name: BRAND,
  url: `${SITE}/`,
  logo: { '@type': 'ImageObject', url: `${SITE}/icon-512.png`, width: 512, height: 512 },
  email: CONTACT_EMAIL,
  sameAs: [INSTAGRAM_URL],
};

const NAV = [
  ['/', 'Home'],
  ['/news', 'News'],
  ['/upcoming', 'Upcoming'],
  ['/about', 'About'],
  ['/editorial-policy', 'Editorial policy'],
  ['/contact', 'Contact'],
];

function page({ path, title, description, body, jsonLd, image, type = 'website' }) {
  const canonical = `${SITE}${path}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)} | ${esc(BRAND)}</title>
<meta name="description" content="${esc(description)}" />
<meta name="robots" content="max-image-preview:large" />
<link rel="canonical" href="${canonical}" />
<link rel="icon" href="/icon.svg" type="image/svg+xml" />
<meta property="og:type" content="${type}" />
<meta property="og:site_name" content="${esc(BRAND)}" />
<meta property="og:title" content="${esc(title)}" />
<meta property="og:description" content="${esc(description)}" />
<meta property="og:url" content="${canonical}" />
<meta property="og:image" content="${esc(image ?? `${SITE}/og.png`)}" />
<meta name="twitter:card" content="summary_large_image" />
<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@graph': [ORGANIZATION, ...jsonLd] }).replace(/</g, '\\u003c')}</script>
<style>
:root{color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;background:#0b0c10;color:#e8eaf0;font:17px/1.65 Inter,system-ui,-apple-system,"Segoe UI",sans-serif}
a{color:#ffb03a}
header,main,footer{max-width:760px;margin:0 auto;padding:0 18px}
header{display:flex;flex-wrap:wrap;gap:14px;align-items:center;padding-top:18px;padding-bottom:10px;border-bottom:1px solid #1d2130}
header .brand{font-weight:800;color:#fff;text-decoration:none;margin-right:auto}
header nav a{color:#c9cfdb;text-decoration:none;font-size:15px;margin-left:12px;white-space:nowrap}
h1{font-size:clamp(28px,6vw,40px);line-height:1.15;letter-spacing:-.02em;margin:28px 0 10px}
h2{font-size:22px;margin:30px 0 8px}
.dek{font-size:19px;color:#c9cfdb;margin:0 0 14px}
.meta{font-size:14px;color:#8d94a4;margin-bottom:18px}
.hero{width:100%;height:auto;border-radius:12px;display:block;aspect-ratio:16/9;object-fit:cover;background:#151926}
.cta{display:inline-block;margin:18px 0;padding:12px 18px;border-radius:999px;background:#ffb03a;color:#0b0c10;font-weight:800;text-decoration:none}
.source{font-size:14px;color:#8d94a4;border-top:1px solid #1d2130;padding-top:12px;margin-top:26px}
ul.list{padding-left:0;list-style:none}
ul.list li{padding:12px 0;border-bottom:1px solid #1d2130}
ul.list .when{display:block;font-size:13px;color:#8d94a4}
footer{padding-top:30px;padding-bottom:40px;font-size:14px;color:#8d94a4}
footer a{color:#c9cfdb;margin-right:14px}
</style>
</head>
<body>
<header><a class="brand" href="/">${esc(BRAND)}</a><nav>${NAV.slice(1)
    .map(([href, label]) => `<a href="${href}">${esc(label)}</a>`)
    .join('')}</nav></header>
<main>
${body}
</main>
<footer>${NAV.map(([href, label]) => `<a href="${href}">${esc(label)}</a>`).join('')}
<p>${esc(BRAND)} lists releases and where to watch them; it does not stream anything. Film data from TMDB.</p></footer>
</body>
</html>
`;
}

async function write(path, html) {
  const dir = resolve(DIST, `.${path}`);
  await mkdir(dir, { recursive: true });
  await writeFile(resolve(dir, 'index.html'), html);
}

// ---------------------------------------------------------------- news --

const files = await readdir(NEWS_DIR).catch(() => []);
const articles = [];
for (const f of files.filter((n) => n.endsWith('.json'))) {
  const a = JSON.parse(await readFile(resolve(NEWS_DIR, f), 'utf8'));
  if (a.status === 'published' && a.publishedAt) articles.push(a);
}
articles.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));

const byline = (a) => a.author ?? EDITOR ?? DESK;

for (const a of articles) {
  const path = `/news/${a.slug}`;
  const body =
    `<article>` +
    `<h1>${esc(a.headline)}</h1>` +
    `<p class="dek">${esc(a.dek)}</p>` +
    `<p class="meta">By <a href="/about">${esc(byline(a))}</a> · Published ${esc(day(a.publishedAt))}` +
    (a.updatedAt && a.updatedAt > a.publishedAt ? ` · Updated ${esc(day(a.updatedAt))}` : '') +
    `</p>` +
    (a.image ? `<img class="hero" src="${esc(a.image)}" alt="${esc(a.imageAlt ?? a.headline)}" width="1280" height="720" />` : '') +
    a.paragraphs.map((p) => `<p>${esc(p)}</p>`).join('') +
    (a.titleSlug ? `<a class="cta" href="/ott-release-date/${esc(a.titleSlug)}">Where to watch ${esc(a.title)} →</a>` : '') +
    (a.source ? `<p class="source">Source: ${esc(a.source)}</p>` : '') +
    `</article>`;
  const jsonLd = [
    {
      '@type': 'NewsArticle',
      '@id': `${SITE}${path}#article`,
      mainEntityOfPage: `${SITE}${path}`,
      headline: a.headline.slice(0, 110),
      description: a.dek,
      ...(a.image ? { image: [a.image] } : {}),
      datePublished: a.publishedAt,
      dateModified: a.updatedAt ?? a.publishedAt,
      author: EDITOR && !a.author
        ? { '@type': 'Person', name: EDITOR, url: `${SITE}/about` }
        : { '@type': 'Organization', name: byline(a), url: `${SITE}/about` },
      publisher: { '@id': `${SITE}/#organization` },
      ...(a.titleSlug ? { about: { '@id': `${SITE}/ott-release-date/${a.titleSlug}#title` } } : {}),
    },
  ];
  await write(path, page({ path, title: a.headline, description: a.dek, body, jsonLd, image: a.image, type: 'article' }));
}

await write(
  '/news',
  page({
    path: '/news',
    title: 'OTT release date news — India',
    description: 'OTT release dates as they are announced: which film lands on which platform, when, and how fast it got there.',
    body:
      `<h1>OTT release date news</h1><p class="dek">Announced OTT release dates for Indian films and shows, checked against the platform's own listing.</p>` +
      (articles.length
        ? `<ul class="list">${articles
            .map((a) => `<li><a href="/news/${esc(a.slug)}">${esc(a.headline)}</a><span class="when">${esc(day(a.publishedAt))}</span></li>`)
            .join('')}</ul>`
        : `<p>No articles yet. Every new OTT release is on the <a href="/">calendar</a> the day it is listed.</p>`),
    jsonLd: [],
  }),
);

/* The news sitemap: Google News reads articles from the last two days only. */
const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000).toISOString();
const fresh = articles.filter((a) => a.publishedAt >= twoDaysAgo);
await writeFile(
  resolve(DIST, 'news-sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">\n` +
    fresh
      .map(
        (a) =>
          `  <url><loc>${SITE}/news/${esc(a.slug)}</loc><news:news><news:publication><news:name>${esc(BRAND)}</news:name><news:language>en</news:language></news:publication><news:publication_date>${esc(a.publishedAt)}</news:publication_date><news:title>${esc(a.headline)}</news:title></news:news></url>`,
      )
      .join('\n') +
    `\n</urlset>\n`,
);

/* And the latest few for the app's browse links. */
await writeFile(
  resolve(DIST, 'data/news.json'),
  JSON.stringify({ articles: articles.slice(0, 8).map((a) => ({ slug: a.slug, headline: a.headline, publishedAt: a.publishedAt })) }),
);

// --------------------------------------------------------------- trust --

const editorLine = EDITOR
  ? `<p>${esc(BRAND)} is edited by <strong>${esc(EDITOR)}</strong>${info.editor?.bio ? ` — ${esc(info.editor.bio)}` : ''}.</p>`
  : `<p>${esc(BRAND)} is run by an independent editorial desk in India.</p>`;

await write(
  '/about',
  page({
    path: '/about',
    title: `About ${BRAND}`,
    description: `Who runs ${BRAND}, what it covers and where its information comes from.`,
    body:
      `<h1>About ${esc(BRAND)}</h1>` +
      `<p class="dek">Every new release on every Indian streaming platform and in cinemas — and where to watch it — on one page, updated every day.</p>` +
      editorLine +
      `<h2>What we cover</h2><p>New films and series across Netflix, Prime Video, JioHotstar, SonyLIV, ZEE5, Sun NXT, aha, hoichoi and more, plus what is in Indian cinemas. For films still in cinemas we show when they are likely to reach OTT, measured from how long similar films actually took.</p>` +
      `<h2>Where the information comes from</h2><p>Release dates and streaming availability come from TMDB and the platforms' own listings, re-checked every day. We say when a date is announced but not yet confirmed by the platform, and when a date is our estimate rather than an announcement. See the <a href="/editorial-policy">editorial policy</a>.</p>` +
      `<h2>Contact</h2><p>Corrections and questions: <a href="mailto:${esc(CONTACT_EMAIL)}">${esc(CONTACT_EMAIL)}</a> · <a href="${esc(INSTAGRAM_URL)}">Instagram</a>.</p>`,
    jsonLd: [{ '@type': 'AboutPage', url: `${SITE}/about`, about: { '@id': `${SITE}/#organization` } }],
  }),
);

await write(
  '/editorial-policy',
  page({
    path: '/editorial-policy',
    title: 'Editorial policy',
    description: `How ${BRAND} sources, labels and corrects OTT release dates.`,
    body:
      `<h1>Editorial policy</h1>` +
      `<h2>Sources</h2><p>A streaming date is stated as fact only when the platform lists the title in India (via TMDB's provider data). A date taken from a release announcement is labelled as announced until the platform confirms it. Every page is re-checked daily.</p>` +
      `<h2>Estimates</h2><p>For films still in cinemas we publish an expected OTT window. It is always labelled as an estimate, always shown beside "not announced", and always names the evidence: how many recent films in the same language it is based on, and their typical gap between cinema and OTT.</p>` +
      `<h2>News articles</h2><p>Articles are drafted from confirmed data and reviewed by a person before publication. We do not publish rumours, leaked dates or unattributed claims.</p>` +
      `<h2>Ratings</h2><p>Audience scores come from IMDb or TMDB, are attributed to their source, and are hidden until enough people have voted for them to mean something.</p>` +
      `<h2>Corrections</h2><p>Spotted a wrong date or platform? Email <a href="mailto:${esc(CONTACT_EMAIL)}">${esc(CONTACT_EMAIL)}</a>. Corrections are made the same day and noted on the article.</p>` +
      `<h2>Independence</h2><p>${esc(BRAND)} is not affiliated with any streaming platform or studio. Some links to platforms may be affiliate links; they never decide what we list or how.</p>`,
    jsonLd: [],
  }),
);

await write(
  '/contact',
  page({
    path: '/contact',
    title: `Contact ${BRAND}`,
    description: `Reach ${BRAND} for corrections, questions and press.`,
    body:
      `<h1>Contact</h1>` +
      `<p>Email: <a href="mailto:${esc(CONTACT_EMAIL)}">${esc(CONTACT_EMAIL)}</a></p>` +
      `<p>Instagram: <a href="${esc(INSTAGRAM_URL)}">${esc(INSTAGRAM_URL.replace('https://www.', ''))}</a></p>` +
      `<p>For a wrong date or platform, include the page link — we fix it the same day.</p>`,
    jsonLd: [{ '@type': 'ContactPage', url: `${SITE}/contact`, about: { '@id': `${SITE}/#organization` } }],
  }),
);

/* Into the main sitemap, so the new pages are found from day one. */
const sitemapPath = resolve(DIST, 'sitemap.xml');
const sitemap = await readFile(sitemapPath, 'utf8').catch(() => null);
if (sitemap) {
  const extra = ['/news', '/about', '/editorial-policy', '/contact', ...articles.map((a) => `/news/${a.slug}`)]
    .filter((p) => !sitemap.includes(`<loc>${SITE}${p}</loc>`))
    .map((p) => `  <url><loc>${SITE}${p}</loc></url>`)
    .join('\n');
  if (extra) await writeFile(sitemapPath, sitemap.replace('</urlset>', `${extra}\n</urlset>`));
}
const robotsPath = resolve(DIST, 'robots.txt');
const robots = await readFile(robotsPath, 'utf8').catch(() => null);
if (robots && !robots.includes('news-sitemap.xml')) {
  await writeFile(robotsPath, `${robots.trimEnd()}\nSitemap: ${SITE}/news-sitemap.xml\n`);
}

console.log(`Static pages: ${articles.length} article(s), /news, /about, /editorial-policy, /contact, news-sitemap.xml`);
