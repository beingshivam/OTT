import { PlatformLogo } from './PlatformLogo';
import { inkOn, platform } from '../data/platforms';
import type { Release } from '../types';

/**
 * Two different questions, and the label has to say which one it's answering.
 *
 * With a live feed this is genuinely "trending now" — TMDB's popularity signal
 * across everything, so a series that dropped a month ago and is peaking today
 * shows up, which no single week's rows could ever surface.
 *
 * Without one, all we can honestly rank is the current week, so it says so.
 * Calling that "trending" would be a claim the data doesn't support.
 *
 * Text chips on purpose: a poster rail here would reintroduce the scrolling the
 * board exists to remove, and push the board itself under the fold.
 */

interface Props {
  releases: Release[];
  /** True when these come from the live trending signal rather than this week. */
  live: boolean;
  /** Ids released in the week on screen, so genuinely new entries get flagged. */
  thisWeekIds: Set<string>;
  onOpen: (r: Release) => void;
}

export function TrendingStrip({ releases, live, thisWeekIds, onOpen }: Props) {
  if (releases.length < 3) return null;
  const top = releases.slice(0, live ? 8 : 6);

  return (
    <section className="strip" aria-label={live ? 'Trending now' : "This week's biggest"}>
      <span className="strip__label">{live ? 'Trending' : 'Biggest this week'}</span>
      <ul className="strip__list">
        {top.map((r, i) => {
          const p = platform(r.platforms[0]);
          const isNew = live && thisWeekIds.has(normalise(r.title));
          return (
            <li key={r.id}>
              <button
                className="strip__item"
                onClick={() => onOpen(r)}
                style={{ '--pa': p.accent, '--ink': inkOn(p.accent) } as React.CSSProperties}
              >
                <span className="strip__rank">{i + 1}</span>
                <PlatformLogo platformId={p.id} size={18} />
                <span className="strip__title">{r.title}</span>
                {isNew && <span className="strip__new">NEW</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Trending rows and calendar rows come from different endpoints, so match on title. */
export function normalise(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
