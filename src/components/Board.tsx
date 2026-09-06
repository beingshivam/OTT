import { useEffect, useState } from 'react';
import { KIND_ICON } from './icons';
import { PlatformLogo } from './PlatformLogo';
import { Rating } from './Rating';
import { dropLabel } from './ReleaseCard';
import { platform } from '../data/platforms';
import { metaLine } from '../lib/format';
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

/**
 * Rows to show before a panel collapses behind a "show more".
 *
 * Cinema listings run to eighteen titles in a good week while most streaming
 * panels carry one, and an uncapped panel is three times the height of every
 * other column — no packing can balance that, so the board ended in a wall of
 * regional films beside a screen of dead space. The whole promise here is the
 * week at a glance, so the tail folds away. Rows arrive sorted by heat, so the
 * titles that survive the cut are the ones worth seeing first.
 */
const PANEL_MAX = 8;

interface Props {
  releases: Release[];
  onOpen: (r: Release) => void;
  /**
   * How each row labels its release day.
   *
   * 'none'    one day on screen, so a chip would repeat the same word.
   * 'weekday' a single week — "FRI" is unambiguous inside seven days.
   * 'date'    a month or the upcoming page, where the board spans weeks and
   *           five different Fridays would all read "FRI".
   */
  dayLabel: 'none' | 'weekday' | 'date';
}

export function Board({ releases, onOpen, dayLabel }: Props) {
  // A theatrical Mirzapur and a single mid-season episode were rendering
  // identically. Give the week's top few a heavier line so the eye has somewhere
  // to land — emphasis, not a second hierarchy.
  const major = new Set(
    [...releases]
      .sort((a, b) => (b.heat ?? 0) - (a.heat ?? 0))
      .slice(0, Math.min(3, Math.floor(releases.length / 4)))
      .map((r) => r.id),
  );
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
          {column.map(([id, list]) => (
            <PanelCard
              key={id}
              platformId={id}
              releases={list}
              onOpen={onOpen}
              dayLabel={dayLabel}
              major={major}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function PanelCard({
  platformId,
  releases,
  onOpen,
  dayLabel,
  major,
}: {
  platformId: string;
  releases: Release[];
  onOpen: (r: Release) => void;
  dayLabel: 'none' | 'weekday' | 'date';
  major: Set<string>;
}) {
  const [expanded, setExpanded] = useState(false);
  const p = platform(platformId);
  const hidden = releases.length - PANEL_MAX;
  const shown = expanded ? releases : releases.slice(0, PANEL_MAX);

  return (
    <section
      className="panel-card"
      style={{ '--pa': p.accent, '--pb': p.accent2 ?? p.accent } as React.CSSProperties}
      data-theatrical={p.theatrical ? 'true' : undefined}
      aria-label={p.name}
    >
      <header className="panel-card__head">
        <PlatformLogo platformId={platformId} size={24} />
        <span className="panel-card__name">{p.name}</span>
        {/* The count stays the true total, so a collapsed panel never
            under-reports the week. */}
        <span className="panel-card__count">{releases.length}</span>
      </header>
      <ul className="panel-card__list">
        {shown.map((r) => (
          <BoardRow
            key={r.id + platformId}
            release={r}
            onOpen={onOpen}
            dayLabel={dayLabel}
            major={major.has(r.id)}
          />
        ))}
      </ul>
      {hidden > 0 && (
        <button
          className="panel-card__more"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
        >
          {expanded ? 'Show less' : `+${hidden} more`}
        </button>
      )}
    </section>
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
    // Collapsed height: what the panel actually occupies on arrival. Packing on
    // the full length would reserve a column for rows nobody has asked to see.
    const rows = Math.min(panel[1].length, PANEL_MAX);
    heights[shortest] += 38 + rows * 44 + (panel[1].length > PANEL_MAX ? 30 : 0) + 14;
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
  dayLabel,
  major,
}: {
  release: Release;
  onOpen: (r: Release) => void;
  dayLabel: 'none' | 'weekday' | 'date';
  major?: boolean;
}) {
  const Kind = KIND_ICON[release.kind] ?? KIND_ICON.film;
  const drop = dropLabel(release);
  const day = formatDay(release.releaseDate);

  return (
    <li>
      <button className="row" data-major={major || undefined} onClick={() => onOpen(release)}>
        <Kind className="row__icon" />
        <span className="row__body">
          <span className="row__title">
            {release.title}
            {drop && <span className="row__drop">{drop}</span>}
            {release.drop?.finale && <span className="row__flag">FINALE</span>}
          </span>
          {/* Type, language, genre — the three things that decide whether a
              title is for you, in the order you'd ask them. */}
          <span className="row__meta">{metaLine(release)}</span>
        </span>
        {/* Score and day share one right-hand column. Both are fixed width, so
            the numbers line up down the panel and a missing score leaves a gap
            rather than shunting the row around. */}
        <span className="row__end">
          <Rating release={release} />
          {dayLabel !== 'none' && (
            <span className="row__day">
              {dayLabel === 'date' ? `${day.day} ${day.month}` : day.weekday}
            </span>
          )}
        </span>
      </button>
    </li>
  );
}
