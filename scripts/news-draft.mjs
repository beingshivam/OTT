#!/usr/bin/env node
/**
 * Drafts a news article when a film's OTT date is announced. Never publishes.
 *
 * Runs in the refresh, after the archive. A draft is a JSON file in data/news
 * with status "draft"; build-static.mjs renders only "published" ones, and
 * only a person makes that change (scripts/news-publish.mjs, or the "Publish
 * article" workflow from the GitHub app). That review is the whole safety
 * case: Google's spam policy calls mass auto-generated articles scaled content
 * abuse, and a reviewed article built on a fact nobody else has is the
 * opposite of that.
 *
 * What counts as news: an Indian title whose streaming date first appeared in
 * the last three days, with enough attention to be searched for. What makes
 * the draft worth reading rather than a reworded press note: the gap between
 * its cinema and OTT dates set against the typical gap for its language,
 * measured from every film this site has tracked (src/lib/ott-estimate.mjs).
 *
 *   node scripts/news-draft.mjs            # writes drafts
 *   node scripts/news-draft.mjs --dry-run  # lists what it would write
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

const archive = JSON.parse(await readFile(resolve(ROOT, 'data/archive.json'), 'utf8')).titles;
const rows = Array.isArray(archive) ? archive : Object.values(archive);
const byId = new Map(rows.map((r) => [String(r.id), r]));
const stats = windowStats(gapPairs(rows));
const existing = new Set((await readdir(NEWS_DIR).catch(() => [])).map((f) => f.replace(/\.json$/, '')));

const local = (r) => (r?.origin?.length ? r.origin.includes('IN') : INDIAN_LANGUAGES.has(r?.languages?.[0] ?? ''));

const candidates = rows
  .filter((r) => String(r.id).endsWith('~ott') && r.releaseDate && r.platforms?.length && r.firstSeen)
  .filter((r) => daysBetween(r.firstSeen, TODAY) <= FRESH_DAYS && daysBetween(TODAY, r.releaseDate) >= -FRESH_DAYS)
  .map((r) => ({ ott: r, base: byId.get(String(r.id).replace(/~ott$/, '')) ?? null }))
  .filter(({ ott, base }) => local(base ?? ott) && (base?.heat ?? ott.heat ?? 0) >= MIN_HEAT)
  .sort((a, b) => (b.base?.heat ?? b.ott.heat ?? 0) - (a.base?.heat ?? a.ott.heat ?? 0));

const drafts = [];
for (const { ott, base } of candidates) {
  if (drafts.length >= MAX_DRAFTS) break;
  const film = { ...ott, ...(base ?? {}) };
  const title = film.title;
  const platformId = ott.platforms[0];
  const platform = PLATFORM[platformId] ?? platformId;
  const titleSlug = base?.slug ?? ott.slug ?? slugify(title);
  const slug = `${titleSlug}-ott-release-date-${slugify(platform)}`;
  if (existing.has(slug)) continue;

  const lang = LANG[film.languages?.[0]] ?? null;
  const kind = film.kind === 'series' ? 'series' : 'film';
  const cast = (film.cast ?? []).slice(0, 3);
  const arrived = ott.releaseDate <= TODAY;
  const inCinemas = base?.platforms?.includes('theatres') && base.releaseDate < ott.releaseDate;
  const gap = inCinemas ? daysBetween(base.releaseDate, ott.releaseDate) : null;
  const typical = stats.byLanguage[film.languages?.[0]] ?? stats.all;

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
  const specs = [film.runtimeMinutes ? `runs ${film.runtimeMinutes} minutes` : null, film.certification ? `is certified ${film.certification}` : null].filter(Boolean).join(' and ');
  if (credits || specs) paragraphs.push(`${credits ? `${credits}.` : ''}${specs ? ` The ${kind} ${specs}.` : ''}`.trim());
  paragraphs.push(`New on OTT re-checks ${platform}'s India listing every day; the page for ${title} has the latest on where to watch it.`);

  const backdrop = film.backdropUrl ?? null;
  const image = backdrop ? `${SITE}${backdrop.replace(/^https:\/\/image\.tmdb\.org\/t\/p\/w\d+/, '/img/w1280')}` : null;

  drafts.push({
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
    reviewNotes: 'Read every line against the platform before publishing. Edit freely; publish with the "Publish article" workflow or node scripts/news-publish.mjs <slug>.',
  });
}

if (!DRY && drafts.length) await mkdir(NEWS_DIR, { recursive: true });
for (const d of drafts) {
  if (!DRY) await writeFile(resolve(NEWS_DIR, `${d.slug}.json`), `${JSON.stringify(d, null, 2)}\n`);
  console.log(`${DRY ? 'would draft' : 'drafted'}: ${d.slug}\n   ${d.headline}`);
}
console.log(`${drafts.length} draft(s) from ${candidates.length} fresh Indian OTT announcement(s).`);
