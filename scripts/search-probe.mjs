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
 * WHAT COUNTS AS FINDING SOMETHING. This used to be "the result set is not
 * empty", and that let the worst live bug in the route through with a clean
 * report. "tumbad" came back with six results, so the probe printed all ten
 * probes found something; the top result was a Spanish music documentary
 * called Corridos Tumbados and Tumbbad was nowhere in the set. A probe whose
 * bar is non-emptiness cannot tell the difference between an answer and a
 * coincidence, which is the only difference worth measuring here.
 *
 * So two bars. Named probes carry the title they must return, which is ground
 * truth stated by hand rather than inferred. Ad-hoc probes get the weaker but
 * still useful test: does anything in the set share a whole word with what was
 * typed. That test is written out again here rather than imported from the
 * Worker on purpose — a probe that reuses the route's own judgement of a good
 * answer would agree with it about a wrong one.
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
  { q: 'shawshank redemption', why: 'the world catalogue', expect: 'The Shawshank Redemption' },
  { q: 'coolie', why: 'South Indian, several films share the name', expect: 'Coolie' },
  { q: 'pyaar ka punchnama', why: 'Hindi, the spelling TMDB files it under', expect: 'Pyaar Ka Punchnama' },
  { q: 'pyaar ka panchnama', why: 'Hindi, a spelling a person actually types', expect: 'Pyaar Ka Punchnama' },
  /* The case the old bar could not see: results, but not the film. Kept as a
     named probe because it is the one that proved non-emptiness was the wrong
     question. */
  { q: 'tumbad', why: 'the plainer spelling of a title TMDB files doubled', expect: 'Tumbbad' },
  { q: 'rajinikanth', why: 'a person, not a title', expect: 'Rajinikanth' },
    ];

/** A whole word both sides share, four letters or more. Restated rather than
 *  imported — see the header. Four because shorter words are the ones every
 *  title has in common. */
const shares = (q, titles) => {
  const words = (s) =>
    new Set(
      String(s ?? '')
        .toLowerCase()
        .split(/\s+/)
        .flatMap((w) => [w.replace(/[^a-z0-9]/g, ''), ...w.split(/[^a-z0-9]+/)])
        .filter((w) => w.length >= 4),
    );
  const want = words(q);
  if (!want.size) return true;
  return titles.some((t) => [...words(t)].some((w) => want.has(w)));
};

const ask = async ({ q, why, expect }) => {
  try {
    const res = await fetch(`${SITE}/api/search?q=${encodeURIComponent(q)}`, {
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return { q, why, error: `HTTP ${res.status}` };
    const body = await res.json();
    if (body.degraded) return { q, why, error: 'degraded' };
    const results = body.results ?? [];
    const titles = results.map((r) => r.title ?? r.name ?? '');
    return {
      q,
      why,
      count: results.length,
      total: body.total ?? results.length,
      top: titles[0] || null,
      relaxedTo: body.relaxedTo ?? null,
      /* Named probes are judged against the title stated above. Everything
         else gets the weaker word-sharing test. Either way a set full of
         coincidences reads as a miss. */
      wrong: expect
        ? !titles.some((t) => t.toLowerCase() === expect.toLowerCase())
        : results.length > 0 && !shares(q, titles),
      expect: expect ?? null,
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
      : `${r.wrong ? ' ??' : '   '} ${r.count} shown of ${r.total} — top: ${r.top}`;
  console.log(`  ${pad(`"${r.q}"`, 26)}${verdict}`);
  console.log(`  ${pad('', 26)}   (${r.why}${r.relaxedTo ? `, read as "${r.relaxedTo}"` : ''})`);
  if (r.wrong) {
    console.log(
      `  ${pad('', 26)}   ${r.expect ? `expected ${r.expect}, not in the set` : 'nothing here shares a word with the query'}`,
    );
  }
}

const missed = rows.filter((r) => !r.error && r.count === 0);
const wrong = rows.filter((r) => !r.error && r.count > 0 && r.wrong);
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
if (wrong.length) {
  console.log(
    `::warning title=Search answered ${wrong.length} of ${rows.length} probes with something that is not the thing::` +
      wrong.map((r) => `"${r.q}" → ${r.top}${r.expect ? ` (wanted ${r.expect})` : ''}`).join('; ') +
      '. This is the failure an empty-set check cannot see: the reader gets a full page of results and none of them ' +
      'is what they typed, which reads as a worse answer than nothing because it looks like a considered one.',
  );
}
if (!broke.length && !missed.length && !wrong.length) {
  console.log(`\n  all ${rows.length} probes returned the title they were asked for.`);
}
