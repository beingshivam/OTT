import { PLATFORMS, LANGUAGES, platform as platformById, languageName } from '../data/platforms';
import type { Release, ReleaseFeed } from '../types';
import type { Route } from '../lib/route';
import { platformLinkText } from './BrowseLinks';

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

  const matches = (r: Release) =>
    route.platforms
      ? route.platforms.every((p) => r.platforms.includes(p))
      : route.languages
        ? route.languages.every((l) => (r.languages ?? []).includes(l))
        : true;

  const weeks = route.weekId ? feed.weeks.filter((w) => w.id === route.weekId) : feed.weeks;
  const scope = weeks.flatMap((w) => w.releases.filter(inRegion).filter(matches));
  if (!scope.length) return null;

  const thisWeek = (feed.weeks.find((w) => w.id === currentWeek)?.releases ?? [])
    .filter(inRegion)
    .filter(matches);

  // This week if there is one, otherwise the whole scope — a page should never
  // show an empty "biggest" row just because a quiet week is on screen.
  const biggest = [...(thisWeek.length ? thisWeek : scope)]
    .sort((a, b) => (b.heat ?? 0) - (a.heat ?? 0))
    .slice(0, 3);

  const bestRated = [...scope]
    .filter((r) => r.rating != null && (r.votes == null || r.votes >= STRONG_VOTES))
    .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))[0];

  const films = scope.filter((r) => r.kind === 'film').length;
  const series = scope.length - films;

  const heading = route.platforms
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
  const cross = route.languages
    ? {
        label: 'Mostly on',
        items: tally(scope, (r) => r.platforms)
          .slice(0, 4)
          .map(([id, n]) => ({
            key: id,
            text: platformLinkText(platformById(id).name),
            href: PLATFORMS.some((p) => p.id === id) ? `/${id}` : undefined,
            n,
          })),
      }
    : route.platforms
      ? {
          label: 'Mostly in',
          items: tally(scope, (r) => r.languages ?? [])
            .slice(0, 4)
            .map(([code, n]) => ({
              key: code,
              text: languageName(code),
              href: LANGUAGES[code] ? `/${LANGUAGES[code].toLowerCase()}` : undefined,
              n,
            })),
        }
      : null;

  return (
    <section className="pageintro">
      {/* The one h1 on the page. The week bar's date steps down to a plain
          element here so a reader and a crawler are told the same thing about
          what this page is — two h1s saying different things is worse than
          either alone. */}
      <h1 className="pageintro__title">{heading}</h1>
      <p className="pageintro__stat">
        <strong>{scope.length}</strong> {scope.length === 1 ? 'title' : 'titles'}
        {!route.weekId && <> across {weeks.filter((w) => w.releases.some(matches)).length} weeks</>}
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
            <span className="pageintro__label">
              {thisWeek.length ? 'Biggest this week' : 'Biggest right now'}
            </span>
            <span className="pageintro__vals">
              {biggest.map((r) => (
                <button key={r.id} className="pageintro__pill" onClick={() => onOpen(r)}>
                  {r.title}
                </button>
              ))}
            </span>
          </div>
        )}

        {cross && cross.items.length > 0 && (
          <div className="pageintro__fact">
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
