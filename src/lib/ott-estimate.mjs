/**
 * When a film still only in cinemas is likely to reach OTT — measured, never
 * invented.
 *
 * The search this site exists for is "<film> OTT release date", asked while a
 * film is in cinemas and nobody has announced anything. The page used to
 * answer "not announced yet", which is true and gives the reader nothing:
 * Jeevan Bheema Yojana ranked #2 for exactly that query (Search Console,
 * Sep–Oct) and 98% of the people who saw it did not click, because the
 * snippet told them there was nothing to find.
 *
 * What nobody else publishes is the pattern. The archive holds every film
 * this site has seen in cinemas *and* later on a service, with both dates.
 * On 13 Nov that was 41 Indian films: Tamil and Telugu typically landed 28
 * days after opening, Malayalam 35, Hindi 56. That is an estimate a reader
 * can use, honestly labelled as one, with the evidence named beside it.
 *
 * Plain JavaScript, like platform-claim.mjs, so the prerendered page, the
 * grader and the app all read one rule. The build measures the gaps and
 * attaches `ottEstimate` to each row; the app only formats what it is given.
 */

const DAY = 86_400_000;
export const INDIAN_LANGUAGES = new Set(['hi', 'ta', 'te', 'ml', 'kn', 'bn', 'mr', 'pa', 'gu', 'or', 'as']);

/** Below this many films a language borrows the all-India pattern instead. */
export const MIN_SAMPLE = 5;

/* A gap outside this range is not a release window: under a week is a
   day-and-date or a data slip, over six months a catalogue pickup. */
const MIN_GAP = 7;
const MAX_GAP = 180;

const isLocal = (r) =>
  r?.origin?.length ? r.origin.includes('IN') : INDIAN_LANGUAGES.has(r?.languages?.[0] ?? '');

const days = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

/** Every Indian film seen both in cinemas and arriving on a service. */
export function gapPairs(rows) {
  const byId = new Map(rows.map((r) => [String(r.id), r]));
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    const id = String(r.id);
    if (!id.endsWith('~ott') || !r.releaseDate || !r.platforms?.length) continue;
    const base = byId.get(id.replace(/~ott$/, ''));
    if (!base?.releaseDate || !base.platforms?.includes('theatres') || !isLocal(base)) continue;
    if (seen.has(base.id)) continue;
    const gap = days(base.releaseDate, r.releaseDate);
    if (gap < MIN_GAP || gap > MAX_GAP) continue;
    seen.add(base.id);
    out.push({ id: base.id, language: base.languages?.[0] ?? '', days: gap });
  }
  return out;
}

function summarise(values) {
  const v = [...values].sort((a, b) => a - b);
  const q = (p) => v[Math.floor(p * (v.length - 1))];
  return { n: v.length, median: q(0.5), p25: q(0.25), p75: q(0.75) };
}

/** Typical gaps per language, and across every Indian film. */
export function windowStats(pairs) {
  const byLanguage = {};
  const groups = new Map();
  for (const p of pairs) {
    if (!groups.has(p.language)) groups.set(p.language, []);
    groups.get(p.language).push(p.days);
  }
  for (const [lang, v] of groups) if (v.length >= MIN_SAMPLE) byLanguage[lang] = summarise(v);
  return { byLanguage, all: pairs.length >= MIN_SAMPLE ? summarise(pairs.map((p) => p.days)) : null };
}

/**
 * The window for one film, or null when there is nothing honest to say.
 *
 * Only an Indian film with a cinema date and no streaming date yet — anything
 * with a service or an announced date already has a better answer than an
 * estimate. `basis` names the evidence so every surface can show it.
 */
export function estimateFor(row, stats) {
  if (!row?.releaseDate || !row.platforms?.includes('theatres') || !isLocal(row)) return null;
  const lang = row.languages?.[0] ?? '';
  const own = stats?.byLanguage?.[lang];
  const s = own ?? stats?.all;
  if (!s) return null;
  return {
    likely: addDays(row.releaseDate, s.median),
    from: addDays(row.releaseDate, s.p25),
    to: addDays(row.releaseDate, Math.max(s.p75, s.median)),
    days: s.median,
    basis: { language: own ? lang : null, films: s.n },
  };
}

/**
 * Where today sits against the window. `ahead` before it opens, `due` inside
 * it, `late` once even the slower films of its kind have landed — when the
 * honest thing is to say this one is running behind, not to keep promising a
 * date that has passed.
 */
export function estimatePhase(est, today) {
  if (!est) return null;
  if (today < est.from) return 'ahead';
  if (today <= est.to) return 'due';
  return 'late';
}

/** "4 weeks" for 28, "5 weeks" for 35, days otherwise. */
export function weeksLabel(n) {
  return n % 7 === 0 ? `${n / 7} weeks` : `${n} days`;
}

/**
 * The words, decided once. The prerendered page and the app both call this,
 * each passing its own date formatter, so a reader never sees the static copy
 * say one thing and the hydrated page another.
 *
 * Every phase says "not announced" somewhere: this is an estimate beside the
 * truth, never in place of it.
 */
export function estimateCopy(est, today, { languageLabel, formatDate }) {
  const phase = estimatePhase(est, today);
  if (!phase) return null;
  const lang = est.basis.language ? languageLabel(est.basis.language) : 'Indian';
  const films = `${est.basis.films} recent ${lang} films`;
  const gap = weeksLabel(est.days);
  const between = `between ${formatDate(est.from)} and ${formatDate(est.to)}`;
  const after = ' This page updates the day a platform confirms it.';
  if (phase === 'ahead') {
    return {
      phase,
      headline: `Expected on OTT around ${formatDate(est.likely)}`,
      detail: `Not announced yet. ${films[0].toUpperCase()}${films.slice(1)} reached OTT a typical ${gap} after cinemas, usually ${between} for a film opening on this date.${after}`,
      fact: `around ${formatDate(est.likely)} (estimate)`,
      tag: `expected ${formatDate(est.likely)}`,
    };
  }
  if (phase === 'due') {
    return {
      phase,
      headline: 'Expected on OTT any day now',
      detail: `Not announced yet, but ${lang} films typically reach OTT ${gap} after cinemas — ${between} for this one, based on ${films}.${after}`,
      fact: `any day now (estimate, ${between})`,
      tag: 'expected soon',
    };
  }
  return {
    phase,
    headline: 'OTT date not announced yet',
    detail: `It is running later than usual: ${films} reached OTT a typical ${gap} after cinemas, which would have been around ${formatDate(est.likely)}.${after}`,
    fact: null,
    tag: null,
  };
}
