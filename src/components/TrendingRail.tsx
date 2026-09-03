import { PosterArt } from './PosterArt';
import { dropLabel } from './ReleaseCard';
import { KIND_LABEL, languageName, platform } from '../data/platforms';
import type { Release } from '../types';

interface Props {
  releases: Release[];
  onOpen: (r: Release) => void;
}

/**
 * The answer to "just show me what's worth watching". Ranked by the feed's heat
 * score, capped at eight so it stays a recommendation and not a second grid.
 */
export function TrendingRail({ releases, onOpen }: Props) {
  if (releases.length < 3) return null;
  const top = releases.slice(0, 8);

  return (
    <section className="section" aria-labelledby="trending-heading">
      <div className="section__head">
        <h2 className="section__title" id="trending-heading">
          The big ones
        </h2>
        <span className="section__sub">Most talked-about drops this week</span>
      </div>
      <div className="rail">
        {top.map((r, i) => {
          const p = platform(r.platforms[0]);
          const drop = dropLabel(r);
          return (
            <button
              key={r.id}
              className="spot"
              onClick={() => onOpen(r)}
              aria-label={`${r.title} — ${p.name}`}
            >
              <PosterArt
                className="art spot__art"
                title={r.title}
                platformId={p.id}
                imageUrl={r.backdropUrl ?? r.posterUrl}
              />
              <span className="spot__scrim" />
              <span className="spot__rank">{String(i + 1).padStart(2, '0')}</span>
              <span className="spot__body">
                <span className="spot__title">{r.title}</span>
                <span className="spot__meta">
                  <span className="pill" style={{ color: p.accent }}>
                    <i />
                    <span style={{ color: '#fff' }}>{p.short}</span>
                  </span>
                  <span className="pill">{KIND_LABEL[r.kind]}</span>
                  {drop && <span className="pill">{drop}</span>}
                  <span className="pill">{languageName(r.languages[0])}</span>
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
