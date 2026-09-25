#!/usr/bin/env node
/**
 * Does search actually answer the promise the header makes?
 *
 * The box says "Search 1M+ titles". That is a claim about breadth, and the
 * only honest test of it is to type the things a reader would type. A single
 * probe for one well-known film proves the token works; it does not prove the
 * claim. Somebody looking for The Shawshank Redemption, Coolie and Pyaar Ka
 * Punchnama in the same session should find all three, or the header is
 * writing a cheque the route cannot cash.
 *
 * The interesting case is not the Hollywood one. It is transliteration: an
 * Indian title has no single correct spelling in Latin script, and a reader
 * types whatever they say out loud. "Punchnama" and "panchnama" are the same
 * film and the same word; TMDB's search is closer to exact than fuzzy, so
 * whether both find it is a question with an answer rather than an opinion.
 * That is why the pair is in this list.
 *
 * Reports rather than gates. A search that misses a spelling is a product
 * problem to fix in the route, not a reason to refuse to publish the site.
 *
 * Usage: SITE=https://newonott.in node scripts/search-probe.mjs
 *        QUERIES='coolie, jawan, 3 idiots' node scripts/search-probe.mjs
 */

const SITE = (process.env.SITE ?? 'https://newonott.in').replace(/\/$/, '');

/** What the claim has to cover, in the words a reader would use. Overridable,
 *  because the useful version of this question is usually "does it find the
 *  thing I just thought of" and that should not need an edit and a deploy. */
const QUERIES = process.env.QUERIES
  ? process.env.QUERIES.split(',').map((q) => q.trim()).filter(Boolean).map((q) => ({ q, why: 'asked for' }))
  : [
  { q: 'shawshank redemption', why: 'the world catalogue' },
  { q: 'coolie', why: 'South Indian, several films share the name' },
  { q: 'pyaar ka punchnama', why: 'Hindi, the spelling TMDB files it under' },
  { q: 'pyaar ka panchnama', why: 'Hindi, a spelling a person actually types' },
  { q: 'rajinikanth', why: 'a person, not a title' },
    ];

const ask = async ({ q, why }) => {
  try {
    const res = await fetch(`${SITE}/api/search?q=${encodeURIComponent(q)}`, {
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return { q, why, error: `HTTP ${res.status}` };
    const body = await res.json();
    if (body.degraded) return { q, why, error: 'degraded' };
    const results = body.results ?? [];
    return {
      q,
      why,
      count: results.length,
      total: body.total ?? results.length,
      top: results[0] ? (results[0].title ?? results[0].name ?? '?') : null,
    };
  } catch (err) {
    return { q, why, error: err.name === 'TimeoutError' ? 'timed out' : err.message };
  }
};

const rows = [];
for (const spec of QUERIES) rows.push(await ask(spec));

const pad = (s, n) => String(s).padEnd(n);
console.log(`\nSearch probe — ${SITE}\n`);
for (const r of rows) {
  const verdict = r.error
    ? `!! ${r.error}`
    : r.count === 0
      ? '   nothing'
      : `   ${r.count} shown of ${r.total} — top: ${r.top}`;
  console.log(`  ${pad(`"${r.q}"`, 26)}${verdict}`);
  console.log(`  ${pad('', 26)}   (${r.why})`);
}

const missed = rows.filter((r) => !r.error && r.count === 0);
const broke = rows.filter((r) => r.error);

if (broke.length) {
  console.log(
    `::warning title=The search route did not answer ${broke.length} of ${rows.length} probes::` +
      broke.map((r) => `"${r.q}" — ${r.error}`).join('; ') +
      '. A degraded answer means the binding exists but TMDB refused the credential or was unreachable.',
  );
}
if (missed.length) {
  console.log(
    `::warning title=Search found nothing for ${missed.length} of ${rows.length} things a reader would type::` +
      missed.map((r) => `"${r.q}"`).join(', ') +
      '. The header promises a million titles, so each of these is a case where it promises more than it returns. ' +
      'Spelling variants of Indian titles are the usual cause — the route passes the query to TMDB unchanged.',
  );
}
if (!broke.length && !missed.length) {
  console.log(`\n  all ${rows.length} probes found something.`);
}
