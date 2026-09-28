#!/usr/bin/env node
/**
 * Is this page worth spending a Request Indexing on?
 *
 * Search Console allows a handful of manual indexing requests a day and the
 * quota is the scarce thing — so the expensive mistake is not requesting the
 * wrong page, it is requesting a page Google will decline for a reason that
 * was visible beforehand. A URL that 404s, redirects, carries noindex, points
 * its canonical somewhere else or is disallowed by robots.txt will burn a
 * request and report nothing useful back.
 *
 * Every one of those is answerable from the live response, which is what this
 * asks. Against the live site rather than dist/, because what matters is what
 * Google fetches: a page can be perfect in the build and still be served
 * through a redirect or an edge rule that nobody remembers adding.
 *
 * Reports and does not gate. The point is a list somebody can paste into
 * Search Console with confidence, plus the reason for anything left out.
 *
 * Usage: SITE=https://newonott.in node scripts/indexable.mjs [paths...]
 */

const SITE = (process.env.SITE ?? 'https://newonott.in').replace(/\/$/, '');

/**
 * The default list, chosen by what each page opens up rather than by taste.
 *
 * Indexing a hub is worth more than indexing a title, because a crawled hub is
 * also a discovery path: Google follows what it finds there. These are the
 * pages carrying the most internal links to the 341 URLs sitting in
 * "Discovered – currently not indexed", plus the two that describe the site
 * itself. Ordered so that if the daily quota runs out halfway down, the ones
 * that got through are the ones that mattered.
 */
const DEFAULT = [
  '/',                        // the site itself
  '/streaming',               // 1,807 title links — the whole back catalogue
  '/releases/september-2026', // 201 — the current month
  '/web-series',              // 169
  '/south',                   // 166 — the market this quarter's work was for
  '/theatres',                // 173
  '/netflix',                 // 159
  '/hindi',                   // 140
  '/tamil',                   // 126
  '/prime',                   // 126
  '/malayalam',               // 116
  '/telugu',                  // 116
  '/jiohotstar',              // 109
];

const paths = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const list = paths.length ? paths : DEFAULT;

/* robots.txt decides before anything else does: a disallowed URL cannot be
   indexed however good the page is, and requesting it is guaranteed waste. */
const robots = await fetch(`${SITE}/robots.txt`)
  .then((r) => (r.ok ? r.text() : ''))
  .catch(() => '');
const disallowed = [...robots.matchAll(/^\s*Disallow:\s*(\S+)/gim)].map((m) => m[1]);

const check = async (p) => {
  const url = `${SITE}${p === '/' ? '/' : p}`;
  const blocked = disallowed.find((d) => d !== '/' && p.startsWith(d));
  if (blocked) return { p, url, why: `robots.txt disallows ${blocked}` };

  let res;
  try {
    /* manual, so a redirect is a finding rather than something followed
       silently — the redirected-to page is not the URL being requested. */
    res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(20_000) });
  } catch (e) {
    return { p, url, why: `unreachable (${e.name === 'TimeoutError' ? 'timed out' : e.message})` };
  }

  if (res.status >= 300 && res.status < 400) {
    return { p, url, why: `redirects (${res.status} → ${res.headers.get('location') ?? '?'})` };
  }
  if (!res.ok) return { p, url, why: `HTTP ${res.status}` };

  const html = await res.text();
  const robotsMeta = (html.match(/<meta[^>]+name=["']robots["'][^>]+content=["']([^"']+)/i) ?? [])[1] ?? '';
  if (/noindex/i.test(robotsMeta)) return { p, url, why: `meta robots says ${robotsMeta}` };
  if (/noindex/i.test(res.headers.get('x-robots-tag') ?? '')) {
    return { p, url, why: `X-Robots-Tag says ${res.headers.get('x-robots-tag')}` };
  }

  const canonical = (html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)/i) ?? [])[1] ?? '';
  /* A canonical pointing elsewhere is Google being told, by this page, to index
     a different one. Requesting it asks for something the page itself refuses. */
  if (canonical && canonical.replace(/\/$/, '') !== url.replace(/\/$/, '')) {
    return { p, url, why: `canonical points at ${canonical}` };
  }

  const title = (html.match(/<title>([^<]*)<\/title>/i) ?? [])[1] ?? '';
  const links = new Set([...html.matchAll(/href="(\/ott-release-date\/[a-z0-9-]+)"/g)].map((m) => m[1])).size;
  return { p, url, ok: true, title: title.trim(), links };
};

const rows = [];
for (const p of list) rows.push(await check(p));

const good = rows.filter((r) => r.ok);
const bad = rows.filter((r) => !r.ok);

console.log(`\nWorth requesting — ${SITE}\n`);
for (const r of good) {
  console.log(`  ${r.url}`);
  console.log(`      ${String(r.links).padStart(4)} title links · ${r.title.slice(0, 66)}`);
}

if (bad.length) {
  console.log(`\nLeave these out — a request would be wasted\n`);
  for (const r of bad) console.log(`  ${r.url}\n      ${r.why}`);
}

console.log(
  `\n${good.length} of ${rows.length} are ready to request.` +
    (bad.length ? ` ${bad.length} would be wasted.` : '') +
    '\nPaste each into Search Console → URL Inspection → Request Indexing, top down.' +
    '\nThe daily quota is small, so the order above is the order that matters.',
);
