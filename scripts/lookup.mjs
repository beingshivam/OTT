#!/usr/bin/env node
/**
 * Why is this title not on the site?
 *
 * Asked three times now — Drishyam, Dhurandhar, Hanuman Ansh — and answered
 * each time by reasoning about the pipeline, which is guessing with extra
 * steps. The calendar is built from two TMDB queries with hard filters on
 * them, so "missing" always has one of a small number of causes, and every one
 * of them is checkable in a few calls. This checks them.
 *
 * It reports what TMDB holds, runs the same gates fetch-releases.mjs runs, and
 * names the first one the title fails. A title absent from TMDB and a title
 * TMDB has but with no India provider are completely different problems with
 * completely different fixes, and from the outside they look identical.
 *
 * Needs TMDB_TOKEN, so in practice it runs in CI — see .github/workflows/
 * lookup-title.yml. Locally it works wherever TMDB is reachable.
 *
 * Usage: npm run lookup -- "Hanuman Ansh"
 */

const TOKEN = process.env.TMDB_TOKEN || process.env.TMDB_API_KEY;
const REGION = process.env.REGION || 'IN';
const query = process.argv.slice(2).join(' ').trim();

if (!query) {
  console.error('Usage: npm run lookup -- "<title>"');
  process.exit(2);
}
if (!TOKEN) {
  console.error('No TMDB_TOKEN. This has to run where the credential is — see the workflow.');
  process.exit(2);
}

/** The token is either a v4 bearer or a v3 key; accept whichever is set. */
const isBearer = TOKEN.includes('.');
async function tmdb(path, params = {}) {
  const url = new URL(`https://api.themoviedb.org/3${path}`);
  for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, String(v));
  if (!isBearer) url.searchParams.set('api_key', TOKEN);
  const res = await fetch(url, {
    headers: isBearer ? { Authorization: `Bearer ${TOKEN}` } : {},
  });
  if (!res.ok) throw new Error(`TMDB ${res.status} on ${path}`);
  return res.json();
}

const line = (s = '') => console.log(s);
const yes = (s) => console.log(`   ok   ${s}`);
const no = (s) => console.log(`   ✕    ${s}`);

line(`\nLooking up "${query}" for ${REGION}\n`);

const search = await tmdb('/search/multi', { query, include_adult: false });
const hits = (search.results ?? []).filter((r) => r.media_type === 'movie' || r.media_type === 'tv');

if (!hits.length) {
  no('TMDB has no such title at all.');
  line();
  line('  That is the whole answer: this calendar is built from TMDB, so a title');
  line('  TMDB does not carry cannot appear on it however well known it is. The');
  line('  fix is upstream — anyone can add a film at themoviedb.org, and once it');
  line('  is there with an India release date or provider it arrives on the next');
  line('  refresh.');
  line();
  process.exit(0);
}

line(`TMDB has ${hits.length} match${hits.length === 1 ? '' : 'es'}:\n`);

for (const hit of hits.slice(0, 4)) {
  const isMovie = hit.media_type === 'movie';
  const name = hit.title ?? hit.name;
  const date = hit.release_date ?? hit.first_air_date ?? '(no date)';
  line(`── ${name} (${date}) · ${isMovie ? 'film' : 'series'} · id ${hit.id} · ${hit.original_language}`);
  line(`   popularity ${Math.round(hit.popularity ?? 0)} · ${hit.vote_count ?? 0} votes · ${hit.vote_average ?? 0}/10`);

  /**
   * Gate one: is it inside the window the feed covers? The feed is a rolling
   * eight weeks, so a film from last year is not missing, it is simply older
   * than the calendar — the archive is where those live.
   */
  const [detail, providers] = await Promise.all([
    tmdb(`/${isMovie ? 'movie' : 'tv'}/${hit.id}`).catch(() => null),
    tmdb(`/${isMovie ? 'movie' : 'tv'}/${hit.id}/watch/providers`).catch(() => null),
  ]);

  const scoped = providers?.results?.[REGION];
  const streaming = [
    ...(scoped?.flatrate ?? []),
    ...(scoped?.free ?? []),
    ...(scoped?.ads ?? []),
  ].map((p) => p.provider_name);
  const rentOnly = [...(scoped?.rent ?? []), ...(scoped?.buy ?? [])].map((p) => p.provider_name);

  if (streaming.length) {
    yes(`streaming in ${REGION} on ${streaming.join(', ')} — the discover query would find it`);
  } else if (rentOnly.length) {
    no(`only rent/buy in ${REGION} (${rentOnly.join(', ')})`);
    line('        The calendar asks TMDB for subscription, free and ad-supported only,');
    line('        because "where can I watch it" means included, not for sale.');
  } else {
    no(`no ${REGION} provider on TMDB at all`);
  }

  /**
   * Gate two: a theatrical release date for this region. This is the path that
   * makes upcoming weeks work, since TMDB assigns providers only after a title
   * is available.
   */
  if (isMovie) {
    const dates = await tmdb(`/movie/${hit.id}/release_dates`).catch(() => null);
    const forRegion = dates?.results?.find((r) => r.iso_3166_1 === REGION);
    const theatrical = (forRegion?.release_dates ?? []).filter((d) => d.type === 2 || d.type === 3);
    if (theatrical.length) {
      yes(`theatrical date in ${REGION}: ${theatrical.map((d) => d.release_date.slice(0, 10)).join(', ')}`);
    } else if (forRegion) {
      no(`${REGION} release dates exist but none is theatrical (types ${
        [...new Set((forRegion.release_dates ?? []).map((d) => d.type))].join(', ') || 'none'
      })`);
    } else {
      no(`no ${REGION} release date on TMDB`);
    }
  }

  if (!streaming.length) {
    line();
    line('   → Not on the site, and this is why. The calendar finds titles two ways:');
    line('     a subscription/free/ad provider in the region, or a theatrical date in');
    line('     the region. A title with neither is invisible to it — being well known,');
    line('     or well rated, does not help, because neither is a field this pipeline');
    line('     reads. Both gaps are fixable at themoviedb.org by anyone with an');
    line('     account, and the next refresh picks the title up.');
  }
  line();
}
