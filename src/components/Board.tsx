import { useEffect, useState } from 'react';
import { KIND_ICON } from './icons';
import { PlatformLogo } from './PlatformLogo';
import { dropLabel } from './ReleaseCard';
import { KIND_LABEL, languageName, platform } from '../data/platforms';
import { formatDay } from '../lib/week';
import type { Release } from '../types';

/**
 * The board is the product.
 *
 * The thing people already forward on WhatsApp is a single dense image: every
 * platform's drops grouped in panels, readable in one glance, no scrolling and
 * no artwork. It wins precisely because it is *not* a streaming-app browse
 * grid — a wall of posters is what people are trying to escape when they ask
 * "what's new this week".
 *
 * So this is the default view: text rows, platform-grouped, packed tight enough
 * to take in at once. The poster grid is still there for anyone who wants to
 * browse, but it is the alternative, not the front door.
 */

interface Props {
  releases: Release[];
  onOpen: (r: Release) => void;
  /** Show a day chip per row when the week spans more than one release day. */
  multiDay: boolean;
}

export function Board({ releases, onOpen, multiDay }: Props) {
  // Group by platform, then order panels by how much each has — the busiest
  // platform of the week leads, exactly as the printed calendars do it.
  const byPlatform = new Map<string, Release[]>();
  for (const r of releases) {
    for (const id of r.platforms) {
      const list = byPlatform.get(id);
      if (list) list.push(r);
      else byPlatform.set(id, [r]);
    }
  }

  const panels = [...byPlatform.entries()].sort((a, b) => {
    // Theatres is a different kind of thing and belongs at the top with the
    // biggest streamers rather than trailing the tail of one-title services.
    const theatrical = (id: string) => (platform(id).theatrical ? 1 : 0);
    return (
      theatrical(b[0]) - theatrical(a[0]) ||
      b[1].length - a[1].length ||
      a[0].localeCompare(b[0])
    );
  });

  const columns = packColumns(panels, useColumnCount());

  return (
    <div className="board">
      {columns.map((column, i) => (
        <div className="board__col" key={i}>
          {column.map(([id, list]) => {
            const p = platform(id);
            return (
              <section
                className="panel-card"
                key={id}
                style={{ '--pa': p.accent, '--pb': p.accent2 ?? p.accent } as React.CSSProperties}
                data-theatrical={p.theatrical ? 'true' : undefined}
                aria-label={p.name}
              >
                <header className="panel-card__head">
                  <PlatformLogo platformId={id} size={24} />
                  <span className="panel-card__name">{p.name}</span>
                  <span className="panel-card__count">{list.length}</span>
                </header>
                <ul className="panel-card__list">
                  {list.map((r) => (
                    <BoardRow key={r.id + id} release={r} onOpen={onOpen} multiDay={multiDay} />
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      ))}
    </div>
  );
}

type Panel = [string, Release[]];

/**
 * CSS multi-column balances by splitting content, and a panel can't be split —
 * so a three-title panel would strand half a column of dead space beside a
 * six-title one. Pack explicitly instead: walk the panels in priority order and
 * drop each into whichever column is currently shortest.
 */
function packColumns(panels: Panel[], count: number): Panel[][] {
  const columns: Panel[][] = Array.from({ length: count }, () => []);
  const heights = new Array<number>(count).fill(0);

  for (const panel of panels) {
    let shortest = 0;
    for (let i = 1; i < count; i++) if (heights[i] < heights[shortest]) shortest = i;
    columns[shortest].push(panel);
    // Header, one row per title, and the gap below the panel. Approximate is
    // fine — this only decides placement, the browser still does the layout.
    heights[shortest] += 38 + panel[1].length * 44 + 14;
  }
  return columns.filter((c) => c.length > 0);
}

function useColumnCount(): number {
  const measure = () => {
    const w = typeof window === 'undefined' ? 1280 : window.innerWidth;
    if (w < 900) return 2;
    if (w < 1280) return 3;
    return 4;
  };
  const [count, setCount] = useState(measure);

  useEffect(() => {
    const onResize = () => setCount(measure());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return count;
}

function BoardRow({
  release,
  onOpen,
  multiDay,
}: {
  release: Release;
  onOpen: (r: Release) => void;
  multiDay: boolean;
}) {
  const Kind = KIND_ICON[release.kind] ?? KIND_ICON.film;
  const drop = dropLabel(release);
  const day = formatDay(release.releaseDate);

  return (
    <li>
      <button className="row" onClick={() => onOpen(release)}>
        <Kind className="row__icon" />
        <span className="row__body">
          <span className="row__title">
            {release.title}
            {drop && <span className="row__drop">{drop}</span>}
            {release.drop?.finale && <span className="row__flag">FINALE</span>}
            {release.rating != null && (
              <span className="row__rating">★ {release.rating.toFixed(1)}</span>
            )}
          </span>
          {/* Type, language, genre — the three things that decide whether a
              title is for you, in the order you'd ask them. */}
          <span className="row__meta">
            {[
              KIND_LABEL[release.kind] ?? release.kind,
              release.languages.map(languageName).join(', '),
              release.genres.slice(0, 2).join(', '),
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </span>
        {multiDay && <span className="row__day">{day.weekday}</span>}
      </button>
    </li>
  );
}
