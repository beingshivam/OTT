import { useCallback, useEffect, useMemo, useState } from 'react';
import { Board } from './components/Board';
import { BrowseLinks } from './components/BrowseLinks';
import { PageIntro } from './components/PageIntro';
import { ReleaseDatePage } from './components/ReleaseDatePage';
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
import { loadCatalogue } from './lib/catalogue';
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
  /**
   * The back catalogue, once someone asks for it.
   *
   * A quarter of a megabyte that most visits never need, so it is fetched on
   * the first render of that lens rather than alongside the feed.
   */
  const [catalogue, setCatalogue] = useState<Release[] | null>(null);
  const [catalogueError, setCatalogueError] = useState<string | null>(null);

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
        // A span page reads across every week, so there is no week to land on
        // and nudging one would only rewrite state nothing renders.
        if (route?.span) return;
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

  /** Only on the lens that shows it, and only once — loadCatalogue memoises
   *  the request, so a reader flipping back and forth pays for one fetch. */
  useEffect(() => {
    if (!route?.catalogue || catalogue) return;
    let live = true;
    loadCatalogue()
      .then((c) => live && setCatalogue(c.titles))
      .catch((e: unknown) => live && setCatalogueError((e as Error).message));
    return () => {
      live = false;
    };
  }, [route, catalogue]);

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

  /**
   * The title a /ott-release-date/<slug> page names, matched on the slug the
   * build stamped into the feed rather than one derived here — see types.ts.
   * Undefined while the feed is still loading, and for a slug that no longer
   * exists, which the render below treats as "not found" rather than blank.
   */
  const titlePage = useMemo(() => {
    if (!route?.titleSlug || !feed) return undefined;
    for (const w of feed.weeks) {
      const hit = w.releases.find((r) => r.slug === route.titleSlug);
      if (hit) return hit;
    }
    /**
     * Not in the window any more — so read the row the build put in the page.
     *
     * Title pages outlive the eight-week feed on purpose (scripts/archive.mjs):
     * a page that deletes itself three weeks after a film opens never gets to
     * be the page that ranks. But the feed the app loads is still a window, so
     * without this the app would look up the slug, miss, and render "we don't
     * have that title any more" underneath prerendered markup carrying the
     * whole film — the crawler seeing the page and the visitor seeing an
     * apology.
     *
     * Parsed rather than fetched: it is already here, so there is no request
     * and no flash of the wrong state.
     */
    const embedded = document.getElementById('title-data')?.textContent;
    if (embedded) {
      try {
        const row = JSON.parse(embedded) as Release;
        if (row.slug === route.titleSlug) return row;
      } catch {
        /* A malformed blob is a build bug, not something to take the page down
           over — fall through to the not-found state below. */
      }
    }
    return null;
  }, [route, feed]);

  /** A title page is the one route that does not render the board at all, so
   *  the week bar, the filters and the grid all step aside for it. */
  const isTitlePage = Boolean(route?.titleSlug);

  /**
   * A month page or /upcoming: the board spans weeks, so the week the filters
   * happen to be pointing at is irrelevant to what it shows.
   */
  const span = route?.span ?? null;

  const week = weekById(feed, filters.weekId);
  /**
   * What the board is drawn from.
   *
   * Normally one week, which is the whole shape of this product. A span page
   * reads every week in the feed and keeps the rows inside its dates instead —
   * the one place the site looks past the week on screen, and the reason the
   * stepper is hidden on those pages rather than left there stepping something
   * nothing renders.
   */
  const releases = useMemo(() => {
    // A different set of titles entirely, not a filter over the week's.
    if (route?.catalogue) return catalogue ?? [];
    if (!span) return week?.releases ?? [];
    return (feed?.weeks ?? [])
      .flatMap((w) => w.releases)
      .filter((r) => r.releaseDate >= span.from && r.releaseDate <= span.to);
  }, [route, catalogue, span, week, feed]);
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
    // Same reason the stepper is hidden on a span page: the arrows would move a
    // week nothing on screen is drawn from.
    blocked: selected !== null || Boolean(span) || Boolean(route?.catalogue),
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
    // A week has seven known days whether or not anything lands on them. A span
    // has however many dates its rows actually fall on, which is the only list
    // that makes sense across a month — enumerating 30 days to drop 20 empties
    // would arrive at the same place the long way round.
    // The catalogue spans seventy years, so a day heading per release date
    // would be three hundred sections holding one card each. One flat group,
    // keyed on the empty string, which the poster view reads as "no heading".
    if (route?.catalogue) return visible.length ? ([['', visible]] as const) : [];
    const days = span ? [...map.keys()].sort() : daysOfWeek(filters.weekId);
    return days
      .map((d) => [d, map.get(d) ?? []] as const)
      .filter(([, list]) => list.length > 0);
  }, [visible, filters.weekId, span, route]);

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
          {/* A link, on every page including this one.
              It was a <span>, which on the homepage cost nothing and on
              /netflix or /ott-release-date/<slug> left no way back at all
              except clearing a filter — a dead end on 80 of 81 pages. It is
              also the strongest internal link a site has, and every sub-page
              was withholding it from the page that most needs it. */}
          <a className="logo" href="/" aria-label={`${BRAND} home`}>
            <span className="logo__mark">
              <IconPlay />
            </span>
            {/* Wordmark and dot share one flex item, or the .logo gap pushes
                the dot away from the name it belongs to. */}
            <span>
              {BRAND}
              <span className="logo__dot">.</span>
            </span>
          </a>
          {/* Up here rather than in the footer.
              Buried at the bottom it was reachable only by someone who had
              already scrolled the whole board — which is precisely the reader
              who did not need convincing. Most traffic arrives from Instagram
              in the first place, so the account is the one thing a first-time
              visitor is most likely to want and least likely to hunt for.
              Icon-only, because the header's job is the week and a handle
              spelled out beside the wordmark reads as a second brand. */}
          <a
            className="iglink"
            href={INSTAGRAM_URL}
            target="_blank"
            rel="noreferrer noopener"
            title={`@${INSTAGRAM} on Instagram`}
            aria-label={`@${INSTAGRAM} on Instagram`}
          >
            <IconInstagram />
          </a>
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

        {/* A span page has no week to step through, and a stepper that changes
            a number nothing on screen reads would be a control that does
            nothing. The page's own name goes in PageIntro's h1 instead. */}
        {!isTitlePage && !span && !route?.catalogue && (
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
        )}

        {!isTitlePage && (
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
          {/* The share card names the week it was made from, which is a true
              label for every page but these two. Rather than teach it a second
              vocabulary, a span page does without. */}
          {!span && !route?.catalogue && <ShareWeek releases={visible} filters={filters} />}
          <span className="viewtoggle" role="group" aria-label="Layout">
            <button data-on={view === 'board'} onClick={() => setView('board')}>
              Board
            </button>
            <button data-on={view === 'grid'} onClick={() => setView('grid')}>
              Posters
            </button>
          </span>
        </div>
        )}
      </div>

      {/* What am I looking at — three lenses on the same board.
          Real anchors to real prerendered pages rather than local state, so a
          lens is shareable, bookmarkable and indexable, and so arriving from a
          search result lands on the one it promised. The board and the poster
          grid work identically in all three; only the source of the rows
          changes.

          Deliberately three, not four. "Trending" was asked for and is not
          here: both signals available — TMDB's global trending list and its
          popularity score — return American television for an Indian audience
          (zero Indian-language titles in the top thirty by popularity), so a
          tab with that label would be a lie about what the site knows. */}
      {!isTitlePage && (
        <nav className="lenses shell" aria-label="What to show">
          <a className="lens" href="/" aria-current={!route ? 'page' : undefined}>
            This week
          </a>
          <a
            className="lens"
            href="/streaming"
            aria-current={route?.catalogue ? 'page' : undefined}
          >
            Now streaming
          </a>
          <a
            className="lens"
            href="/upcoming"
            aria-current={route?.span?.kind === 'upcoming' ? 'page' : undefined}
          >
            Coming soon
          </a>
        </nav>
      )}

      {/* The sentence the homepage never had.
          Someone arriving from Instagram had nothing on screen telling them
          what this is — the header is a wordmark, the board is a list of
          titles, and a reader wrote in genuinely unsure whether she could
          watch things here. One quiet line, on the page a first visit lands
          on. The route pages have PageIntro doing this job already. */}
      {!route && (
        <p className="shell explainer">
          Everything releasing this week — tap any title to see where it's streaming and open it
          there. Nothing plays on this page.
        </p>
      )}

      {/* Only on a page that promised something specific. On "/" this renders
          nothing and the layout is exactly what it was. */}
      {route && feed && !isTitlePage && (
        <PageIntro
          route={route}
          rows={route.catalogue ? releases : undefined}
          feed={feed}
          region={filters.region}
          currentWeek={currentWeek}
          onOpen={setSelected}
        />
      )}

      {!isTitlePage && (
      <Controls
        filters={filters}
        facets={facets}
        resultCount={visible.length}
        onChange={update}
        onReset={resetFilters}
      />
      )}

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

        {/* A title page replaces the board entirely. Null means the feed
            loaded and no title carries that slug — a page that was generated
            once and whose title has since fallen out of the eight-week window.
            Saying so beats an empty screen. */}
        {isTitlePage && feed && !error && titlePage && (
          <ReleaseDatePage release={titlePage} feed={feed} region={filters.region} />
        )}
        {isTitlePage && feed && !error && titlePage === null && (
          <div className="empty">
            <span className="empty__icon">
              <IconCalendar />
            </span>
            <h3>We don't have that title any more</h3>
            <p>It has dropped out of the weeks we track. The board has everything current.</p>
            <div className="empty__actions">
              <a className="btn btn--lg" href="/">
                Back to this week
              </a>
            </div>
          </div>
        )}

        {!isTitlePage && !feed && !error && <LoadingBoard view={view} />}

        {/* Its own state: the feed loaded fine, so the shell is right and only
            this lens has nothing. Saying so beats an empty board that looks
            like the catalogue is genuinely empty. */}
        {route?.catalogue && feed && !error && catalogueError && (
          <div className="empty">
            <span className="empty__icon">
              <IconCalendar />
            </span>
            <h3>Couldn't load the catalogue</h3>
            <p>{catalogueError}</p>
            <div className="empty__actions">
              <a className="btn btn--lg" href="/streaming">Try again</a>
              <a className="btn btn--lg" href="/">This week instead</a>
            </div>
          </div>
        )}
        {route?.catalogue && feed && !error && !catalogueError && !catalogue && (
          <LoadingBoard view={view} />
        )}

        {!isTitlePage && feed && !error && facets.total === 0 && (
          <div className="empty">
            <span className="empty__icon">
              <IconCalendar />
            </span>
            <h3>Nothing scheduled here yet</h3>
            <p>
              {span
                ? /* A span page cannot offer "try another week" — it has no week
                     and the buttons below would be a non-sequitur. It reaches
                     here only when a span outruns the feed's window. */
                  `${span.label} isn't in the calendar yet. The refresh covers several weeks either side, so this fills in once it runs.`
                : `${formatWeekRange(filters.weekId)} hasn't been pulled into the calendar yet. The refresh covers several weeks either side, so past and upcoming weeks fill in once it runs.`}
            </p>
            {/* A dead end otherwise: say which weeks do have data and go there in
                one tap, rather than leaving the arrows to be guessed at. */}
            {!span && stockedWeeks.length > 0 && (
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

        {!isTitlePage && feed && !error && facets.total > 0 && (
          <>
            {/* Not on a span page. PageIntro already ranks the same rows by the
                same measure up top, so the strip would be a second copy of it
                a few hundred pixels down — and its label says "this week",
                which is not what a month page is ranking. */}
            {!userNarrowed && !span && !route?.catalogue && (
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
              <Board
                releases={visible}
                onOpen={setSelected}
                // A month spans five Fridays, so a weekday chip stops
                // identifying anything and the date has to carry it.
                dayLabel={
                  route?.catalogue ? 'year' : byDay.length <= 1 ? 'none' : span ? 'date' : 'weekday'
                }
              />
            ) : (
              byDay.map(([date, list]) => {
                const d = formatDay(date);
                return (
                  <section className="day" key={date || 'all'} aria-label={date ? `${d.weekday} ${d.day} ${d.month}` : 'All titles'}>
                    {date && (
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
                    )}
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
            {/* Said plainly, because a tagline can still be read the hopeful
                way. This is the sentence that answers the question directly. */}
            <span className="footer__note">
              We don't stream anything. Every title links out to the platform showing it.
            </span>
            <button className="footer__link" onClick={addWeeklyReminder}>
              <IconCalendar />
              Remind me every Friday
            </button>
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
