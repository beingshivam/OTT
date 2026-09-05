import { PLATFORMS, LANGUAGES } from '../data/platforms';
import type { ReleaseFeed } from '../types';
import { formatWeekRange } from '../lib/week';
import { MIN_PAGE_ROWS } from '../lib/route';

/**
 * The way in to every other page on the site.
 *
 * These are real anchors to real prerendered pages (/netflix, /tamil,
 * /w/2026-09-04), and they serve two readers at once. A person gets the thing
 * a filter dropdown cannot give them — a link they can bookmark or send. A
 * crawler gets the only route it has to the rest of the site: pages that
 * nothing links to are effectively invisible no matter what the sitemap says.
 *
 * Deliberately visible rather than crawler-only markup. A block of links
 * rendered for search engines and hidden from people is cloaking, and the
 * honest version is also the more useful one.
 *
 * Built from the feed rather than a written list, so a platform with nothing
 * this season, or a language nothing was released in, never gets a link to an
 * empty page.
 */
export function BrowseLinks({ feed, region }: { feed: ReleaseFeed | null; region: string }) {
  if (!feed) return null;

  /**
   * India only, because the pages behind these links are India pages — the
   * build generates them from the IN rows (scripts/build-seo.mjs). Rendering
   * them to a reader who has switched to US would offer links to pages that
   * were never written, which land on the SPA fallback and show the whole
   * week under a URL promising one platform.
   */
  if (region !== 'IN') return null;

  const scoped = feed.weeks.flatMap((w) => w.releases.filter((r) => r.regions.includes(region)));
  if (!scoped.length) return null;

  // Only what the build actually published. Linking to a page it skipped would
  // land on the SPA fallback and show the whole week under a URL promising one
  // platform — see MIN_PAGE_ROWS in lib/route.ts.
  const count = (match: (r: (typeof scoped)[number]) => boolean) => scoped.filter(match).length;

  const platforms = PLATFORMS.filter(
    (p) => p.regions.includes(region) && count((r) => r.platforms.includes(p.id)) >= MIN_PAGE_ROWS,
  );
  const languages = Object.entries(LANGUAGES).filter(
    ([code]) => count((r) => (r.languages ?? []).includes(code)) >= MIN_PAGE_ROWS,
  );

  // Newest first: the week people most likely want is this one or the next.
  const weeks = feed.weeks
    .filter((w) => w.releases.some((r) => r.regions.includes(region)))
    .slice()
    .sort((a, b) => b.id.localeCompare(a.id));

  return (
    <nav className="browse" aria-label="Browse releases">
      <div className="browse__group">
        <h2>By platform</h2>
        <ul>
          {platforms.map((p) => (
            <li key={p.id}>
              <a href={`/${p.id}`}>New on {p.name}</a>
            </li>
          ))}
        </ul>
      </div>

      <div className="browse__group">
        <h2>By language</h2>
        <ul>
          {languages.map(([code, name]) => (
            <li key={code}>
              <a href={`/${name.toLowerCase()}`}>New {name} releases</a>
            </li>
          ))}
        </ul>
      </div>

      <div className="browse__group">
        <h2>By week</h2>
        <ul>
          {weeks.map((w) => (
            <li key={w.id}>
              <a href={`/w/${w.id}`}>{formatWeekRange(w.id)}</a>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}
