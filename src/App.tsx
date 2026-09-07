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
import { SearchBox } from './components/SearchBox';
import { TrendingStrip, normalise } from './components/TrendingStrip';
import { PosterRail, relativeDay } from './components/PosterRail';
import {
  IconCalendar,
  IconInstagram,
  IconPlay,
  IconSearch,
} from './components/icons';
import { BRAND, INSTAGRAM, INSTAGRAM_URL, SLUG, TAGLINE } from './data/brand';
import { loadFeed, weekById } from './lib/feed';
import { loadCatalogue } from './lib/catalogue';
import {
  justLanded,
  landingSoon,
  popularNow,
  inCinemas,
  landedOnOtt,
  CINEMA_DAYS,
  MIN_ITEMS,
  SOON_DAYS,
  WINDOW_DAYS,
} from './lib/rails';
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

  /**
   * The one-line explainer, shown to a first visit and then retired.
   *
   * It exists because a reader arrived from Instagram and could not tell
   * whether films played on this page — so it earns its place the first time
   * and only the first time. On a 390px phone the header stack already spends
   * 63% of the fold before the first film; a sentence a returning reader has
   * read and does not need is the cheapest 40px on the page to give back.
   *
   * Read once into state rather than checked on every render: flipping it
   * mid-session would move the board under the reader's thumb.
   */
  const [showExplainer] = useState(() => {
    try {
      return localStorage.getItem('dropday.seen') !== '1';
    } catch {
      // Storage blocked: show it. A sentence twice beats never.
      return true;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('dropday.seen', '1');
    } catch {
      /* As above. */
    }
  }, []);

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

  /**
   * What landed in the last fortnight, across weeks.
   *
   * Reads the whole feed rather than `releases`, which is the one week on
   * screen. That is the point of the row: a film that arrived nine days ago is
   * still new to almost everyone and is currently reachable only by noticing
   * the week arrows and stepping back, which is a lot to ask of someone whose
   * question is what to watch tonight.
   */
  const landed = useMemo(
    () => justLanded(feed?.weeks.flatMap((w) => w.releases) ?? [], filters.region, today).releases,
    [feed, filters.region, today],
  );

  /**
   * The same row, split the way a reader actually chooses.
   *
   * "In cinemas" reaches six weeks back where "On OTT" reaches two, because a
   * cinema run lasts that long and a streaming drop is permanent — mixed into
   * one row they had to share the shorter window, and a film in its fourth week
   * fell off the site while still playing. Splitting the row is what lets each
   * side use its own clock.
   */
  const allRows = useMemo(() => feed?.weeks.flatMap((w) => w.releases) ?? [], [feed]);
  const cinemaRail = useMemo(
    () => inCinemas(allRows, filters.region, today),
    [allRows, filters.region, today],
  );
  const ottRail = useMemo(
    () => landedOnOtt(allRows, filters.region, today),
    [allRows, filters.region, today],
  );

  /** The same fortnight, pointed the other way, for the Coming soon lens. */
  const soon = useMemo(
    () => landingSoon(feed?.weeks.flatMap((w) => w.releases) ?? [], filters.region, today).releases,
    [feed, filters.region, today],
  );

  /**
   * And the catalogue's own row, which is not a date at all.
   *
   * Reads `catalogue` rather than the feed: that lens renders a different
   * dataset entirely, and ranking the week's releases on a page about the back
   * catalogue would be a row that contradicts the board beneath it.
   */
  const popular = useMemo(
    () => (catalogue ? popularNow(catalogue, filters.region) : []),
    [catalogue, filters.region],
  );

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

  /**
   * One row per lens, each ranking what its own page is about.
   *
   * Asked whether the rail should be on the other two lenses as well: yes, and
   * not the same one. "Just landed" over films that are not out yet is a false
   * statement, and on the back catalogue it is the homepage a second time. So
   * the component is shared and the selection, the wording and the caption
   * belong to the lens.
   *
   * Suppressed once a reader narrows the page. The rows below then answer a
   * question they asked, and an unfiltered row of posters above them would be
   * answering a different one.
   */
  const lensRail =
    userNarrowed ? null
    : span?.kind === 'upcoming' && soon.length >= MIN_ITEMS ? (
        <PosterRail
          title="Landing soon"
          subtitle={`Arriving in the next ${SOON_DAYS} days — streaming and in cinemas`}
          releases={soon}
          onOpen={setSelected}
          caption={(r) => relativeDay(r.releaseDate, today)}
        />
      )
    : route?.catalogue && popular.length >= MIN_ITEMS ? (
        <PosterRail
          title="Popular now"
          subtitle="Most watched in each language, right now"
          releases={popular}
          onOpen={setSelected}
          /* Not a date. Every row here is back catalogue, so "3 weeks ago"
             would be true of almost none of them and useless for the rest; the
             year is what a reader places the film by. */
          caption={(r) => r.releaseDate.slice(0, 4)}
        />
      )
    : null;


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
          {/*
            Search, promoted from the fifth band down into the header.
            The site's highest-intent traffic arrives asking where to watch one
            specific title, and that reader had to scroll past five rows of
            navigation to find the field. This is where every app puts it.
          */}
          {/*
            Share, in the header, on the owner's call — and the reasoning that
            put it at the foot of the board was too narrow. That argument was
            about a reader, who has no use for it until they have read the week.
            But the picture this makes is how the site travels: it goes out on
            WhatsApp and Instagram carrying the address, and a growth loop that
            needs scrolling to find is a growth loop that does not run. It does
            not fit on the board's heading row, which has nothing to spare at
            360px, and it does not belong back in a band of its own.

            Only where the card can name what it holds: it says "4–10 Sep" and
            means it, which is true of a week and not of a month or of seventy
            years of back catalogue.
          */}
          {feed && !isTitlePage && !span && !route?.catalogue && (
            <ShareWeek releases={visible} filters={filters} />
          )}
          <SearchBox value={filters.query} onChange={(query) => update({ query })} />
        </div>

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
          tab with that label would be a lie about what the site knows.

          "In cinemas" was tried as a fourth tab and taken back out. Cinema is
          72% of the feed's rows and genuinely had nowhere to live, but a tab
          made it a separate destination — a fourth thing to choose between
          before seeing anything, clipped at 390px, on a site whose name is the
          other half. It reads better as one of the two rows under "Just
          landed", which is where it now lives. */}
      {!isTitlePage && (
        <div className="shell lenses-row">
        <nav className="lenses" aria-label="What to show">
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
        </div>
      )}

      {/* The sentence the homepage never had.
          Someone arriving from Instagram had nothing on screen telling them
          what this is — the header is a wordmark, the board is a list of
          titles, and a reader wrote in genuinely unsure whether she could
          watch things here. One quiet line, on the page a first visit lands
          on. The route pages have PageIntro doing this job already. */}
      {!route && showExplainer && (
        <div className="shell">
        <p className="explainer">
          Everything releasing this week — tap a title to see where to watch it.
        </p>
        </div>
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
          rail={lensRail}
        />
      )}

      {/*
        The homepage's row, above the board's heading rather than below it.
        On a lens page PageIntro holds the row in its slot and it lands in the
        same place; the homepage has no intro, so it renders here. Either way
        the order is the same: what the page is, then the row worth looking at,
        then the controls that act on the board underneath.
      */}
      {!isTitlePage && feed && !error && facets.total > 0 && !userNarrowed && !span && !route?.catalogue && (
        <div className="shell">
          {landed.length >= MIN_ITEMS ? (
            /*
              Both rows, both on screen, rather than a toggle over one.

              The toggle had to pick a side to open on, and neither pick was
              defensible: opening on OTT hides the half that had no other home
              on the site, opening on cinemas hides the half the site is named
              after. When no default is right, the control that needs one is the
              wrong control.

              It also put the two counts side by side, which invited a
              comparison they cannot support — 50 and 46 are drawn from a
              six-week window and a two-week one. Split across two rows, each
              number sits under the sentence that says what it counts.
            */
            <section className="landedpair" aria-labelledby="landedpair-heading">
              <h2 className="landedpair__title" id="landedpair-heading">
                Just landed
              </h2>
              <PosterRail
                compact
                title="In cinemas"
                /* Short enough not to ellipsis at 390px, which ate the count on
                   the first attempt — and the span is the half that matters:
                   these two numbers are measured over different windows and
                   would otherwise read as directly comparable. */
                subtitle={`${cinemaRail.total} titles · last ${Math.round(CINEMA_DAYS / 7)} weeks`}
                releases={cinemaRail.releases}
                onOpen={setSelected}
                caption={(r) => relativeDay(r.releaseDate, today)}
              />
              <PosterRail
                compact
                title="On OTT"
                subtitle={`${ottRail.total} titles · last ${Math.round(WINDOW_DAYS / 7)} weeks`}
                releases={ottRail.releases}
                onOpen={setSelected}
                caption={(r) => relativeDay(r.releaseDate, today)}
              />
            </section>
          ) : (
            /* Not enough recent artwork to make a row of posters — a thin rail
               reads as a bug rather than a selection. The text strip was always
               the honest shape for a short list, so it stays as the fallback
               rather than being deleted. */
            <TrendingStrip
              releases={trendingNow.list}
              live={trendingNow.live}
              thisWeekIds={thisWeekTitles}
              onOpen={setSelected}
            />
          )}
        </div>
      )}

      {!isTitlePage && (
      <Controls
        filters={filters}
        facets={facets}
        resultCount={visible.length}
        onChange={update}
        onReset={resetFilters}
        /* The board names itself now — but only where nothing else has.
           A week page has no other title, so the range is the heading. A lens
           page opens with an h1 saying "Coming soon" a hundred pixels above,
           and repeating it here would be the page telling you twice; the size
           of what you are looking at is the fact that line does not carry. */
        heading={span || route?.catalogue ? `${facets.total} titles` : formatWeekRange(filters.weekId)}
        showCount={!span && !route?.catalogue}
        step={
          span || route?.catalogue
            ? undefined
            : {
                back: () => stepWeek(-1),
                forward: () => stepWeek(1),
                canBack: weekOffset > -WEEK_RANGE,
                canForward: weekOffset < WEEK_RANGE,
                today: weekOffset !== 0 ? goToCurrentWeek : undefined,
              }
        }
        freshness={
          feed
            ? { label: relativeTime(feed.generatedAt), title: `Next refresh ${nextRefreshLabel()}` }
            : undefined
        }
        view={view}
        onView={setView}
        region={filters.region}
        onRegion={(code) => {
          setRegionPinned(true);
          update({ region: code, platforms: [] });
          updatePrefs({ region: code });
        }}
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
