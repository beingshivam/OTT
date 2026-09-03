import { useCallback, useEffect, useMemo, useState } from 'react';
import { Controls } from './components/Controls';
import { DetailSheet } from './components/DetailSheet';
import { ReleaseCard } from './components/ReleaseCard';
import { SetupCard } from './components/SetupCard';
import { TrendingRail } from './components/TrendingRail';
import {
  IconCalendar,
  IconChevronLeft,
  IconChevronRight,
  IconPlay,
  IconSearch,
} from './components/icons';
import { PLATFORMS, REGIONS } from './data/platforms';
import { loadFeed, weekById } from './lib/feed';
import { applyFilters, facetsFor, activeFilterCount, EMPTY_FILTERS } from './lib/filters';
import { DEFAULT_PREFS, guessRegion, loadPrefs, savePrefs, type Prefs } from './lib/prefs';
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
  const [stuck, setStuck] = useState(false);

  const today = useMemo(() => new Date(), []);
  const currentWeek = useMemo(() => weekIdFor(today), [today]);

  const [filters, setFilters] = useState<Filters>(() =>
    readFilters({ weekId: weekIdFor(new Date()), region: 'IN' }),
  );

  // Restore device preferences before the first paint of real content so the
  // region never visibly flips underneath the user.
  useEffect(() => {
    const stored = loadPrefs();
    const resolved: Prefs = stored.onboarded
      ? stored
      : { ...stored, region: stored.region || guessRegion() };
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
        const pinned = new URLSearchParams(window.location.search).get('w');
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
  }, []);

  useEffect(() => {
    writeFilters(filters, { weekId: currentWeek, region: prefs.region });
  }, [filters, currentWeek, prefs.region]);

  useEffect(() => {
    const onScroll = () => setStuck(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const update = useCallback((next: Partial<Filters>) => {
    setFilters((f) => ({ ...f, ...next }));
  }, []);

  const resetFilters = useCallback(() => {
    setFilters((f) => ({ ...f, ...EMPTY_FILTERS }));
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
  const missingArtwork = useMemo(
    () => releases.filter((r) => r.regions.includes(filters.region) && !r.posterUrl).length,
    [releases, filters.region],
  );
  const visible = useMemo(() => applyFilters(releases, filters), [releases, filters]);

  const weekOffset = useMemo(() => {
    const diff = Math.round(
      (new Date(`${filters.weekId}T00:00:00Z`).getTime() -
        new Date(`${currentWeek}T00:00:00Z`).getTime()) /
        (7 * 86_400_000),
    );
    return diff;
  }, [filters.weekId, currentWeek]);

  const stepWeek = (delta: number) =>
    update({ weekId: addDays(filters.weekId, delta * 7) });

  const lineupOn =
    prefs.platforms.length > 0 &&
    filters.platforms.length === prefs.platforms.length &&
    prefs.platforms.every((p) => filters.platforms.includes(p));

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

  const platformsInRegion = PLATFORMS.filter((p) => p.regions.includes(filters.region)).map(
    (p) => p.id,
  );
  const languagesInRegion = facets.languages.slice(0, 10).map(([code]) => code);

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to releases
      </a>

      <header className="nav" data-stuck={stuck}>
        <div className="shell nav__inner">
          <span className="logo">
            <span className="logo__mark">
              <IconPlay />
            </span>
            dropday<span className="logo__dot">.</span>
          </span>
          <div className="nav__actions">
            <label className="region">
              <span aria-hidden="true">
                {REGIONS.find((r) => r.code === filters.region)?.flag ?? '🌐'}
              </span>
              <span className="sr-only">Region</span>
              <select
                value={filters.region}
                onChange={(e) => {
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
      </header>

      <div className="shell hero">
        <nav className="weeknav" aria-label="Change week">
          <button
            className="weeknav__btn"
            onClick={() => stepWeek(-1)}
            disabled={weekOffset <= -WEEK_RANGE}
            aria-label="Previous week"
          >
            <IconChevronLeft />
          </button>
          <button
            className="weeknav__btn"
            onClick={() => stepWeek(1)}
            disabled={weekOffset >= WEEK_RANGE}
            aria-label="Next week"
          >
            <IconChevronRight />
          </button>
          <span className="weeknav__label">{relativeWeekLabel(filters.weekId, today)}</span>
          {weekOffset !== 0 && (
            <button className="weeknav__today" onClick={() => update({ weekId: currentWeek })}>
              Back to this week
            </button>
          )}
        </nav>

        <h1 className="hero__title">
          Everything new, <em>everywhere</em>, this week.
        </h1>

        <div className="hero__meta">
          <span className="hero__range">{formatWeekRange(filters.weekId)}</span>
          <span className="hero__sep" />
          <span>
            {facets.total} {facets.total === 1 ? 'release' : 'releases'} across{' '}
            {facets.platforms.length} {facets.platforms.length === 1 ? 'platform' : 'platforms'}
          </span>
          {prefs.platforms.length > 0 && (
            <>
              <span className="hero__sep" />
              <button
                className="btn"
                data-active={lineupOn}
                style={{ height: 30, fontSize: 12 }}
                onClick={() => update({ platforms: lineupOn ? [] : prefs.platforms })}
              >
                {lineupOn ? 'Showing my lineup' : `My lineup (${prefs.platforms.length})`}
              </button>
            </>
          )}
        </div>

        {feed?.source === 'sample' && missingArtwork > 0 && (
          <p className="notice">
            <span aria-hidden="true">📅</span>
            <span>
              <strong>Curated schedule.</strong> Titles, platforms, languages and dates come from a
              published release calendar.{' '}
              {missingArtwork === facets.total
                ? 'Posters, ratings and synopses arrive on the first catalogue refresh'
                : `${missingArtwork} of these are still waiting on artwork`}{' '}
              — <code>npm run refresh</code>, or the twice-weekly job.
            </span>
          </p>
        )}
      </div>

      <Controls
        filters={filters}
        facets={facets}
        resultCount={visible.length}
        onChange={update}
        onReset={resetFilters}
      />

      <main className="shell" id="main">
        {!prefs.onboarded && feed && facets.total > 0 && (
          <SetupCard
            prefs={prefs}
            platformOptions={platformsInRegion}
            languageOptions={languagesInRegion}
            onChange={updatePrefs}
            onDone={() => updatePrefs({ onboarded: true })}
          />
        )}

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

        {!feed && !error && <LoadingGrid />}

        {feed && !error && facets.total === 0 && (
          <div className="empty">
            <span className="empty__icon">
              <IconCalendar />
            </span>
            <h3>Nothing scheduled here yet</h3>
            <p>
              {formatWeekRange(filters.weekId)} hasn't been pulled into the calendar. New weeks land
              every Friday morning, and past weeks fill in when the catalogue backfills.
            </p>
            <div className="empty__actions">
              {weekOffset !== 0 && (
                <button className="btn btn--lg" onClick={() => update({ weekId: currentWeek })}>
                  Go to this week
                </button>
              )}
            </div>
          </div>
        )}

        {feed && !error && facets.total > 0 && (
          <>
            {activeFilterCount(filters) === 0 && (
              <TrendingRail releases={visible} onOpen={setSelected} />
            )}

            {visible.length === 0 ? (
              <div className="empty">
                <span className="empty__icon">
                  <IconSearch />
                </span>
                <h3>No matches in this week</h3>
                <p>
                  Nothing here fits those filters. Loosen them, or step to another week — the
                  filters carry over.
                </p>
                <div className="empty__actions">
                  <button className="btn btn--lg" onClick={resetFilters}>
                    Clear filters
                  </button>
                  <button className="btn btn--lg" onClick={() => stepWeek(1)}>
                    Try next week
                  </button>
                </div>
              </div>
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

        <footer className="footer">
          <div className="footer__stack">
            <span>dropday — every new release, every platform, one page.</span>
          </div>
          <div className="footer__stack">
            {feed && (
              <span>
                Updated {new Date(feed.generatedAt).toLocaleDateString(undefined, {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                })}
              </span>
            )}
            <span>Refreshes every Friday</span>
          </div>
        </footer>
      </main>

      {selected && <DetailSheet release={selected} onClose={() => setSelected(null)} />}
    </>
  );
}

function LoadingGrid() {
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
