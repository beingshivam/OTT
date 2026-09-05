import { PLATFORMS, LANGUAGES } from '../data/platforms';
import type { ReleaseFeed } from '../types';
import { formatWeekRange } from '../lib/week';
import { MIN_PAGE_ROWS, MAX_PAGE_SHARE } from '../lib/route';
import { COLLECTIONS, inCollection } from '../data/collections';

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
 * Chips, not columns of text links. The first version was three stacked lists
 * running about 380px on a desktop and 800px on a phone — a link farm bolted to
 * the bottom of a board whose whole promise is that the week fits on one
 * screen. The columns also ended at wildly different heights, because five
 * platforms, ten languages and eight weeks do not line up. Wrapping chips are
 * the pattern the filter row already uses, they take a third of the height, and
 * they read as part of this product rather than a sitemap footer.
 */

/**
 * Chip labels: short, because the row label already supplies the context.
 * "Netflix" under "Platforms" needs nothing more, and ten repetitions of the
 * word "releases" is noise.
 *
 * Exported because the build prerenders this same markup
 * (scripts/build-seo.mjs) and the two must not disagree. They did: the
 * prerender said "In cinemas" while this component rendered "New on In
 * Theatres" — broken English, and a crawler seeing different link text than a
 * person is exactly the cloaking problem this component exists to avoid.
 */
export const platformLinkText = (name: string) => (name === 'In Theatres' ? 'In cinemas' : name);

export function BrowseLinks({ feed, region }: { feed: ReleaseFeed | null; region: string }) {
  if (!feed) return null;

  /**
   * India only, because the pages behind these links are India pages — the
   * build generates them from the IN rows. Rendering them to a reader who has
   * switched to US would offer links to pages that were never written.
   */
  if (region !== 'IN') return null;

  const scoped = feed.weeks.flatMap((w) => w.releases.filter((r) => r.regions.includes(region)));
  if (!scoped.length) return null;

  // Only what the build actually published — see MIN_PAGE_ROWS in lib/route.ts.
  const count = (match: (r: (typeof scoped)[number]) => boolean) => scoped.filter(match).length;

  /**
   * The same two rules the build applies (lib/route.ts): enough rows to be
   * worth a page, and not so many that the page is really the homepage again.
   * Shared so a chip can never point at a page the build declined to write.
   */
  const collections = COLLECTIONS.filter((c) => {
    const n = count((r) => inCollection(c, r));
    return n >= MIN_PAGE_ROWS && n <= scoped.length * MAX_PAGE_SHARE;
  });

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
      {collections.length > 0 && (
        <div className="browse__row">
          <h2>Collections</h2>
          <div className="browse__chips">
            {collections.map((c) => (
              <a key={c.slug} className="browse__chip" href={`/${c.slug}`}>
                {c.chip}
              </a>
            ))}
          </div>
        </div>
      )}

      <div className="browse__row">
        <h2>Platforms</h2>
        <div className="browse__chips">
          {platforms.map((p) => (
            // The same accent dot the filter chips carry, so a platform looks
            // like itself everywhere on the page.
            <a
              key={p.id}
              className="browse__chip"
              href={`/${p.id}`}
              style={{ ['--chip-accent' as string]: p.accent }}
            >
              <i className="chip__dot" />
              {platformLinkText(p.name)}
            </a>
          ))}
        </div>
      </div>

      <div className="browse__row">
        <h2>Languages</h2>
        <div className="browse__chips">
          {languages.map(([code, name]) => (
            <a key={code} className="browse__chip" href={`/${name.toLowerCase()}`}>
              {name}
            </a>
          ))}
        </div>
      </div>

      <div className="browse__row">
        <h2>Weeks</h2>
        <div className="browse__chips">
          {weeks.map((w) => (
            <a key={w.id} className="browse__chip" href={`/w/${w.id}`}>
              {formatWeekRange(w.id)}
            </a>
          ))}
        </div>
      </div>
    </nav>
  );
}
