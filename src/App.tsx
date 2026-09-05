import { useCallback, useEffect, useMemo, useState } from 'react';
import { Board } from './components/Board';
import { BrowseLinks } from './components/BrowseLinks';
import { PageIntro } from './components/PageIntro';
import { Controls } from './components/Controls';
import { DetailSheet } from './components/DetailSheet';
import { EmailSignup } from './components/EmailSignup';
import { ReleaseCard } from './components/ReleaseCard';
import { ShareWeek } from './components/ShareWeek';
import { TrendingStrip, normalise } from './components/TrendingStrip';
import {
  IconCalendar,
  IconChevronLeft,
  IconChevronRight,
  IconInstagram,
  IconPlay,
  IconSearch,
} from './components/icons';
import { BRAND, INSTAGRAM, INSTAGRAM_URL, SLUG, TAGLINE } from './data/brand';
import { REGIONS } from './data/platforms';
import { loadFeed, weekById } from './lib/feed';
import {
  applyFilters,
  facetsFor,
  activeFilterCount,
  sortReleases,
  EMPTY_FILTERS,
} from './lib/filters';
import { DEFAULT_PREFS, guessRegion, loadPrefs, savePrefs, type Prefs } from './lib/prefs';
import { download } from './lib/download';
import { weeklyReminder } from './lib/reminder';
import { nextRefreshLabel, refreshDaysLabel, relativeTime } from './lib/freshness';
import { suggestions } from './lib/suggest';
import { useKeyboard } from './lib/useKeyboard';
import { routeFilters } from './lib/route';
import { readFilters, writeFilters } from './lib/urlState';
import {
  addDays,
  daysOfWeek,
  formatDay,
  formatWeekRange,
  isToday,
  relativeWeekLabel,
  weekIdFor,
} from './lib/week';
import type { Filters, Release, ReleaseFeed } from './types';

/** How far the week arrows will wander from today. Beyond this there is no data worth showing. */
const WEEK_RANGE = 8;

export default function App() {
  const [feed, setFeed] = useState<ReleaseFeed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [selected, setSelected] = useState<Release | null>(null);

  const today = useMemo(() => new Date(), []);
  const currentWeek = useMemo(() => weekIdFor(today), [today]);

  /**
   * What the path already says: /netflix, /tamil, /w/<date>. Null on "/", which
   * is every visit the site had before these pages existed — so the homepage
   * takes exactly the code path it always did.
   */
  const route = useMemo(() => routeFilters(window.location.pathname), []);

  const [filters, setFilters] = useState<Filters>(() =>
    readFilters({ weekId: weekIdFor(new Date()), region: 'IN' }, route),
  );
  // A week the reader actually asked for — via the arrows, or an inbound ?w —
  // is worth keeping in the URL. The landing auto-jump is not.
  // A /w/<date> page is as explicit as ?w= — the reader asked for that week by
  // clicking a search result for it. Without this, stepping to the next week
  // from an archive page would not reach the URL at all.
  const [weekPinned, setWeekPinned] = useState(
    () => new URLSearchParams(window.location.search).has('w') || Boolean(route?.weekId),
  );
  // Same distinction for the region: an inbound ?r, or a deliberate switch, is
  // the reader's choice and belongs in every link they copy from here. The
  // locale guess is not.
  const [regionPinned, setRegionPinned] = useState(
    () => new URLSearchParams(window.location.search).has('r'),
  );

  // Board is the default: the whole week at a glance, the way the printed
  // calendars do it. The poster grid stays available for browsing.
  //
  // The key still says dropday, and stays that way: it is an opaque storage key,
  // not a label anyone sees, and renaming it would silently reset the layout
  // choice of everyone who has already been here.
  const [view, setView] = useState<'board' | 'grid'>(() => {
    try {
      return localStorage.getItem('dropday.view') === 'grid' ? 'grid' : 'board';
    } catch {
      // Blocked site data throws on read, not just on write — and unguarded
      // here it would take the whole page down rather than lose a preference.
      return 'board';
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('dropday.view', view);
    } catch {
      /* Storage is a convenience here, never a requirement. */
    }
  }, [view]);

  // Restore device preferences before the first paint of real content so the
  // region never visibly flips underneath the user.
  useEffect(() => {
    const stored = loadPrefs();
    const resolved: Prefs = { region: stored.region || guessRegion() };
    setPrefs(resolved);
    const fromUrl = new URLSearchParams(window.location.search).get('r');
    if (!fromUrl) setFilters((f) => ({ ...f, region: resolved.region }));
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    loadFeed(controller.signal)
      .then((loaded) => {
        setFeed(loaded);
        // Never land someone on an empty page. If the live week hasn't been
        // pulled yet — early in the week, or a stale feed — open the closest
        // week that actually has releases. An explicit ?w= always wins.
        // An explicitly requested week always wins — from ?w=, and equally from
        // a /w/<date> page, whose whole purpose is to show that one week. This
        // check used to read the query string only, so an archive page would
        // silently bounce the reader to the nearest stocked week and render
        // something other than what its own title promised.
        const pinned = new URLSearchParams(window.location.search).get('w') ?? route?.weekId;
        if (pinned) return;
        const stocked = loaded.weeks.filter((w) => w.releases.length > 0);
        if (!stocked.length) return;
        const current = weekIdFor(new Date());
        if (stocked.some((w) => w.id === current)) return;
        const nearest = stocked.reduce((best, w) =>
          Math.abs(Date.parse(w.id) - Date.parse(current)) <
          Math.abs(Date.parse(best.id) - Date.parse(current))
            ? w
            : best,
        );
        setFilters((f) => ({ ...f, weekId: nearest.id }));
      })
      .catch((e: unknown) => {
        if ((e as Error).name !== 'AbortError') setError((e as Error).message);
      });
    return () => controller.abort();
  }, [route]);

  useEffect(() => {
    writeFilters(
      filters,
      { weekId: currentWeek, region: prefs.region },
      { week: weekPinned, region: regionPinned },
      route,
    );
  }, [filters, currentWeek, prefs.region, weekPinned, regionPinned, route]);

  const update = useCallback((next: Partial<Filters>) => {
    setFilters((f) => ({ ...f, ...next }));
  }, []);

  const resetFilters = useCallback(() => {
    setFilters((f) => ({ ...f, ...EMPTY_FILTERS }));
  }, []);

  const addWeeklyReminder = useCallback(() => {
    download(weeklyReminder(window.location.origin), `${SLUG}-friday.ics`);
  }, []);

  const updatePrefs = useCallback((next: Partial<Prefs>) => {
    setPrefs((p) => {
      const merged = { ...p, ...next };
      savePrefs(merged);
      return merged;
    });
  }, []);

  const week = weekById(feed, filters.weekId);
  const releases = week?.releases ?? [];
  const facets = useMemo(() => facetsFor(releases, filters.region), [releases, filters.region]);
  /**
   * The week's own titles, ranked by how much attention they are getting.
   *
   * This used to lead with TMDB's global trending list, and on a page whose
   * whole promise is "what's new this week" that put Reacher (2022), Ted Lasso
   * (2020) and Bleach (2004) across the top of the board. Two of the eleven
   * entries were actually from the week on screen. It answered a question
   * nobody had come here to ask, in the most prominent slot on the page.
   *
   * Ranking the week instead surfaces the thing people mean when they ask what
   * the big release is — Mirzapur opening in cinemas, not a four-year-old
   * series peaking again. Global trending stays as the fallback for a week too
   * thin to rank, and the label says which one it got so the claim stays true.
   */
  const trendingNow = useMemo(() => {
    const scoped = releases.filter((r) => r.regions.includes(filters.region));
    if (scoped.length >= 3) return { list: sortReleases(scoped, 'trending'), live: false };
    const live = (feed?.trending ?? []).filter((r) => r.regions.includes(filters.region));
    return { list: live, live: true };
  }, [feed, releases, filters.region]);

  /** Weeks the feed actually carries, for the empty state to offer. */
  const stockedWeeks = useMemo(
    () =>
      (feed?.weeks ?? []).filter((w) =>
        w.releases.some((r) => r.regions.includes(filters.region)),
      ),
    [feed, filters.region],
  );

  const thisWeekTitles = useMemo(
    () => new Set(releases.map((r) => normalise(r.title))),
    [releases],
  );

  const missingArtwork = useMemo(
    () => releases.filter((r) => r.regions.includes(filters.region) && !r.posterUrl).length,
    [releases, filters.region],
  );
  const visible = useMemo(() => applyFilters(releases, filters), [releases, filters]);

  // Only computed when the week comes back empty, so the extra passes over the
  // other weeks cost nothing in the normal case.
  const nearMisses = useMemo(
    () => (visible.length === 0 ? suggestions(feed, filters) : []),
    [feed, filters, visible.length],
  );

  const weekOffset = useMemo(() => {
    const diff = Math.round(
      (new Date(`${filters.weekId}T00:00:00Z`).getTime() -
        new Date(`${currentWeek}T00:00:00Z`).getTime()) /
        (7 * 86_400_000),
    );
    return diff;
  }, [filters.weekId, currentWeek]);

  const stepWeek = (delta: number) => {
    setWeekPinned(true);
    update({ weekId: addDays(filters.weekId, delta * 7) });
  };

  const goToCurrentWeek = () => {
    setWeekPinned(true);
    update({ weekId: currentWeek });
  };

  useKeyboard({
    onPrevWeek: () => stepWeek(-1),
    onNextWeek: () => stepWeek(1),
    blocked: selected !== null,
  });

  /** Trending is a browse aid; once the reader has narrowed the week it is noise. */
  const userNarrowed = activeFilterCount(filters) > 0;

  const byDay = useMemo(() => {
    const map = new Map<string, Release[]>();
    for (const r of visible) {
      const list = map.get(r.releaseDate);
      if (list) list.push(r);
      else map.set(r.releaseDate, [r]);
    }
    return daysOfWeek(filters.weekId)
      .map((d) => [d, map.get(d) ?? []] as const)
      .filter(([, list]) => list.length > 0);
  }, [visible, filters.weekId]);

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to releases
      </a>

      {/* Identity, week and controls in one band. A dedicated nav row carried a
          logo and a region picker and cost 60px of a page that promises the
          whole week at a glance. */}
      <div className="shell weekbar">
        <div className="weekbar__brand">
          <span className="logo">
            <span className="logo__mark">
              <IconPlay />
            </span>
            {/* Wordmark and dot share one flex item, or the .logo gap pushes
                the dot away from the name it belongs to. */}
            <span>
              {BRAND}
              <span className="logo__dot">.</span>
            </span>
          </span>
          <div className="weekbar__region">
            <label className="region">
              <span aria-hidden="true">
                {REGIONS.find((r) => r.code === filters.region)?.flag ?? '🌐'}
              </span>
              <span className="sr-only">Region</span>
              <select
                value={filters.region}
                onChange={(e) => {
                  setRegionPinned(true);
                  update({ region: e.target.value, platforms: [] });
                  updatePrefs({ region: e.target.value });
                }}
              >
                {REGIONS.map((r) => (
                  <option key={r.code} value={r.code}>
                    {r.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <div className="weekbar__week">
          <button
            className="weeknav__btn"
            onClick={() => stepWeek(-1)}
            disabled={weekOffset <= -WEEK_RANGE}
            aria-label="Previous week"
          >
            <IconChevronLeft />
          </button>
          {route ? (
            <p className="weekbar__date">{formatWeekRange(filters.weekId)}</p>
          ) : (
            <h1 className="weekbar__date">{formatWeekRange(filters.weekId)}</h1>
          )}
          <button
            className="weeknav__btn"
            onClick={() => stepWeek(1)}
            disabled={weekOffset >= WEEK_RANGE}
            aria-label="Next week"
          >
            <IconChevronRight />
          </button>
          <span className="weekbar__rel">{relativeWeekLabel(filters.weekId, today)}</span>
          {weekOffset !== 0 && (
            <button className="weeknav__today" onClick={goToCurrentWeek}>
              This week
            </button>
          )}
        </div>

        <div className="weekbar__right">
          <span className="weekbar__count">
            <strong>{facets.total}</strong> releases ·{' '}
            <strong>{facets.platforms.length}</strong> platforms
          </span>
          {feed && (
            <span
              className="weekbar__fresh"
              title={`Next refresh ${nextRefreshLabel()}`}
            >
              <i />
              Updated {relativeTime(feed.generatedAt)}
            </span>
          )}
          <ShareWeek releases={visible} filters={filters} />
          <span className="viewtoggle" role="group" aria-label="Layout">
            <button data-on={view === 'board'} onClick={() => setView('board')}>
              Board
            </button>
            <button data-on={view === 'grid'} onClick={() => setView('grid')}>
              Posters
            </button>
          </span>
        </div>
      </div>

      {/* Only on a page that promised something specific. On "/" this renders
          nothing and the layout is exactly what it was. */}
      {route && feed && (
        <PageIntro
          route={route}
          feed={feed}
          region={filters.region}
          currentWeek={currentWeek}
          onOpen={setSelected}
        />
      )}

      <Controls
        filters={filters}
        facets={facets}
        resultCount={visible.length}
        onChange={update}
        onReset={resetFilters}
      />

      <main className="shell" id="main">
        {/* Above the board so it is actually seen, below the week header so the
            reader has the thing they came for before being asked for anything.
            One line, and dismissing it is permanent on that device. */}
        <EmailSignup variant="banner" />

        {error && (
          <div className="empty">
            <span className="empty__icon">
              <IconCalendar />
            </span>
            <h3>We couldn't load this week</h3>
            <p>{error}</p>
            <div className="empty__actions">
              <button className="btn btn--lg" onClick={() => window.location.reload()}>
                Try again
              </button>
            </div>
          </div>
        )}

        {!feed && !error && <LoadingBoard view={view} />}

        {feed && !error && facets.total === 0 && (
          <div className="empty">
            <span className="empty__icon">
              <IconCalendar />
            </span>
            <h3>Nothing scheduled here yet</h3>
            <p>
              {formatWeekRange(filters.weekId)} hasn't been pulled into the calendar yet. The
              refresh covers several weeks either side, so past and upcoming weeks fill in once it
              runs.
            </p>
            {/* A dead end otherwise: say which weeks do have data and go there in
                one tap, rather than leaving the arrows to be guessed at. */}
            {stockedWeeks.length > 0 && (
              <>
                <p style={{ marginTop: -4 }}>
                  Right now the calendar covers{' '}
                  {stockedWeeks.length === 1 ? 'one week' : `${stockedWeeks.length} weeks`}:
                </p>
                <div className="empty__actions">
                  {stockedWeeks.map((w) => (
                    <button
                      key={w.id}
                      className="btn btn--lg"
                      onClick={() => {
                        setWeekPinned(true);
                        update({ weekId: w.id });
                      }}
                    >
                      {formatWeekRange(w.id)}
                      <span className="btn__count">{w.releases.length}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {feed && !error && facets.total > 0 && (
          <>
            {!userNarrowed && (
              <TrendingStrip
                releases={trendingNow.list}
                live={trendingNow.live}
                thisWeekIds={thisWeekTitles}
                onOpen={setSelected}
              />
            )}

            {visible.length === 0 ? (
              <div className="empty">
                <span className="empty__icon">
                  <IconSearch />
                </span>
                <h3>No matches in this week</h3>
                <p>
                  {nearMisses.length
                    ? 'Nothing fits all of those at once. Here is the closest thing that does:'
                    : 'Nothing here fits those filters.'}
                </p>
                {/* Offering only "clear filters" is a shrug. Name the nearest
                    thing that exists and take them there in one tap. */}
                <div className="empty__actions">
                  {nearMisses.map((s) => (
                    <button
                      key={s.label}
                      className="btn btn--lg"
                      onClick={() => {
                        if (s.patch.weekId) setWeekPinned(true);
                        update(s.patch);
                      }}
                    >
                      {s.label}
                    </button>
                  ))}
                  <button className="btn btn--lg" onClick={resetFilters}>
                    Clear filters
                  </button>
                </div>
              </div>
            ) : view === 'board' ? (
              <Board releases={visible} onOpen={setSelected} multiDay={byDay.length > 1} />
            ) : (
              byDay.map(([date, list]) => {
                const d = formatDay(date);
                return (
                  <section className="day" key={date} aria-label={`${d.weekday} ${d.day} ${d.month}`}>
                    <div className="day__head">
                      <span className="day__date">
                        <span className="day__weekday">{d.weekday}</span>
                        <span className="day__num">{d.day}</span>
                        <span className="day__month">{d.month}</span>
                      </span>
                      {isToday(date, today) && <span className="day__today">TODAY</span>}
                      <span className="day__rule" />
                      <span className="day__count">{list.length}</span>
                    </div>
                    <div className="grid">
                      {list.map((r, i) => (
                        <ReleaseCard key={r.id} release={r} onOpen={setSelected} index={i} />
                      ))}
                    </div>
                  </section>
                );
              })
            )}
          </>
        )}

        {/* Context, not a headline — so it sits with the other provenance notes
            rather than between the reader and the week. */}
        {feed?.source === 'sample' && missingArtwork > 0 && (
          <p className="notice">
            <span aria-hidden="true">📅</span>
            <span>
              <strong>Curated schedule</strong> — {missingArtwork} of {facets.total} titles still
              awaiting artwork and synopses.
            </span>
          </p>
        )}

        {/* Above the footer proper: the crawlable, clickable route to every
            other page on the site. See components/BrowseLinks.tsx. */}
        <BrowseLinks feed={feed} region={filters.region} />

        <footer className="footer">
          <div className="footer__stack">
            <span>
              {BRAND} — {TAGLINE}
            </span>
            <button className="footer__link" onClick={addWeeklyReminder}>
              <IconCalendar />
              Remind me every Friday
            </button>
            {/* The other way to not have to remember this site exists. Sits
                beside the calendar button because they answer the same
                question — how do I see next week's list — and one of them
                needs no app permission. */}
            <a
              className="footer__link"
              href={INSTAGRAM_URL}
              target="_blank"
              rel="noreferrer noopener"
            >
              <IconInstagram />@{INSTAGRAM}
            </a>
            <EmailSignup />
          </div>
          <div className="footer__stack">
            <span>Refreshes {refreshDaysLabel()}</span>
            {/* Says whose scores these are — they are TMDB's, not IMDb's, and
                the two differ by a few tenths often enough that leaving a bare
                star to be read as IMDb would be misleading. The wording is also
                what TMDB's API terms ask for in return for the data. */}
            <span className="footer__credit">
              Ratings and release data from{' '}
              <a href="https://www.themoviedb.org/" target="_blank" rel="noreferrer noopener">
                TMDB
              </a>
              . This product uses the TMDB API but is not endorsed or certified by TMDB.
            </span>
          </div>
        </footer>
      </main>

      {selected && <DetailSheet release={selected} onClose={() => setSelected(null)} />}
    </>
  );
}

/**
 * The placeholder has to be the shape of the thing arriving, or the page
 * visibly rearranges itself the moment data lands. This mirrors the board's own
 * panel-and-row structure, with panel sizes varied so it reads as a real week
 * rather than a uniform grid.
 */
function LoadingBoard({ view }: { view: 'board' | 'grid' }) {
  if (view === 'grid') {
    return (
      <div className="grid" aria-hidden="true">
        {Array.from({ length: 12 }, (_, i) => (
          <div className="card" key={i} style={{ animationDelay: `${i * 20}ms` }}>
            <div className="skel skel--poster" />
            <div className="skel skel--line" style={{ width: '78%' }} />
            <div className="skel skel--line" style={{ width: '46%' }} />
          </div>
        ))}
      </div>
    );
  }

  const columns = [[3, 1], [6], [3, 1], [1, 1, 1]];
  return (
    <div className="board" aria-hidden="true">
      {columns.map((column, ci) => (
        <div className="board__col" key={ci}>
          {column.map((rows, pi) => (
            <div className="panel-card panel-card--skel" key={pi}>
              <div className="panel-card__head">
                <span className="skel" style={{ width: 24, height: 24, borderRadius: 6 }} />
                <span className="skel skel--line" style={{ width: 84 }} />
              </div>
              <div className="panel-card__list">
                {Array.from({ length: rows }, (_, ri) => (
                  <div className="row" key={ri}>
                    <span className="skel" style={{ width: 14, height: 14, borderRadius: 4, marginTop: 3 }} />
                    <span className="row__body">
                      <span className="skel skel--line" style={{ width: `${58 + ((ri * 13) % 32)}%` }} />
                      <span
                        className="skel skel--line"
                        style={{ width: `${34 + ((ri * 7) % 20)}%`, height: 9, marginTop: 5 }}
                      />
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
