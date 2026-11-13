#!/usr/bin/env node
/**
 * The newsroom: drafts an article when a film's OTT date is announced, and
 * publishes it once that date is verified. No person in the loop.
 *
 * Runs in the refresh, after the archive. Two passes:
 *
 *   Draft. An Indian title whose streaming date first appeared in the last
 *   three days, with enough attention to be searched for, gets a draft in
 *   data/news. What makes it worth reading rather than a reworded press note:
 *   the gap between its cinema and OTT dates set against the typical gap for
 *   its language, measured from every film this site has tracked
 *   (src/lib/ott-estimate.mjs).
 *
 *   Publish. A draft goes live only when its date is verified — the
 *   platform's own India listing confirms it, or the announced date has
 *   arrived (the rule in src/lib/platform-claim.mjs: of 180 guessed rows, 33
 *   were later confirmed and all 33 agreed). It is rebuilt from current data
 *   at that moment, so tense and facts are as of publication. A draft whose
 *   date vanishes is marked withdrawn; one a week past its date, expired.
 *   Neither ever publishes.
 *
 * At most PUBLISH_PER_DAY articles go out a day. Google's spam policy is
 * aimed at mass-produced pages with little value; a handful of verified,
 * data-backed articles a day is the other side of that line, and the cap
 * keeps it there.
 *
 *   node scripts/news-draft.mjs            # drafts and publishes
 *   node scripts/news-draft.mjs --dry-run  # says what it would do
 */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gapPairs, windowStats, INDIAN_LANGUAGES, weeksLabel } from '../src/lib/ott-estimate.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const NEWS_DIR = resolve(ROOT, process.env.NEWS_DIR ?? 'data/news');
const DRY = process.argv.includes('--dry-run');
const TODAY = process.env.TODAY ?? new Date().toISOString().slice(0, 10);
const SITE = 'https://newonott.in';

/* Enough attention to be searched for; TMDB heat on this feed runs 0–90. */
const MIN_HEAT = Number(process.env.NEWS_MIN_HEAT ?? 12);
/* How recently the date must have appeared to still be news. */
const FRESH_DAYS = 3;
/* A refresh never drafts more than this: a person has to read every one. */
const MAX_DRAFTS = 5;
/* Articles published per UTC day, across all runs. */
const PUBLISH_PER_DAY = Number(process.env.NEWS_PER_DAY ?? 3);
/* A draft this many days past its OTT date is no longer news. */
const EXPIRE_DAYS = 7;

const PLATFORM = {
  netflix: 'Netflix', prime: 'Prime Video', jiohotstar: 'JioHotstar', sonyliv: 'SonyLIV', zee5: 'ZEE5',
  sunnxt: 'Sun NXT', aha: 'aha', hoichoi: 'hoichoi', manoramamax: 'ManoramaMAX', etvwin: 'ETV Win',
  chaupal: 'Chaupal', mxplayer: 'MX Player', appletv: 'Apple TV+', lionsgate: 'Lionsgate Play',
};
const LANG = { hi: 'Hindi', ta: 'Tamil', te: 'Telugu', ml: 'Malayalam', kn: 'Kannada', bn: 'Bengali', mr: 'Marathi', pa: 'Punjabi', gu: 'Gujarati' };
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const spoken = (iso) => {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
};
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
const slugify = (s) =>
  s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const archive = JSON.parse(await readFile(resolve(ROOT, process.env.ARCHIVE_IN ?? 'data/archive.json'), 'utf8')).titles;
const rows = Array.isArray(archive) ? archive : Object.values(archive);
const byId = new Map(rows.map((r) => [String(r.id), r]));
const pairs = gapPairs(rows);
const stats = windowStats(pairs);
const existing = new Set((await readdir(NEWS_DIR).catch(() => [])).map((f) => f.replace(/\.json$/, '')));

const local = (r) => (r?.origin?.length ? r.origin.includes('IN') : INDIAN_LANGUAGES.has(r?.languages?.[0] ?? ''));

const candidates = rows
  .filter((r) => String(r.id).endsWith('~ott') && r.releaseDate && r.platforms?.length && r.firstSeen)
  .filter((r) => daysBetween(r.firstSeen, TODAY) <= FRESH_DAYS && daysBetween(TODAY, r.releaseDate) >= -FRESH_DAYS)
  .map((r) => ({ ott: r, base: byId.get(String(r.id).replace(/~ott$/, '')) ?? null }))
  .filter(({ ott, base }) => local(base ?? ott) && (base?.heat ?? ott.heat ?? 0) >= MIN_HEAT)
  .sort((a, b) => (b.base?.heat ?? b.ott.heat ?? 0) - (a.base?.heat ?? a.ott.heat ?? 0));

/** The article for one arrival, from the data as it stands now. */
function articleFor(ott, base) {
  const film = { ...ott, ...(base ?? {}) };
  const title = film.title;
  const platformId = ott.platforms[0];
  const platform = PLATFORM[platformId] ?? platformId;
  const titleSlug = base?.slug ?? ott.slug ?? slugify(title);
  const slug = `${titleSlug}-ott-release-date-${slugify(platform)}`;

  const lang = LANG[film.languages?.[0]] ?? null;
  const kind = film.kind === 'series' ? 'series' : 'film';
  const cast = (film.cast ?? []).slice(0, 3);
  const arrived = ott.releaseDate <= TODAY;
  const inCinemas = base?.platforms?.includes('theatres') && base.releaseDate < ott.releaseDate;
  const gap = inCinemas ? daysBetween(base.releaseDate, ott.releaseDate) : null;
  /* The film's own gap is left out of the "typical" it is compared with. */
  const others = windowStats(pairs.filter((p) => p.id !== base?.id));
  const typical = others.byLanguage[film.languages?.[0]] ?? others.all;

  const headline = arrived
    ? `${title} is now streaming on ${platform}: OTT release date and where to watch`
    : `${title} OTT release date: streaming on ${platform} from ${spoken(ott.releaseDate)}`;

  const who = cast.length ? `, starring ${cast.join(', ')},` : '';
  const dek = inCinemas
    ? `The ${lang ? `${lang} ` : ''}${kind}${who} ${arrived ? 'arrived' : 'arrives'} on ${platform} ${weeksLabel(gap)} after opening in cinemas on ${spoken(base.releaseDate)}.`
    : `The ${lang ? `${lang} ` : ''}${kind}${who} ${arrived ? 'premiered' : 'premieres'} on ${platform} on ${spoken(ott.releaseDate)}.`;

  const paragraphs = [];
  paragraphs.push(
    arrived
      ? `${title} is streaming on ${platform} in India from ${spoken(ott.releaseDate)}.`
      : `${title} will stream on ${platform} in India from ${spoken(ott.releaseDate)}.`,
  );
  if (inCinemas && typical) {
    const diff = gap - typical.median;
    const pace = Math.abs(diff) <= 3 ? 'in line with' : diff < 0 ? `${Math.abs(diff)} days faster than` : `${diff} days slower than`;
    paragraphs.push(
      `That is ${gap} days after its theatrical release on ${spoken(base.releaseDate)} — ${pace} the typical ${typical.median} days for ${lang ?? 'Indian'} films, based on ${typical.n} recent releases tracked by New on OTT.`,
    );
  }
  if (film.synopsis) paragraphs.push(film.synopsis);
  const credits = [
    film.director ? `Directed by ${film.director}` : null,
    cast.length ? `starring ${(film.cast ?? []).slice(0, 5).join(', ')}` : null,
  ].filter(Boolean).join(', ');
  /* "starring …" opens the sentence when there is no director to lead it. */
  const creditsLine = credits ? credits[0].toUpperCase() + credits.slice(1) : '';
  const specs = [film.runtimeMinutes ? `runs ${film.runtimeMinutes} minutes` : null, film.certification ? `is certified ${film.certification}` : null].filter(Boolean).join(' and ');
  if (creditsLine || specs) paragraphs.push(`${creditsLine ? `${creditsLine}.` : ''}${specs ? ` The ${kind} ${specs}.` : ''}`.trim());
  paragraphs.push(`New on OTT re-checks ${platform}'s India listing every day; the page for ${title} has the latest on where to watch it.`);

  const backdrop = film.backdropUrl ?? null;
  const image = backdrop ? `${SITE}${backdrop.replace(/^https:\/\/image\.tmdb\.org\/t\/p\/w\d+/, '/img/w1280')}` : null;

  return {
    slug,
    status: 'draft',
    headline,
    dek,
    paragraphs,
    title,
    titleSlug,
    titleId: base?.id ?? ott.id,
    platform: platformId,
    ottDate: ott.releaseDate,
    image,
    imageAlt: `${title} — still`,
    source: ott.namedBy
      ? `${title}'s release announcement, as listed on TMDB; not yet confirmed by ${platform}'s own India listing at the time of writing.`
      : `${platform}'s India listing, via TMDB.`,
    createdAt: new Date().toISOString(),
    publishedAt: null,
  };
}

const drafts = [];
for (const { ott, base } of candidates) {
  if (drafts.length >= MAX_DRAFTS) break;
  const article = articleFor(ott, base);
  if (existing.has(article.slug)) continue;
  drafts.push(article);
}

if (!DRY && drafts.length) await mkdir(NEWS_DIR, { recursive: true });
for (const d of drafts) {
  if (!DRY) await writeFile(resolve(NEWS_DIR, `${d.slug}.json`), `${JSON.stringify(d, null, 2)}\n`);
  console.log(`${DRY ? 'would draft' : 'drafted'}: ${d.slug}\n   ${d.headline}`);
}
console.log(`${drafts.length} draft(s) from ${candidates.length} fresh Indian OTT announcement(s).`);

// ------------------------------------------------------------- publish --

/**
 * Every waiting draft, checked against the data as it is now. Publishing is
 * the verification gate and nothing else: verified dates go out, rebuilt
 * from current facts; vanished ones are withdrawn; stale ones expire.
 */
const stamp = new Date().toISOString();
const files = (await readdir(NEWS_DIR).catch(() => [])).filter((f) => f.endsWith('.json'));
const all = [];
for (const f of files) all.push({ f, a: JSON.parse(await readFile(resolve(NEWS_DIR, f), 'utf8')) });

let publishedToday = all.filter((x) => x.a.status === 'published' && (x.a.publishedAt ?? '').slice(0, 10) === stamp.slice(0, 10)).length;
const verdicts = { published: 0, withdrawn: 0, expired: 0, waiting: 0, capped: 0 };

const waiting = all
  .filter((x) => x.a.status === 'draft')
  .sort((x, y) => (byId.get(`${y.a.titleId}`)?.heat ?? 0) - (byId.get(`${x.a.titleId}`)?.heat ?? 0));

for (const { f, a } of waiting) {
  const ottId = String(a.titleId).endsWith('~ott') ? String(a.titleId) : `${a.titleId}~ott`;
  const ott = byId.get(ottId);
  const base = byId.get(String(a.titleId).replace(/~ott$/, '')) ?? null;
  let next = null;
  if (!ott || !ott.platforms?.includes(a.platform)) {
    next = { ...a, status: 'withdrawn', closedAt: stamp };
    verdicts.withdrawn++;
  } else if (daysBetween(ott.releaseDate, TODAY) > EXPIRE_DAYS) {
    next = { ...a, status: 'expired', closedAt: stamp };
    verdicts.expired++;
  } else if (ott.namedBy && ott.releaseDate > TODAY) {
    verdicts.waiting++; // announced, not yet confirmed and not yet due
    continue;
  } else if (publishedToday >= PUBLISH_PER_DAY) {
    verdicts.capped++;
    continue;
  } else {
    const fresh = articleFor(ott, base);
    next = { ...fresh, slug: a.slug, createdAt: a.createdAt, status: 'published', publishedAt: stamp };
    publishedToday++;
    verdicts.published++;
  }
  if (!DRY) await writeFile(resolve(NEWS_DIR, f), `${JSON.stringify(next, null, 2)}\n`);
  console.log(`${DRY ? 'would mark' : 'marked'} ${next.status}: ${a.slug}`);
}
console.log(`Publish pass: ${JSON.stringify(verdicts)}`);
