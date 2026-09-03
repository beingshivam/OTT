import { KIND_ICON } from './icons';
import { PosterArt } from './PosterArt';
import { KIND_LABEL, languageName, platform } from '../data/platforms';
import type { Release } from '../types';

/** "S2 E4", "S1", "" — the shorthand people actually use in group chats. */
export function dropLabel(r: Release): string {
  const d = r.drop;
  if (!d) return '';
  const parts: string[] = [];
  if (d.season != null) parts.push(`S${d.season}`);
  if (d.episode != null) parts.push(`E${d.episode}`);
  return parts.join(' ');
}

interface Props {
  release: Release;
  onOpen: (r: Release) => void;
  /** Staggers the entrance animation across a grid. */
  index?: number;
}

export function ReleaseCard({ release, onOpen, index = 0 }: Props) {
  const primary = platform(release.platforms[0]);
  const Kind = KIND_ICON[release.kind] ?? KIND_ICON.film;
  const drop = dropLabel(release);
  const langs = release.languages.map(languageName);

  return (
    <button
      className="card"
      style={
        {
          '--card-accent': primary.accent,
          animationDelay: `${Math.min(index, 18) * 22}ms`,
        } as React.CSSProperties
      }
      onClick={() => onOpen(release)}
      aria-label={`${release.title} — ${primary.name}`}
    >
      <div className="card__poster">
        <PosterArt
          className="art card__art"
          title={release.title}
          platformId={primary.id}
          imageUrl={release.posterUrl}
        />
        <span className="card__badge">
          <i />
          {primary.short}
        </span>
        {release.drop?.finale && <span className="card__flag">FINALE</span>}
        <span className="card__foot">
          <span className="card__kind">
            <Kind />
            {KIND_LABEL[release.kind] ?? release.kind}
          </span>
          {drop && <span className="card__drop">{drop}</span>}
        </span>
      </div>
      <span className="card__body">
        <span className="card__title">{release.title}</span>
        <span className="card__sub">
          {langs.slice(0, 2).join(', ')}
          {langs.length > 2 ? ` +${langs.length - 2}` : ''}
        </span>
      </span>
    </button>
  );
}
