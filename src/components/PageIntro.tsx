import { PLATFORMS, LANGUAGES, platform as platformById, languageName } from '../data/platforms';
import type { Release, ReleaseFeed } from '../types';
import type { Route } from '../lib/route';
import { collectionBySlug, inCollection } from '../data/collections';
import { platformLinkText } from './BrowseLinks';
import { BRAND } from '../data/brand';

/**
 * What a page says that the homepage does not.
 *
 * The per-platform and per-language pages shipped as the homepage wearing a
 * filter: same board, same controls, one chip pre-selected. That is a thin
 * page in the sense that matters twice over — a reader who lands on /tamil
 * from a search learns nothing the board did not already tell them, and a
 * crawler comparing twenty-four near-identical documents has every reason to
 * keep one and drop the rest.
 *
 * So each page leads with the answers it is uniquely placed to give, computed
 * across every week in the feed rather than the one on screen:
 *
 *   platform   what is biggest on it this week, which languages it carries,
 *              its best-rated title
 *   language   the same, plus where that language actually lands — the
 *              platform split is the genuinely useful fact nobody publishes,
 *              and it is the reason a Tamil viewer would bookmark the page
 *   week       the biggest release of that week, and how it splits
 *
 * All of it comes from data already in the feed. None of it is invented, and
 * every figure is derived rather than written down, so nothing here can go
 * stale against the board underneath it.
 */

interface Props {
  route: Route;
  feed: ReleaseFeed;
  region: string;
  currentWeek: string;
  onOpen: (r: Release) => void;
}

/** A rating is only worth quoting when enough people voted on it — the same
 *  bar the star uses, so the page and the board never disagree about which
 *  titles count as well-reviewed. */
const STRONG_VOTES = 50;

const tally = (rows: Release[], pick: (r: Release) => string[]) => {
  const counts = new Map<string, number>();
  for (const r of rows) for (const k of pick(r)) counts.set(k, (counts.get(k) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
};

export function PageIntro({ route, feed, region, currentWeek, onOpen }: Props) {
  const inRegion = (r: Release) => r.regions.includes(region);

  /**
   * "Any of", matching what the board's own filter does (lib/filters.ts uses
   * .some for both). This read .every, which is identical for a route naming
   * one platform or one language and silently wrong the moment one names
   * several: /south would have demanded a title be in Tamil *and* Telugu *and*
   * Malayalam *and* Kannada, matched nothing, and rendered no intro at all
   * while the board below it showed seventy titles.
   */
  const collection = route.collection ? collectionBySlug(route.collection) : undefined;

  const matches = (r: Release) =>
    collection
      ? inCollection(collection, r)
      : route.platforms
        ? route.platforms.some((p) => r.platforms.includes(p))
        : route.languages
          ? route.languages.some((l) => (r.languages ?? []).includes(l))
          : true;

  const weeks = route.weekId ? feed.weeks.filter((w) => w.id === route.weekId) : feed.weeks;
  /** A span page is bounded by dates rather than by a facet, so its scope is a
   *  date test on top of whatever else the route said. */
  const inSpan = (r: Release) =>
    !route.span || (r.releaseDate >= route.span.from && r.releaseDate <= route.span.to);
  const scope = weeks.flatMap((w) => w.releases.filter(inRegion).filter(matches).filter(inSpan));
  if (!scope.length) return null;

  const thisWeek = (feed.weeks.find((w) => w.id === currentWeek)?.releases ?? [])
    .filter(inRegion)
    .filter(matches)
    .filter(inSpan);

  /**
   * This week if there is one, otherwise the whole scope — a page should never
   * show an empty "biggest" row just because a quiet week is on screen.
   *
   * A span page is the exception and ranks its whole span: the page is about
   * September, or about what is still to come, so narrowing "biggest" to the
   * five days of it that fall in the current week answers a question the page
   * never asked. On /upcoming that produced the visible bug — this row named
   * the tail of the current week while the strip below it ranked all 64 rows,
   * and both were labelled "Biggest this week".
   */
  const ranked = route.span ? scope : thisWeek.length ? thisWeek : scope;
  const biggest = [...ranked].sort((a, b) => (b.heat ?? 0) - (a.heat ?? 0)).slice(0, 3);

  const biggestLabel = route.span
    ? route.span.kind === 'upcoming'
      ? 'Biggest coming up'
      : `Biggest in ${route.span.label}`
    : thisWeek.length
      ? 'Biggest this week'
      : 'Biggest right now';

  const bestRated = [...scope]
    .filter((r) => r.rating != null && (r.votes == null || r.votes >= STRONG_VOTES))
    .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))[0];

  const films = scope.filter((r) => r.kind === 'film').length;
  const series = scope.length - films;

  const heading = route.span
    ? route.span.kind === 'upcoming'
      ? 'Coming soon'
      : `Releases in ${route.span.label}`
    : collection
    ? collection.label
    : route.platforms
      ? (() => {
          const p = platformById(route.platforms[0]);
          return p.id === 'theatres' ? 'New in cinemas' : `New on ${p.name}`;
        })()
      : route.languages
        ? `New ${languageName(route.languages[0])} releases`
        : 'New releases';

  /**
   * The cross-cut: which platforms a language lands on, or which languages a
   * platform carries. This is the fact the page exists to publish — no one
   * else answers "where do Tamil releases actually go", and it is a different
   * answer every month.
   */
  const byPlatform = {
    label: 'Mostly on',
    items: tally(scope, (r) => r.platforms)
      .slice(0, 4)
      .map(([id, n]) => ({
        key: id,
        text: platformLinkText(platformById(id).name),
        href: PLATFORMS.some((p) => p.id === id) ? `/${id}` : undefined,
        n,
      })),
  };

  /**
   * Only the collection's own languages, and all of them — the whole point of
   * the page is the split between them, and linking each to its own page is
   * how someone who wanted Malayalam specifically gets there from here.
   */
  const byLanguage = (limit: number, only?: string[]) => ({
    label: 'Languages',
    items: tally(scope, (r) => (r.languages ?? []).filter((l) => !only || only.includes(l)))
      .slice(0, limit)
      .map(([code, n]) => ({
        key: code,
        text: languageName(code),
        href: LANGUAGES[code] ? `/${LANGUAGES[code].toLowerCase()}` : undefined,
        n,
      })),
  });

  const crosses = route.span
    ? /* A month names no facet of its own, so both splits are new information:
         where the month's releases land, and what languages it is carrying. */
      [byPlatform, byLanguage(5)]
    : collection
    ? collection.languages
      ? [byLanguage(collection.languages.length, collection.languages), byPlatform]
      : [byPlatform, byLanguage(4)]
    : route.languages
      ? [byPlatform]
      : route.platforms
        ? [{ ...byLanguage(4), label: 'Mostly in' }]
        : [];

  return (
    <section className="pageintro">
      {/* A visible trail, matching the BreadcrumbList the build emits for this
          page. Schema describing a trail the reader cannot see is a claim
          about the page that the page does not keep — and the second way
          back, after the wordmark. */}
      <nav className="crumbs" aria-label="Breadcrumb">
        <a href="/">{BRAND}</a>
        <span aria-hidden="true">›</span>
        <span>{heading}</span>
      </nav>

      {/* The one h1 on the page. The week bar's date steps down to a plain
          element here so a reader and a crawler are told the same thing about
          what this page is — two h1s saying different things is worse than
          either alone. */}
      <h1 className="pageintro__title">{heading}</h1>
      <p className="pageintro__stat">
        <strong>{scope.length}</strong> {scope.length === 1 ? 'title' : 'titles'}
        {!route.weekId && (
          <>
            {' '}
            across{' '}
            {weeks.filter((w) => w.releases.some((r) => matches(r) && inSpan(r))).length} weeks
          </>
        )}
        {films > 0 && series > 0 && (
          <>
            {' · '}
            {films} {films === 1 ? 'film' : 'films'}, {series} {series === 1 ? 'series' : 'series'}
          </>
        )}
      </p>

      <div className="pageintro__facts">
        {biggest.length > 0 && (
          <div className="pageintro__fact">
            <span className="pageintro__label">{biggestLabel}</span>
            <span className="pageintro__vals">
              {biggest.map((r) => (
                <button key={r.id} className="pageintro__pill" onClick={() => onOpen(r)}>
                  {r.title}
                </button>
              ))}
            </span>
          </div>
        )}

        {crosses.map((cross) =>
          cross.items.length === 0 ? null : (
            <div className="pageintro__fact" key={cross.label}>
              <span className="pageintro__label">{cross.label}</span>
              <span className="pageintro__vals">
                {cross.items.map((i) =>
                  i.href ? (
                    <a key={i.key} className="pageintro__pill" href={i.href}>
                      {i.text} <em>{i.n}</em>
                    </a>
                  ) : (
                    <span key={i.key} className="pageintro__pill">
                      {i.text} <em>{i.n}</em>
                    </span>
                  ),
                )}
              </span>
            </div>
          ),
        )}

        {bestRated && (
          <div className="pageintro__fact">
            <span className="pageintro__label">Best rated</span>
            <span className="pageintro__vals">
              <button className="pageintro__pill" onClick={() => onOpen(bestRated)}>
                {bestRated.title} <em>★ {bestRated.rating?.toFixed(1)}</em>
              </button>
            </span>
          </div>
        )}
      </div>
    </section>
  );
}
