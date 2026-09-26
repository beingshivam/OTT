/**
 * The one thing that runs at request time.
 *
 * Everything else about this site is a file: the release feed is JSON built at
 * deploy time, the board is static markup, and no request touches a database.
 * That was worth protecting, so this Worker does as close to nothing as it can
 * — every path but one is handed straight back to the static assets, and the
 * one exception writes a single row.
 *
 * Why a Worker at all, when a hosted form service is a link and a paste: the
 * free tiers that used to make that true have mostly closed. What remains is
 * either a hundred-subscriber ceiling, a monthly submission cap, or a trial.
 * Cloudflare's free tier already hosts this site, and one D1 row per sign-up is
 * inside it by three orders of magnitude — so the list lives here, and nothing
 * about it can be repriced out from under a product that has no revenue.
 *
 * The trade is real and worth stating: an address someone gives you is theirs,
 * not yours. Storing it here means honouring deletion by hand (see
 * docs/email-setup.md) and keeping the table out of anything public. What it
 * buys is that the list is a table you own and can export in one command,
 * rather than an account that can be closed.
 *
 * Written in JavaScript on purpose. tsconfig only includes src/, so a .ts file
 * here would need @cloudflare/workers-types and a second tsconfig to typecheck
 * — a dependency and a build step for forty lines of request handling.
 */

/** Deliberately permissive. The job is to reject typos and junk, not to
 *  adjudicate RFC 5322 — an over-strict pattern turns away real addresses,
 *  which is a worse failure than storing one that bounces. */
const LOOKS_LIKE_EMAIL = /^[^\s@]+@[^\s@.]+\.[^\s@]{2,}$/;

/** A body larger than this is not a sign-up. Read as text first so an
 *  attacker cannot make us buffer a stream of arbitrary length. */
const MAX_BODY = 2048;

/**
 * `no-store` by default, and that default is the safe one.
 *
 * Everything this file answered until now was a subscription result or a
 * diagnostic — responses that must never be reused for the next person.
 * Search is the first cacheable answer here, so the exception is opt-in and
 * per-call rather than a new default nobody would notice changing.
 */
const json = (status, body, maxAge) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': maxAge ? `public, max-age=${maxAge}` : 'no-store',
    },
  });

/**
 * TMDB artwork, re-served from our own origin.
 *
 * The share card draws posters onto a canvas, and a canvas that has drawn a
 * cross-origin image cannot be read back unless the server said it could.
 * image.tmdb.org does not: proved by simulating both policies against a real
 * Chromium — with the header the poster draws in every cache state, without it
 * the load fails every time, and no client-side trick changes that. The picture
 * came out as coloured gradients on the live site, which is the fallback doing
 * its job and not the design anybody wanted.
 *
 * So the bytes come through here instead, which makes them same-origin and the
 * question moot. Only the share card uses this — the posters on the page are
 * plain <img> tags that never touch a canvas and have no reason to pay for a
 * hop.
 *
 * Narrow on purpose. An open proxy is somebody else's bandwidth bill and a way
 * into networks that trust this origin, so the path has to look exactly like a
 * TMDB image path and nothing else is forwarded: no query string, no client
 * headers, no cookies, no methods but GET and HEAD.
 */
const TMDB_IMAGE = /^\/img\/(w\d{2,4}|original)\/([A-Za-z0-9_-]{8,64}\.(?:jpg|png|webp|svg))$/;

async function proxyPoster(request, url) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return json(405, { error: 'method_not_allowed' });
  }
  const match = url.pathname.match(TMDB_IMAGE);
  if (!match) return json(404, { error: 'not_an_image_path' });

  const [, size, file] = match;
  const upstream = await fetch(`https://image.tmdb.org/t/p/${size}/${file}`, {
    method: request.method,
    // Cloudflare caches this at the edge, so a popular poster is fetched from
    // TMDB once rather than once per person who shares the week.
    cf: { cacheEverything: true, cacheTtl: 86_400 },
  });

  if (!upstream.ok) return json(upstream.status === 404 ? 404 : 502, { error: 'upstream' });

  const headers = new Headers();
  headers.set('content-type', upstream.headers.get('content-type') ?? 'image/jpeg');
  // TMDB paths are content-addressed: the same path is always the same image.
  headers.set('cache-control', 'public, max-age=31536000, immutable');
  return new Response(upstream.body, { status: 200, headers });
}

/**
 * Search, over everything TMDB has rather than everything we ship.
 *
 * The site's own search reads what the browser has already loaded — the
 * calendar and the back catalogue, 963 titles — and knows no people at all.
 * So "Rajinikanth" found nothing unless his name happened to sit in a cast
 * list on the current page, on a site about Indian film.
 *
 * The fix is a proxy, not a database. TMDB already holds the corpus and
 * already answers /search/multi with films, series and people in one call. A
 * copy of a million rows here would need storing, syncing and reconciling, and
 * would be a worse copy of the thing it copied from the day after it landed.
 *
 * What this deliberately does NOT do is give those titles pages. A million
 * generated pages with nothing to say about them is the shape Google's
 * helpful-content system demotes, and it would drag down the 318 pages that
 * are genuinely good. Search reaches everything; publishing stays earned.
 *
 * ---------------------------------------------------------------------------
 * Degrading honestly
 *
 * With no TMDB_TOKEN bound this returns `remote: false` and an empty list
 * rather than an error, so the local half of the search still renders and the
 * page works. The front end reads that flag in its empty state — "Nothing on
 * New on OTT matches X" rather than a flat "Nothing matches", which would be a
 * far bigger claim than the site could stand behind.
 *
 * The token is bound to this Worker, separately from the one the refresh uses
 * in Actions — docs/search-setup.md has the step, and /api/watchdog reports
 * whether it landed, since a missing secret is otherwise indistinguishable
 * from a search that found nothing.
 */
const SEARCH_TTL = 3600;

/**
 * The query as typed, then progressively less of it.
 *
 * TMDB's /search/multi requires every token to land. One word it does not
 * recognise returns nothing at all rather than fewer results, and measuring it
 * against the live index showed how sharp that edge is:
 *
 *   jawan              65 results        jawan movie        nothing
 *   coolie             27 results        coolie 2025        nothing
 *   punchnama           2 results        pyar punchnama     nothing
 *
 * So the commonest way to get nothing out of a million titles is not an exotic
 * query — it is typing the word "movie" after the name, or the year you think
 * it came out, or one vowel of a transliterated title differently from
 * whoever filed it. Every one of those reads to the person typing as "this
 * site does not have it", under a header promising it does.
 *
 * Two fallbacks, tried only when the query as typed found nothing, so the
 * common case still costs exactly one call:
 *
 *   1. Drop the words that are never part of a title — movie, trailer, a bare
 *      year — and ask again.
 *   2. Ask for the longest remaining word alone. In a title someone half
 *      remembers, the longest word is almost always the distinctive one, and
 *      TMDB is far more forgiving of a single token than of a phrase.
 *
 * What this deliberately cannot rescue is a word TMDB has never heard —
 * "panchnama" for "punchnama" is a real spelling of a real film and returns
 * nothing at any length. Fixing that needs generated transliteration variants,
 * which is a larger and much riskier change than this one, and worth doing
 * only once this has shown what is left.
 */
const NOISE = new Set([
  'movie', 'movies', 'film', 'films', 'series', 'show', 'shows',
  'trailer', 'teaser', 'full', 'hd', 'online', 'watch', 'streaming',
]);

export function relaxations(q) {
  const tokens = q.split(/\s+/).filter(Boolean);
  const kept = tokens.filter(
    (t) => !NOISE.has(t.toLowerCase().replace(/[^a-z0-9]/g, '')) && !/^(19|20)\d{2}$/.test(t),
  );

  const out = [q];
  if (kept.length && kept.length !== tokens.length) out.push(kept.join(' '));
  /* Only worth asking for one word when there was more than one; a single
     token that already failed will fail again. */
  if (kept.length > 1) {
    out.push(kept.reduce((a, b) => (b.length > a.length ? b : a)));
  }
  return [...new Set(out)];
}

/**
 * The word somebody typed, spelled the other ways it gets spelled.
 *
 * This is the gap the relaxations above were written knowing they could not
 * close, and the comment there said as much: "panchnama" for "punchnama" is a
 * real spelling of a real film and returns nothing at any length, because
 * TMDB's search is close to exact and no amount of dropping words rescues a
 * word it has never seen.
 *
 * It is not a typo. An Indian title has no single correct romanisation — the
 * film is पुँछनामा, and Latin script is a transcription somebody chose. TMDB
 * has one of those choices on file and the reader has another, and both are
 * right. On a site whose whole audience types Hindi, Tamil and Telugu titles
 * in Latin letters, treating that as user error is the wrong model.
 *
 * So: equivalence classes, not edit distance. Levenshtein would reach
 * "punchnama" from "panchnama" and also reach fifty words nobody meant, and a
 * confident wrong answer is worse than an empty one — that rule has decided
 * several things on this site already. These are the substitutions that
 * romanisation actually varies on, and nothing else:
 *
 *   a ↔ u     the schwa. Hindi's inherent vowel lands between the two and
 *             transcribers disagree; this is the reported case, and the
 *             single most common source of a missed Indian title.
 *   aa ↔ a    long vowels people double, or don't
 *   ee ↔ i    Geet / Giit
 *   oo ↔ u    Noor / Nur
 *   ph ↔ f    Phir / Fir
 *   v ↔ w     Vivah / Wiwah
 *   z ↔ j     Zindagi / Jindagi
 *   ksh ↔ x   Lakshmi / Laxmi
 *   doubles   Tumbbad / Tumbad
 *   final a   Rama / Ram
 *
 * One class at a time, never combined. Two simultaneous substitutions is
 * where the false positives live, and the ranking above means the likeliest
 * single change is tried first. Round-robin across the classes rather than
 * exhausting each in turn, so a word full of a's cannot spend the whole
 * budget on its own schwa before the f and the w get a turn.
 *
 * Four letters and up. Geet, Noor and Phir are all real titles and all four
 * letters, so a higher floor would have excluded the very examples above;
 * below four a single substitution stops being transcription and starts
 * being a different word.
 */
const SPELLINGS = [
  [/a/g, 'u'],
  [/u/g, 'a'],
  [/aa/g, 'a'],
  [/a/g, 'aa'],
  [/ee/g, 'i'],
  [/i/g, 'ee'],
  [/oo/g, 'u'],
  [/ph/g, 'f'],
  [/f/g, 'ph'],
  [/v/g, 'w'],
  [/w/g, 'v'],
  [/z/g, 'j'],
  [/j/g, 'z'],
  [/ksh/g, 'x'],
  [/x/g, 'ksh'],
  [/([bcdfgklmnprstz])\1/g, '$1'],
];

/** Enough to cover the classes above without turning one miss into a burst of
 *  upstream calls. Tuned against real queries, not picked. */
const MAX_SPELLINGS = 8;
const MIN_SPELLABLE = 4;

export function spellings(word, limit = MAX_SPELLINGS) {
  const w = (word ?? '').toLowerCase();
  if (w.length < MIN_SPELLABLE || !/^[a-z]+$/.test(w)) return [];

  /* Per class: each single occurrence on its own, then all of them together.
     "panchnama" under a→u gives punchnama, panchnuma, panchnamu, punchnumu —
     and the first of those is the film. */
  const perClass = SPELLINGS.map(([pattern, to]) => {
    const made = [];
    const hits = [...w.matchAll(pattern)];
    if (!hits.length) return made;
    for (const hit of hits) {
      made.push(w.slice(0, hit.index) + hit[0].replace(pattern, to) + w.slice(hit.index + hit[0].length));
    }
    if (hits.length > 1) made.push(w.replace(pattern, to));
    return made.filter((v) => v !== w);
  });

  /* The final vowel, which is its own class: Rama and Ram are one name. */
  const tail = [];
  if (w.endsWith('a')) tail.push(w.slice(0, -1));
  else tail.push(`${w}a`);
  perClass.push(tail);

  /* Round-robin, so the ranking of the classes survives contact with a word
     that has six of one letter. */
  const out = [];
  const seen = new Set([w]);
  for (let depth = 0; out.length < limit; depth += 1) {
    let placed = false;
    for (const made of perClass) {
      if (depth >= made.length) continue;
      placed = true;
      const variant = made[depth];
      if (seen.has(variant)) continue;
      seen.add(variant);
      out.push(variant);
      if (out.length >= limit) break;
    }
    if (!placed) break;
  }
  return out;
}

async function searchTmdb(request, url, env, ctx) {
  if (request.method !== 'GET') return json(405, { error: 'method_not_allowed' });

  const q = (url.searchParams.get('q') ?? '').trim().slice(0, 80);
  const token = env.TMDB_TOKEN || env.TMDB_API_KEY;

  /*
   * No credential is a fact about this Worker, not about the query — so it
   * must not be cached, for the same reason an outage is not cached below.
   *
   * It was, for an hour. Both secrets were unbound one morning and every
   * search answered `remote: false` with `cache-control: public,
   * max-age=3600`, which is a browser being told to remember "this site
   * cannot search" long after the site could. Rebinding the token fixed the
   * edge instantly and did nothing for anyone who had already typed a name:
   * their own browser kept replaying the empty answer until the hour ran out,
   * and the site looked broken to exactly the people who had tried it.
   *
   * The cost of getting this wrong is asymmetric and that is the whole
   * argument. Caching the miss saves a handful of upstream calls in a state
   * that should never last more than minutes; not caching it means the fix
   * reaches every reader the moment it lands.
   *
   * A real miss further down keeps its hour. "TMDB has nothing called this"
   * is a fact about the query and stays true.
   */
  if (!token) return json(200, { remote: false, results: [], total: 0 });

  /* The capability probe. The front end asks with no query on mount to learn
     which placeholder it is allowed to print, and that must not cost a TMDB
     call. Cached, because past this line the token exists. */
  if (!q) return json(200, { remote: true, results: [], total: 0 }, SEARCH_TTL);

  /*
   * Cached at the edge by the query itself.
   *
   * Search traffic is long-tailed but not evenly so — a film in the news is
   * typed by thousands of people in the same hour, and without this each one
   * would spend a TMDB call. The cache key drops everything but the query, so
   * a stray utm parameter cannot split the cache.
   */
  const key = new Request(`https://newonott.in/api/search?q=${encodeURIComponent(q.toLowerCase())}`, {
    method: 'GET',
  });
  const cache = caches.default;
  const hit = await cache.match(key);
  if (hit) return hit;

  const isJwt = /^ey[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(token);

  /** One question to TMDB. Returns null when it could not be asked at all,
   *  which is a different thing from an answer of nothing. */
  const askTmdb = async (query) => {
    const api = new URL('https://api.themoviedb.org/3/search/multi');
    api.searchParams.set('query', query);
    api.searchParams.set('include_adult', 'false');
    /* Region and language shape the results TMDB returns first, and this
       audience is Indian. Without it a search for a Tamil title surfaces the
       American remake. */
    api.searchParams.set('region', 'IN');
    api.searchParams.set('language', 'en-IN');
    if (!isJwt) api.searchParams.set('api_key', token);

    let upstream;
    try {
      upstream = await fetch(api.toString(), {
        headers: isJwt
          ? { authorization: `Bearer ${token}`, accept: 'application/json' }
          : { accept: 'application/json' },
        cf: { cacheEverything: true, cacheTtl: SEARCH_TTL },
      });
    } catch {
      return null;
    }
    if (!upstream.ok) return null;
    const body = await upstream.json();

    const results = (body.results ?? [])
      .filter((r) => r.media_type === 'movie' || r.media_type === 'tv' || r.media_type === 'person')
      .slice(0, 24)
      .map((r) =>
        r.media_type === 'person'
          ? {
              kind: 'person',
              id: `p-${r.id}`,
              name: r.name,
              image: r.profile_path ? `/img/w185${r.profile_path}` : null,
              role: r.known_for_department === 'Acting' ? 'Actor' : r.known_for_department || null,
              knownFor: (r.known_for ?? [])
                .map((k) => k.title || k.name)
                .filter(Boolean)
                .slice(0, 3),
            }
          : {
              kind: r.media_type === 'tv' ? 'series' : 'film',
              /* The same id shape the feed uses, so the front end can match a
                 remote result against a title it already has and show one row
                 rather than two. */
              id: `${r.media_type === 'tv' ? 't' : 'm'}-${r.id}`,
              title: r.title || r.name,
              year: (r.release_date || r.first_air_date || '').slice(0, 4) || null,
              image: r.poster_path ? `/img/w185${r.poster_path}` : null,
              lang: r.original_language || null,
            },
      );

    return { results, total: body.total_results ?? results.length };
  };

  /*
   * As typed first, then less of it — see relaxations(). The loop stops at the
   * first query that returns anything, so a query that works costs one call
   * and only a miss pays for the retries.
   */
  let found = null;
  let asked = q;
  for (const candidate of relaxations(q)) {
    const attempt = await askTmdb(candidate);
    /* Unreachable is not the same as empty: a TMDB outage must report itself
       rather than be retried three ways and reported as "nothing matched". */
    if (attempt === null) {
      return json(200, { remote: true, results: [], total: 0, degraded: true });
    }
    if (attempt.results.length) {
      found = attempt;
      asked = candidate;
      break;
    }
  }

  /*
   * Still nothing, so the word itself is the problem — try how else it is
   * spelled. See spellings() for why this is equivalence classes and not
   * fuzzy matching.
   *
   * Only the distinctive token, because that is the one TMDB is failing on
   * and it is the one a transcription disagreement lands on: "pyaar ka
   * panchnama" fails on "panchnama", not on "ka". Asking for that word alone
   * also sidesteps the thing that makes /search/multi brittle, which is that
   * every token has to land.
   *
   * In parallel, unlike the relaxations above. Those are ordered by how much
   * of the query they throw away, so stopping at the first hit is the point.
   * These are equally plausible spellings of one word, there is no reason to
   * believe the first over the fourth until they answer, and asking one at a
   * time would put two seconds of round trips in front of a reader who has
   * already waited through three misses. The rank decides ties afterwards.
   */
  if (!found) {
    const kept = q
      .split(/\s+/)
      .filter(Boolean)
      .filter((t) => !NOISE.has(t.toLowerCase().replace(/[^a-z0-9]/g, '')) && !/^(19|20)\d{2}$/.test(t));
    const distinctive = kept.length
      ? kept.reduce((a, b) => (b.length > a.length ? b : a)).toLowerCase().replace(/[^a-z]/g, '')
      : '';

    const variants = spellings(distinctive);
    if (variants.length) {
      const tried = await Promise.all(variants.map((v) => askTmdb(v)));
      /* An outage mid-fan-out is still an outage, not a miss: if every
         variant came back null the upstream is down, and saying "nothing
         matched" would be the lie this route already refuses to tell. */
      if (tried.every((t) => t === null)) {
        return json(200, { remote: true, results: [], total: 0, degraded: true });
      }
      const winner = variants.findIndex((_, i) => tried[i] && tried[i].results.length);
      if (winner !== -1) {
        found = tried[winner];
        asked = variants[winner];
      }
    }
  }

  if (!found) {
    const miss = json(200, { remote: true, results: [], total: 0 }, SEARCH_TTL);
    ctx.waitUntil(cache.put(key, miss.clone()));
    return miss;
  }

  const { results, total } = found;

  /* When the answer came from a relaxed query, say so. A reader who typed
     "jawan movie" and gets Jawan is well served; a reader who is not told why
     is left guessing whether the site understood them. */
  const res = json(
    200,
    { remote: true, results, total, ...(asked === q ? {} : { relaxedTo: asked }) },
    SEARCH_TTL,
  );
  ctx.waitUntil(cache.put(key, res.clone()));
  return res;
}

/**
 * One title from TMDB, for the sheet a search result now opens.
 *
 * The row that shows a film TMDB has and this calendar does not used to be
 * inert, with a fair reason written beside it: there was nowhere to send
 * somebody, because the site has no page for a title it has no Indian release
 * date for, and a row that looks clickable and lands on an empty board is
 * worse than one that plainly says "that film exists, we have no date".
 *
 * That reasoning was about pages, and it still holds for pages. A million
 * generated pages with nothing to say is the shape Google demotes, and it
 * would drag down the 331 that are genuinely good. A sheet is not a page. It
 * is not crawled, not indexed and not linked; it opens over the board and
 * closes again. So search can now answer rather than only acknowledge,
 * without publishing anything.
 *
 * What makes it worth opening is not the cast list. It is the providers: TMDB
 * knows what is streaming in India, and platforms.ts already carries the TMDB
 * provider ids for every service this site names. So the sheet can answer the
 * question the whole site exists to answer — where do I watch this — for a
 * title that is nowhere near the release calendar. Shawshank is a 1994 film
 * with no Indian release date and a perfectly good answer to that question.
 *
 * Six hours at the edge. Providers change, but not by the minute, and a title
 * page is a much longer-lived thing than a search result.
 */
const TITLE_TTL = 21_600;

/** `m-278` / `t-1399` — the id shape the feed and the search results share. */
const TITLE_ID = /^([mt])-(\d{1,12})$/;

async function titleFromTmdb(request, url, env, ctx) {
  if (request.method !== 'GET') return json(405, { error: 'method_not_allowed' });

  const raw = (url.searchParams.get('id') ?? '').trim();
  const token = env.TMDB_TOKEN || env.TMDB_API_KEY;
  const match = TITLE_ID.exec(raw);
  if (!match) return json(400, { error: 'bad_id' });
  if (!token) return json(200, { remote: false, degraded: true });

  const [, prefix, id] = match;
  const kind = prefix === 't' ? 'tv' : 'movie';

  const key = new Request(`https://newonott.in/api/title?id=${raw}`, { method: 'GET' });
  const cache = caches.default;
  const hit = await cache.match(key);
  if (hit) return hit;

  const isJwt = /^ey[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(token);
  const api = new URL(`https://api.themoviedb.org/3/${kind}/${id}`);
  /* One call rather than four. credits and watch/providers are the two the
     sheet cannot be drawn without, and the ratings endpoint differs by kind. */
  /* recommendations rides along on the same call rather than costing a second
     round trip. TMDB's "recommendations" is the behavioural one — what people
     who watched this went on to watch — and it is markedly better than
     "similar", which matches on genre and keywords and will happily suggest
     four more prison dramas. */
  api.searchParams.set(
    'append_to_response',
    kind === 'tv'
      ? 'credits,watch/providers,content_ratings,recommendations'
      : 'credits,watch/providers,release_dates,recommendations',
  );
  api.searchParams.set('language', 'en-IN');
  if (!isJwt) api.searchParams.set('api_key', token);

  let upstream;
  try {
    upstream = await fetch(api.toString(), {
      headers: isJwt
        ? { authorization: `Bearer ${token}`, accept: 'application/json' }
        : { accept: 'application/json' },
      cf: { cacheEverything: true, cacheTtl: TITLE_TTL },
    });
  } catch {
    return json(200, { remote: true, degraded: true });
  }
  if (upstream.status === 404) return json(404, { error: 'not_found' }, TITLE_TTL);
  if (!upstream.ok) return json(200, { remote: true, degraded: true });

  const b = await upstream.json();

  /*
   * India, and only India.
   *
   * TMDB returns providers for every country it knows. Showing a reader in
   * Chennai that a film streams on Hulu is worse than showing them nothing,
   * because it reads as an answer. flatrate first because "included with your
   * subscription" is a different offer from "rent for 149", and the pills
   * cannot express the difference.
   */
  const inIndia = b['watch/providers']?.results?.IN ?? {};
  const providerIds = [
    ...(inIndia.flatrate ?? []),
    ...(inIndia.free ?? []),
    ...(inIndia.ads ?? []),
  ].map((p) => p.provider_id);
  const rentBuyIds = [...(inIndia.rent ?? []), ...(inIndia.buy ?? [])].map((p) => p.provider_id);

  const credits = b.credits ?? {};
  const certification =
    kind === 'tv'
      ? (b.content_ratings?.results ?? []).find((r) => r.iso_3166_1 === 'IN')?.rating || null
      : ((b.release_dates?.results ?? []).find((r) => r.iso_3166_1 === 'IN')?.release_dates ?? [])
          .map((r) => r.certification)
          .find(Boolean) || null;

  const payload = {
    remote: true,
    id: raw,
    kind: kind === 'tv' ? 'series' : 'film',
    title: b.title || b.name,
    year: (b.release_date || b.first_air_date || '').slice(0, 4) || null,
    synopsis: b.overview || null,
    posterUrl: b.poster_path ? `/img/w500${b.poster_path}` : null,
    backdropUrl: b.backdrop_path ? `/img/w780${b.backdrop_path}` : null,
    runtimeMinutes: b.runtime ?? b.episode_run_time?.[0] ?? null,
    genres: (b.genres ?? []).map((g) => g.name).slice(0, 4),
    languages: [b.original_language].filter(Boolean),
    certification,
    rating: typeof b.vote_average === 'number' && b.vote_count > 0
      ? Math.round(b.vote_average * 10) / 10
      : null,
    cast: (credits.cast ?? []).slice(0, 8).map((c) => c.name).filter(Boolean),
    director:
      (credits.crew ?? []).find((c) => c.job === 'Director')?.name ??
      (b.created_by ?? [])[0]?.name ??
      null,
    /* Raw TMDB provider ids. The mapping to this site's platform ids lives in
       platforms.ts, which the Worker cannot import — and should not duplicate,
       because two copies of that table would drift the first time a service
       was renamed. */
    providerIds,
    rentBuyIds,
    seasons: kind === 'tv' ? (b.number_of_seasons ?? null) : null,
    /* Enough to fill a row and a swipe, no more. Each one is a card the reader
       may never scroll to, and the payload is already carrying a cast list. */
    similar: (b.recommendations?.results ?? [])
      .filter((r) => (r.media_type ? r.media_type === 'movie' || r.media_type === 'tv' : true))
      .filter((r) => r.poster_path)
      .slice(0, 12)
      .map((r) => ({
        id: `${r.media_type === 'tv' || (!r.media_type && kind === 'tv') ? 't' : 'm'}-${r.id}`,
        title: r.title || r.name,
        year: (r.release_date || r.first_air_date || '').slice(0, 4) || null,
        image: `/img/w185${r.poster_path}`,
      })),
  };

  const res = json(200, payload, TITLE_TTL);
  ctx.waitUntil(cache.put(key, res.clone()));
  return res;
}

/**
 * Everything one person has been in.
 *
 * Search has always returned people — TMDB's /search/multi gives them for
 * free, and a reader who half-remembers a face and not a title types the name.
 * Tapping one used to put the name in the search box, which worked only
 * because the box also filtered the board: their films appeared underneath
 * because the board matched on cast. The box stopped touching the board, so
 * that quietly became a tap that does nothing but re-run the same search.
 *
 * A person is a destination after all. Not a page — the same reasoning as
 * titles, and a hundred thousand actor pages carrying a filmography and
 * nothing else is exactly the shape that gets demoted — but a sheet listing
 * the work, from which any title opens.
 *
 * Cast and crew merged, because the answer to "what has this person done"
 * should not depend on which side of the camera they were on: an actor's list
 * is `cast`, a director's is `crew`, and plenty of people have both. Deduped
 * by title, since a person who acted in and directed the same film is one
 * credit on a filmography, not two.
 */
const PERSON_TTL = 21_600;
const PERSON_ID = /^p-(\d{1,12})$/;

async function personFromTmdb(request, url, env, ctx) {
  if (request.method !== 'GET') return json(405, { error: 'method_not_allowed' });

  const raw = (url.searchParams.get('id') ?? '').trim();
  const token = env.TMDB_TOKEN || env.TMDB_API_KEY;
  const match = PERSON_ID.exec(raw);
  if (!match) return json(400, { error: 'bad_id' });
  if (!token) return json(200, { remote: false, degraded: true });

  const key = new Request(`https://newonott.in/api/person?id=${raw}`, { method: 'GET' });
  const cache = caches.default;
  const hit = await cache.match(key);
  if (hit) return hit;

  const isJwt = /^ey[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(token);
  const api = new URL(`https://api.themoviedb.org/3/person/${match[1]}`);
  api.searchParams.set('append_to_response', 'combined_credits');
  api.searchParams.set('language', 'en-IN');
  if (!isJwt) api.searchParams.set('api_key', token);

  let upstream;
  try {
    upstream = await fetch(api.toString(), {
      headers: isJwt
        ? { authorization: `Bearer ${token}`, accept: 'application/json' }
        : { accept: 'application/json' },
      cf: { cacheEverything: true, cacheTtl: PERSON_TTL },
    });
  } catch {
    return json(200, { remote: true, degraded: true });
  }
  if (upstream.status === 404) return json(404, { error: 'not_found' }, PERSON_TTL);
  if (!upstream.ok) return json(200, { remote: true, degraded: true });

  const b = await upstream.json();
  const credits = b.combined_credits ?? {};

  const rows = new Map();
  for (const c of [...(credits.cast ?? []), ...(credits.crew ?? [])]) {
    if (c.media_type !== 'movie' && c.media_type !== 'tv') continue;
    if (!c.poster_path) continue;
    const id = `${c.media_type === 'tv' ? 't' : 'm'}-${c.id}`;
    /* First wins, and cast comes first: "as Vijay" is more use on a
       filmography than "Executive Producer" for the same film. */
    if (rows.has(id)) continue;
    rows.set(id, {
      id,
      title: c.title || c.name,
      year: (c.release_date || c.first_air_date || '').slice(0, 4) || null,
      image: `/img/w185${c.poster_path}`,
      as: c.character || c.job || null,
      popularity: c.popularity ?? 0,
    });
  }

  /* Best known first. A filmography ordered by date opens on whatever they did
     most recently, which for a long career is usually the least recognisable
     thing on it. */
  const credited = [...rows.values()]
    .sort((a, b) => b.popularity - a.popularity)
    .slice(0, 24)
    .map(({ popularity, ...rest }) => rest);

  const res = json(
    200,
    {
      remote: true,
      id: raw,
      name: b.name,
      role: b.known_for_department === 'Acting' ? 'Actor' : b.known_for_department || null,
      image: b.profile_path ? `/img/w185${b.profile_path}` : null,
      credits: credited,
    },
    PERSON_TTL,
  );
  ctx.waitUntil(cache.put(key, res.clone()));
  return res;
}

/**
 * A whole genre, not the slice of it this site happens to have dated.
 *
 * The /action page shipped 268 titles under a header promising a million, and
 * the owner was right to call that a contradiction. Measuring it settled what
 * the honest number is, and it is neither:
 *
 *   genre        ours    streaming in India
 *   Action        268                  5749
 *   Comedy        285                  9088
 *   Thriller      251                  3921
 *   Romance       157                  4015
 *   Crime         222                  3507
 *   Horror         67                  1420
 *
 * A million is TMDB's whole worldwide catalogue and will never be a genre in
 * one country. But 268 of 5,749 is 5%, and a reader who came looking for
 * action films is being shown one in twenty of the ones they could press play
 * on tonight.
 *
 * Read live rather than collected. Pulling 29,000 titles into catalogue.json
 * would be a fifteen-megabyte download for a page most readers scroll half
 * of, and thirty thousand thin generated pages is the exact shape that got
 * the publishing rule written in the first place. Nothing here is prerendered,
 * crawled or linked: the page's own dated rows stay the indexed part, and this
 * is a grid underneath them that a reader can browse.
 *
 * What it cannot do. TMDB has no television genre for Thriller, Romance or
 * Horror — a horror series is filed under Drama or Mystery — so those three
 * are films only, and the route says so rather than quietly returning fewer
 * titles than it claims.
 */
const BROWSE_TTL = 21_600;

/**
 * TMDB's numeric genre ids, which differ between films and series.
 *
 * A second copy of a table that lives elsewhere is how things drift, so this
 * is the one place where the risk is worth it: these are TMDB's own ids, they
 * have not changed in a decade, and the alternative is a call to
 * /genre/movie/list on the way to every single browse. The test asserts this
 * covers exactly the genres collections.ts has a page for, so adding a
 * collection without an id here fails the build rather than a reader's page.
 */
export const GENRE_IDS = {
  action: { film: 28, series: 10759 /* Action & Adventure */ },
  comedy: { film: 35, series: 35 },
  crime: { film: 80, series: 80 },
  horror: { film: 27, series: null },
  romance: { film: 10749, series: null },
  thriller: { film: 53, series: null },
};

/**
 * The services a reader in India can actually open, as TMDB numbers them.
 *
 * Duplicated from src/data/platforms.ts, which the Worker cannot import — it
 * is a TypeScript module in the app bundle and this file is plain JS handed
 * straight to wrangler. So the copy is pinned instead: worker/index.test.mjs
 * parses the registry and asserts these are the same set, which turns a
 * rename into a failing test rather than a genre page that silently stops
 * counting a platform. JioHotstar has already been renamed once.
 */
export const IN_PROVIDERS = [8, 1796, 9, 119, 2336, 122, 970, 350, 2, 237, 232, 309, 315, 532, 1898, 283];

async function browseTmdb(request, url, env, ctx) {
  if (request.method !== 'GET') return json(405, { error: 'method_not_allowed' });

  const slug = (url.searchParams.get('g') ?? '').trim().toLowerCase();
  const page = Math.min(Math.max(Number(url.searchParams.get('page') ?? 1) || 1, 1), 100);
  const genre = GENRE_IDS[slug];
  const token = env.TMDB_TOKEN || env.TMDB_API_KEY;

  if (!genre) return json(400, { error: 'bad_genre' });
  if (!token) return json(200, { remote: false, results: [], total: 0 }, BROWSE_TTL);

  const key = new Request(`https://newonott.in/api/browse?g=${slug}&page=${page}`, { method: 'GET' });
  const cache = caches.default;
  const hit = await cache.match(key);
  if (hit) return hit;

  const isJwt = /^ey[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(token);

  /** One /discover page. Null means it could not be asked, which is not the
   *  same as a genre with nothing in it. */
  const discover = async (kind, genreId) => {
    if (!genreId) return { results: [], total: 0 };
    const api = new URL(
      `https://api.themoviedb.org/3/discover/${kind === 'series' ? 'tv' : 'movie'}`,
    );
    api.searchParams.set('with_genres', String(genreId));
    /* Region and providers together, which is what makes this a list of
       things to watch rather than a list of things that exist. TMDB reads the
       pipe as OR: on any of these services. */
    api.searchParams.set('watch_region', 'IN');
    api.searchParams.set('with_watch_providers', IN_PROVIDERS.join('|'));
    api.searchParams.set('sort_by', 'popularity.desc');
    api.searchParams.set('include_adult', 'false');
    api.searchParams.set('language', 'en-IN');
    api.searchParams.set('page', String(page));
    if (!isJwt) api.searchParams.set('api_key', token);

    let upstream;
    try {
      upstream = await fetch(api.toString(), {
        headers: isJwt
          ? { authorization: `Bearer ${token}`, accept: 'application/json' }
          : { accept: 'application/json' },
        cf: { cacheEverything: true, cacheTtl: BROWSE_TTL },
      });
    } catch {
      return null;
    }
    if (!upstream.ok) return null;
    const body = await upstream.json();

    const results = (body.results ?? [])
      /* A poster is most of what a grid row is. Without one the tile is a
         title in a grey box, and twenty of those read as a broken page. */
      .filter((r) => r.poster_path)
      .map((r) => ({
        kind,
        id: `${kind === 'series' ? 't' : 'm'}-${r.id}`,
        title: r.title || r.name,
        year: (r.release_date || r.first_air_date || '').slice(0, 4) || null,
        image: `/img/w185${r.poster_path}`,
        lang: r.original_language || null,
      }));

    return { results, total: body.total_results ?? results.length };
  };

  const [films, series] = await Promise.all([
    discover('film', genre.film),
    discover('series', genre.series),
  ]);
  if (films === null || series === null) {
    return json(200, { remote: true, results: [], total: 0, degraded: true });
  }

  /*
   * Interleaved rather than concatenated. Two popularity-sorted lists laid end
   * to end give a page of films followed by a page of series, which reads as
   * two lists that failed to merge; alternating keeps both kinds on screen
   * from the first row while preserving each side's own order.
   */
  const merged = [];
  for (let i = 0; i < Math.max(films.results.length, series.results.length); i += 1) {
    if (films.results[i]) merged.push(films.results[i]);
    if (series.results[i]) merged.push(series.results[i]);
  }

  const res = json(
    200,
    {
      remote: true,
      genre: slug,
      page,
      results: merged,
      total: films.total + series.total,
      /* So the page can say "films only" where that is the truth, instead of
         a reader wondering where the horror series went. */
      filmsOnly: genre.series === null,
      more: merged.length > 0,
    },
    BROWSE_TTL,
  );
  ctx.waitUntil(cache.put(key, res.clone()));
  return res;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    /**
     * Assets first, and by a wide margin. run_worker_first is on so that
     * /api/subscribe can exist at all, which means page loads pass through
     * here too — so this branch is the hot path and does exactly one string
     * comparison before handing off. env.ASSETS.fetch applies the SPA
     * fallback from wrangler.jsonc, so unknown paths still serve the board.
     */
    if (url.pathname.startsWith('/img/')) return proxyPoster(request, url);

    /*
     * Whether the last-resort alarm can actually make a sound.
     *
     * The daily watchdog below is the only thing that still works when GitHub
     * itself goes quiet — a disabled schedule, a cron that never fires, an
     * Actions outage. And it alerts through Brevo, so if BREVO_API_KEY is not
     * bound to this Worker it detects the staleness, writes a line to a console
     * log nobody reads, and returns. A silent smoke alarm is worse than none,
     * because it is counted on.
     *
     * Nothing could see that from outside, so this says it. The deploy workflow
     * reads it on every publish and fails if the alarm is mute, which turns an
     * invisible gap into an email. No secret is exposed: it reports only
     * whether the bindings exist, never what they are.
     */
    if (url.pathname === '/api/watchdog') {
      return Response.json(
        {
          armed: Boolean(env.BREVO_API_KEY),
          addressed: Boolean(env.ALERT_EMAIL),
          slots: REFRESH_SLOTS.length,
          graceHours: GRACE_HOURS,
          /* Whether search can reach past this site's own 963 rows. The token
             lives in Actions secrets for the refresh and has to be bound here
             separately, and nothing else would say whether that happened — the
             box degrades quietly by design, so a missing secret looks exactly
             like a site that simply has fewer results. Reports only that the
             binding exists, never what it holds. */
          searchable: Boolean(env.TMDB_TOKEN || env.TMDB_API_KEY),
        },
        { headers: { 'cache-control': 'no-store' } },
      );
    }

    /**
     * One casing per page — but page paths only, because anything with a file
     * extension keeps its capitals.
     *
     * The first version of this redirected on capitals alone and took the
     * whole site down for the length of one deploy: Vite's hashed bundles are
     * named like index-CqG28YpW.js, so every asset 301'd to a lowercase path
     * that does not exist, fell through to the SPA fallback, and arrived at
     * the browser as index.html with a JavaScript content type. The page then
     * rendered its prerendered shell with no styling and no behaviour.
     *
     * A published page path never has a dot in it — platform ids, language
     * names, slugs, /w/<iso-date> — and every dotted path is a file whose name
     * is somebody else's to choose: bundles, /build.txt, /sitemap.xml, posters.
     * So the extension is the test, not the casing.
     */
    if (/[A-Z]/.test(url.pathname) && !/\.[a-z0-9]+$/i.test(url.pathname)) {
      url.pathname = url.pathname.toLowerCase();
      return Response.redirect(url.toString(), 301);
    }

    /**
     * One path per page, without a trailing slash.
     *
     * The asset server answers /theatres and /theatres/ with the same file, so
     * Google indexed both and split their signals between them: Search Console
     * for 4-14 September lists them as separate rows, 39 impressions against 21,
     * for one page. The canonical already said /theatres and was being ignored,
     * which is what canonicals do when two URLs both return 200 — they are a
     * hint, and a redirect is not.
     *
     * Every one of the 314 URLs in the sitemap is slashless except the root, so
     * the slashed form is never the address of anything. The root is excluded
     * because "" is not a path, and dotted paths are left alone for the same
     * reason as the casing rule above: a file's name belongs to whoever made it.
     */
    if (url.pathname.length > 1 && url.pathname.endsWith('/') && !/\.[a-z0-9]+\/$/i.test(url.pathname)) {
      url.pathname = url.pathname.replace(/\/+$/, '');
      return Response.redirect(url.toString(), 301);
    }

    /* Before the asset fallback, and before the subscribe guard below, which
       is a POST-only path. */
    if (url.pathname === '/api/search') return searchTmdb(request, url, env, ctx);
    if (url.pathname === '/api/title') return titleFromTmdb(request, url, env, ctx);
    if (url.pathname === '/api/person') return personFromTmdb(request, url, env, ctx);
    if (url.pathname === '/api/browse') return browseTmdb(request, url, env, ctx);

    if (url.pathname !== '/api/subscribe') return env.ASSETS.fetch(request);

    if (request.method !== 'POST') {
      return json(405, { error: 'method_not_allowed' });
    }

    /**
     * Same-origin only. The form posts from our own page, so a request
     * carrying somebody else's Origin is either a mistake or somebody using
     * our list as a spam sink. Missing Origin is allowed: curl sends none,
     * and so does a legitimate same-origin form post in some browsers.
     */
    const origin = request.headers.get('origin');
    if (origin && new URL(origin).host !== url.host) {
      return json(403, { error: 'bad_origin' });
    }

    /**
     * No database bound yet means say so, loudly and in the logs, rather
     * than accepting an address and dropping it. The front end keeps its
     * form hidden until EMAIL_ENDPOINT is set, so in practice nobody should
     * ever see this — but a sign-up form that reports success while storing
     * nothing is the exact failure this whole file exists to avoid.
     */
    if (!env.DB) {
      console.error('subscribe: no D1 binding — see docs/email-setup.md');
      return json(503, { error: 'not_configured' });
    }

    let address = '';
    try {
      const raw = await request.text();
      if (raw.length > MAX_BODY) return json(413, { error: 'too_large' });
      const body = JSON.parse(raw);
      // The form sends both names because providers disagree about which one
      // they read; either is fine here.
      address = String(body.email ?? body.email_address ?? '').trim();
    } catch {
      return json(400, { error: 'bad_json' });
    }

    if (!LOOKS_LIKE_EMAIL.test(address) || address.length > 254) {
      return json(400, { error: 'bad_email' });
    }

    /**
     * Lowercased as the key so the same person subscribing twice is one row,
     * and INSERT OR IGNORE so the second attempt is a success rather than a
     * 500. Someone re-subscribing has done nothing wrong and should not be
     * told the form is broken.
     *
     * The original casing is kept alongside it: mail servers are free to
     * treat the local part as case-sensitive, so the address we actually send
     * to should be the one that was typed.
     */
    try {
      await env.DB.prepare(
        `INSERT OR IGNORE INTO subscribers (email, address, created_at, country)
         VALUES (?1, ?2, ?3, ?4)`,
      )
        .bind(
          address.toLowerCase(),
          address,
          new Date().toISOString(),
          request.cf?.country ?? null,
        )
        .run();
    } catch (err) {
      console.error('subscribe: insert failed', err);
      return json(500, { error: 'store_failed' });
    }

    /**
     * The welcome mail, deliberately after the response is decided.
     *
     * waitUntil rather than await: the address is the durable thing and the
     * email is best-effort, so a slow Brevo must not hold the form open and a
     * dead one must not turn a stored subscription into a visible failure. The
     * reader has done their part the moment the row exists.
     */
    // Optional-chained: the row is already written, and a runtime that hands
    // us no ctx must not turn a successful subscription into a 500.
    ctx?.waitUntil?.(sendWelcome(env, address));
    return json(200, { ok: true });
  },

  /**
   * The dead man's switch.
   *
   * The refresh is a GitHub Actions cron, and GitHub's scheduler is best-effort:
   * its own documentation says a scheduled run can be delayed under load and
   * dropped entirely. This repository has seen both — the one scheduled run on
   * record started 2h16m after its slot, and the Friday slot on 11 Sep produced
   * nothing at all.
   *
   * A late refresh is survivable. What is not is that a refresh which never
   * happens looks exactly like one that worked: the site keeps serving, the
   * board keeps rendering, and the only symptom is a date quietly falling
   * behind. The owner found out because a page looked thin, four days later.
   * Monitoring that lives inside the job being monitored cannot report the job
   * not running, which is the one failure that matters here.
   *
   * So the check runs somewhere else entirely. Cloudflare's cron fires this
   * Worker daily, it reads the feed the site is actually serving — not a
   * status page, not a build log, the same JSON a reader gets — and if that
   * feed is older than the last refresh that should have happened, it says so
   * by email. It needs no GitHub token and no third-party service: the sender
   * is already configured for the welcome mail.
   *
   * It cannot fix anything. It exists so that silence stops meaning "fine".
   */
  async scheduled(event, env, ctx) {
    ctx?.waitUntil?.(checkFreshness(env));
  },
};

/**
 * The refresh schedule, mirrored from .github/workflows/refresh-releases.yml.
 *
 * Two statements of one fact, which is a real risk and named here rather than
 * hidden: if the cron there changes and this does not, the watchdog starts
 * alerting on a schedule nobody runs, and an alert that cries wolf is deleted
 * unread — the same silence it was built to end. Kept as UTC weekday/hour/minute
 * because that is exactly how the workflow states them.
 */
const REFRESH_SLOTS = [
  { day: 5, hour: 0, minute: 0 }, // Fri 00:00 UTC — the early run, fresh by 10:00 IST
  { day: 5, hour: 8, minute: 30 }, // Fri 08:30 UTC — the week flips, drops included
  { day: 6, hour: 4, minute: 30 }, // Sat 04:30 UTC — anything that landed late
  { day: 1, hour: 13, minute: 30 }, // Mon 13:30 UTC — the weekend and the week ahead
  // The four days the three above do not cover, so the calendar is never more
  // than a day old. See the cron block in refresh-releases.yml.
  { day: 0, hour: 4, minute: 30 }, // Sun 04:30 UTC
  { day: 2, hour: 4, minute: 30 }, // Tue 04:30 UTC
  { day: 3, hour: 4, minute: 30 }, // Wed 04:30 UTC
  { day: 4, hour: 4, minute: 30 }, // Thu 04:30 UTC
];

/**
 * How long after a slot a run is still considered merely late.
 *
 * Was three hours, from a single sample: the one scheduled run on record then
 * was 2h16m late and completed fine. Three more have since been measured — Fri
 * 11 Sep 4h24m, Sat 12 Sep 4h13m, Mon 14 Sep 5h19m — so every real run since
 * has been outside that window, and the watchdog was primed to report a healthy
 * pipeline as broken. An alarm that cries wolf is deleted unread, which is the
 * exact silence this was built to end.
 *
 * Six hours clears the worst measured lateness with room, and still catches a
 * genuinely dead scheduler inside the same day.
 */
const GRACE_HOURS = 6;

/**
 * The most recent slot that is far enough in the past that a run should have
 * finished by now. Returns a Date, or null if none has come due yet.
 */
export function lastDueSlot(now, graceHours = GRACE_HOURS) {
  const cutoff = now.getTime() - graceHours * 3600_000;
  let best = null;
  // Walk back eight days so the answer is right on a Monday, when the most
  // recent due slot is the previous Saturday's.
  for (let back = 0; back <= 8; back++) {
    const d = new Date(now.getTime() - back * 86_400_000);
    for (const slot of REFRESH_SLOTS) {
      if (d.getUTCDay() !== slot.day) continue;
      const at = Date.UTC(
        d.getUTCFullYear(),
        d.getUTCMonth(),
        d.getUTCDate(),
        slot.hour,
        slot.minute,
      );
      if (at <= cutoff && (best === null || at > best)) best = at;
    }
  }
  return best === null ? null : new Date(best);
}

async function checkFreshness(env) {
  const due = lastDueSlot(new Date());
  if (!due) return; // Nothing has come due yet — nothing to say.

  let generatedAt = null;
  try {
    const res = await env.ASSETS.fetch(new Request('https://newonott.in/data/releases.json'));
    if (res.ok) generatedAt = (await res.json()).generatedAt ?? null;
  } catch (err) {
    console.error('watchdog: could not read the feed', err);
  }

  // A feed the Worker cannot read at all is worse than a stale one, so it
  // alerts rather than returning quietly — the alternative is the exact
  // silence this exists to remove.
  const built = generatedAt ? Date.parse(generatedAt) : NaN;
  if (Number.isFinite(built) && built >= due.getTime()) {
    console.log(`watchdog: feed built ${generatedAt}, after the ${due.toISOString()} slot — ok`);
    return;
  }

  const hours = Number.isFinite(built)
    ? Math.round((Date.now() - built) / 3600_000)
    : null;
  const detail = Number.isFinite(built)
    ? `The feed was last rebuilt ${generatedAt} — ${hours} hours ago.`
    : 'The Worker could not read a build time from the feed at all.';

  console.error(`watchdog: stale. ${detail}`);
  await sendAlert(
    env,
    'New on OTT: the refresh has not run',
    [
      `The refresh that was due at ${due.toISOString()} has not produced a new feed.`,
      '',
      detail,
      '',
      'The site is still up and still serving — this is about the data behind it',
      'going stale, which nothing else would have told you about.',
      '',
      'To fix it now, run the "Refresh release calendar" workflow by hand:',
      'https://github.com/beingshivam/OTT/actions/workflows/refresh-releases.yml',
      '',
      'This check runs once a day from the Cloudflare Worker, deliberately outside',
      'GitHub, so that a refresh which never starts is still able to tell you.',
    ].join('\n'),
  );
}

/** Plain text, to the site's own address. No template and no digest — an alert
 *  that needs a build artefact to render is an alert that fails when the build
 *  is what broke. */
async function sendAlert(env, subject, text) {
  if (!env.BREVO_API_KEY) {
    console.log('watchdog: would have alerted, but no BREVO_API_KEY is bound');
    return;
  }
  const to = env.ALERT_EMAIL || SENDER.email;
  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'api-key': env.BREVO_API_KEY,
      },
      body: JSON.stringify({ sender: SENDER, to: [{ email: to }], subject, textContent: text }),
    });
    if (res.ok) console.log('watchdog: alert sent to', to);
    else console.error('watchdog: brevo refused', res.status, await res.text());
  } catch (err) {
    console.error('watchdog: alert failed', err);
  }
}

/** Where the mail comes from. A verified sender on the site's own domain —
 *  Brevo will refuse anything else, and so will most inboxes. */
const SENDER = { name: 'New on OTT', email: 'mail@newonott.in' };

/**
 * Send the current week's digest to somebody who has just subscribed.
 *
 * Someone who signs up on a Tuesday and hears nothing until Friday has, by
 * Friday, forgotten doing it. This closes that gap with the email they signed
 * up for rather than a separate "thanks for subscribing" that says nothing —
 * the first message proves what the subscription is worth.
 *
 * The body is the same file the build ships to /email/, rebuilt by every
 * refresh, so there is no second template to keep in step with the first.
 *
 * Every failure here is swallowed on purpose. This runs after the subscriber
 * has been told they are subscribed, and they have been: the row is written.
 * Throwing would only produce an unhandled rejection in a context nobody
 * reads, so failures are logged and dropped.
 */
async function sendWelcome(env, address) {
  /**
   * Every outcome says something, including the quiet ones.
   *
   * The first version logged only failures, so a working send and an
   * unconfigured one were both silent — and "nothing in the log" could not
   * distinguish "it worked" from "it never ran". That is the one thing a log
   * exists to tell you.
   */
  if (!env.BREVO_API_KEY) {
    console.log('welcome: skipped — no BREVO_API_KEY bound to this Worker');
    return;
  }
  try {
    const [html, text, subject] = await Promise.all(
      ['latest.html', 'latest.txt', 'subject.txt'].map((f) =>
        env.ASSETS.fetch(new Request(`https://newonott.in/email/${f}`)).then((r) =>
          r.ok ? r.text() : null,
        ),
      ),
    );
    // No digest built into this deploy: skip rather than send an empty mail.
    if (!html || html.length < 10) {
      console.log('welcome: skipped — no digest at /email/latest.html in this deploy');
      return;
    }

    /**
     * The unsubscribe token in the template is meant for a provider that
     * substitutes its own link. Brevo does not do that for transactional
     * sends, so shipping it literally would print "{{ unsubscribe }}" in
     * somebody's inbox — worse than having no unsubscribe at all.
     */
    const optOut = 'Don\u2019t want these? Reply with "stop" and you are off the list.';
    const body = {
      sender: SENDER,
      to: [{ email: address }],
      subject: (subject ?? 'New on OTT — this week').trim(),
      htmlContent: html.replace(/\{\{\s*unsubscribe\s*\}\}/g, optOut),
      textContent: (text ?? '').replace(/\{\{\s*unsubscribe\s*\}\}/g, optOut) || undefined,
      /**
       * Gives Gmail and Outlook a real unsubscribe control of their own. A
       * mailto rather than a URL because there is no unsubscribe endpoint yet
       * — this is honest about what exists, and an inbox-level unsubscribe
       * button is worth more than a link nobody scrolls to.
       */
      headers: { 'List-Unsubscribe': `<mailto:${SENDER.email}?subject=unsubscribe>` },
    };

    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'api-key': env.BREVO_API_KEY,
      },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      const { messageId } = await res.json().catch(() => ({}));
      console.log('welcome: sent', address, messageId ?? '(no messageId)');
    } else {
      console.error('welcome: brevo refused', res.status, await res.text());
    }
  } catch (err) {
    console.error('welcome: send failed', err);
  }
}
