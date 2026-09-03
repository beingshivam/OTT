import { platform } from '../data/platforms';
import type { Release } from '../types';

/**
 * "What's big this week" in one line, across every platform and theatres.
 *
 * Kept to text chips on purpose: a poster rail here would reintroduce the
 * scrolling the board exists to avoid, and push the board itself below the fold.
 */

interface Props {
  releases: Release[];
  onOpen: (r: Release) => void;
}

export function TrendingStrip({ releases, onOpen }: Props) {
  if (releases.length < 3) return null;
  const top = releases.slice(0, 6);

  return (
    <section className="strip" aria-label="Trending this week">
      <span className="strip__label">Trending</span>
      <ul className="strip__list">
        {top.map((r, i) => {
          const p = platform(r.platforms[0]);
          return (
            <li key={r.id}>
              <button
                className="strip__item"
                onClick={() => onOpen(r)}
                style={{ '--pa': p.accent } as React.CSSProperties}
              >
                <span className="strip__rank">{i + 1}</span>
                <span className="strip__title">{r.title}</span>
                <span className="strip__where">{p.short}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
