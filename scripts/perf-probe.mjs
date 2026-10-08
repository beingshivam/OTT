/**
 * What a reader on a mid-range phone actually waits for.
 *
 * Written because "the now streaming page lags and is slow" could not be
 * answered from the repo. The catalogue loader's comment said the file was "a
 * quarter of a megabyte"; it was 1,475 KB. A measurement in a comment goes
 * stale silently, and this one had been load-bearing for the decision to
 * fetch the whole thing in one piece.
 *
 * Emulates the audience rather than this machine: a 390px viewport, 1.6 Mbps
 * down, 150ms latency, 4x CPU throttling, and gzip on text responses the way
 * Cloudflare serves them — without that last part every byte figure here
 * reads about five times too large. It also applies dist/_headers, so a
 * "repeat view" measures caching rather than its absence.
 *
 * Timings move with the machine, so treat them as before-and-after on one
 * host rather than absolute numbers. The byte counts are stable, and the
 * eval has a budget for the one that matters.
 *
 * Run: npm run perf  (CHROMIUM_PATH=... in this sandbox)
 */
import { createServer } from 'node:http';
import { gzipSync } from 'node:zlib';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { chromium } from 'playwright';

const DIST = '/home/user/OTT/dist';
const TYPES = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.svg':'image/svg+xml', '.png':'image/png', '.webp':'image/webp', '.txt':'text/plain', '.xml':'application/xml' };
// The edge's own caching rules, so a "repeat view" measurement means
// something. Without this the probe served no Cache-Control at all and every
// second visit re-downloaded everything, which would have hidden the fix.
const headerRules = [];
{
  const text = await readFile(join(DIST, '_headers'), 'utf8').catch(() => '');
  let current = null;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (!line || line.trimStart().startsWith('#')) continue;
    if (!line.startsWith(' ') && !line.startsWith('\t')) { current = { path: line.trim(), headers: {} }; headerRules.push(current); }
    else if (current) { const i = line.indexOf(':'); if (i > 0) current.headers[line.slice(0, i).trim()] = line.slice(i + 1).trim(); }
  }
}
const headersFor = (path) => {
  const out = {};
  for (const r of headerRules) {
    const re = new RegExp('^' + r.path.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
    if (re.test(path)) Object.assign(out, r.headers);
  }
  return out;
};

const server = createServer(async (req, res) => {
  const path = decodeURIComponent(req.url.split('?')[0]);
  for (const p of [join(DIST, path), join(DIST, path, 'index.html')]) {
    try {
      let body = await readFile(p);
      const extra = {};
      // Cloudflare compresses text responses; measuring uncompressed would
      // have overstated every byte figure here by roughly five times.
      if (/\.(html|js|css|json|svg|txt|xml)$/.test(p) && /\bgzip\b/.test(req.headers['accept-encoding'] ?? '')) {
        body = gzipSync(body);
        extra['content-encoding'] = 'gzip';
      }
      res.writeHead(200, { 'content-type': TYPES[extname(p)] ?? 'application/octet-stream', ...extra, ...headersFor(path) });
      return res.end(body);
    } catch {}
  }
  res.writeHead(404); res.end('nope');
});
const port = await new Promise((ok) => server.listen(0, () => ok(server.address().port)));

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
// A mid-range Indian phone on 4G, which is 86% of this site's traffic.
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const client = await ctx.newCDPSession(page);
await client.send('Network.emulateNetworkConditions', { offline: false, downloadThroughput: 1.6e6/8, uploadThroughput: 750e3/8, latency: 150 });
await client.send('Emulation.setCPUThrottlingRate', { rate: 4 });

const bytes = new Map();
page.on('console', (c) => { if (c.type() === 'error') console.log('  console error:', c.text().slice(0,120)); });
page.on('response', async (r) => {
  try { const b = (await r.body()).length; bytes.set(r.url().replace(/^https?:\/\/[^/]+/, ''), b); } catch {}
});

for (const route of process.argv.slice(2)) {
  bytes.clear();
  const t0 = Date.now();
  await page.goto(`http://localhost:${port}${route}`, { waitUntil: 'load' });
  const loaded = Date.now() - t0;
  // When a reader can actually see the grid, not a fixed sleep.
  let content = null;
  try {
    await page.waitForFunction(() => document.images.length > 8, null, { timeout: 30000 });
    content = Date.now() - t0;
  } catch { content = null; }
  await page.waitForTimeout(1500);
  const settled = Date.now() - t0;
  const m = await page.evaluate(() => ({
    text: (document.querySelector('main')?.innerText ?? '').slice(0, 120).replace(/\n/g, ' / '),
    nodes: document.getElementsByTagName('*').length,
    imgs: document.images.length,
    lazy: [...document.images].filter((i) => i.loading === 'lazy').length,
    lcp: performance.getEntriesByType('largest-contentful-paint').at(-1)?.startTime ?? null,
    long: performance.getEntriesByType('longtask')?.length ?? 'n/a',
  }));
  const top = [...bytes].sort((a,b) => b[1]-a[1]).slice(0,5);
  const total = [...bytes.values()].reduce((a,b)=>a+b,0);
  console.log(`\n== ${route} ==`);
  console.log(`  load ${loaded}ms | CONTENT VISIBLE ${content ?? 'never'}ms | settled ${settled}ms`);
  console.log(`  DOM nodes ${m.nodes} | images ${m.imgs} (lazy ${m.lazy})`);
  console.log(`  main says: ${m.text}`);
  console.log(`  transferred ${(total/1024).toFixed(0)} KB over ${bytes.size} requests`);
  for (const [u,b] of top) console.log(`    ${(b/1024).toFixed(0).padStart(6)} KB  ${u.slice(0,60)}`);
}

// What a second view costs, which is what in-app navigation feels like.
bytes.clear();
const t1 = Date.now();
await page.goto(`http://localhost:${port}/`, { waitUntil: 'load' });
await page.goto(`http://localhost:${port}/streaming`, { waitUntil: 'load' });
await page.waitForFunction(() => document.images.length > 8, null, { timeout: 30000 }).catch(() => {});
console.log(`\n== repeat view (home then /streaming, warm cache) ==`);
console.log(`  ${Date.now() - t1}ms | ${([...bytes.values()].reduce((a,b)=>a+b,0)/1024).toFixed(0)} KB over ${bytes.size} requests`);
await browser.close(); server.close();
