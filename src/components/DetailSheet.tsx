import { useEffect, useRef, useState } from 'react';
import { IconClose, IconExternal, IconPlay, IconShare, IconCheck } from './icons';
import { PosterArt } from './PosterArt';
import { dropLabel } from './ReleaseCard';
import { KIND_LABEL, languageName, platform } from '../data/platforms';
import { formatDay } from '../lib/week';
import type { Release } from '../types';

interface Props {
  release: Release;
  onClose: () => void;
}

export function DetailSheet({ release, onClose }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [copied, setCopied] = useState(false);
  const p = platform(release.platforms[0]);
  const day = formatDay(release.releaseDate);
  const drop = release.drop;
  const dropText = dropLabel(release);

  useEffect(() => {
    closeRef.current?.focus();
    document.body.classList.add('is-locked');
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.classList.remove('is-locked');
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  async function share() {
    const text = `${release.title} — ${p.name}, ${day.weekday} ${day.day} ${day.month}`;
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({ title: release.title, text, url });
        return;
      } catch {
        /* User dismissed the share sheet — fall through to copying. */
      }
    }
    try {
      await navigator.clipboard.writeText(`${text}\n${url}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* Clipboard blocked; nothing useful left to do. */
    }
  }

  const watchUrl = release.watchUrl ?? p.homeUrl;

  return (
    <div
      className="sheet-backdrop"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="sheet-title"
    >
      <div className="sheet">
        <button ref={closeRef} className="sheet__close" onClick={onClose} aria-label="Close">
          <IconClose />
        </button>
        <div className="sheet__hero">
          <PosterArt
            className="art"
            title={release.title}
            platformId={p.id}
            imageUrl={release.backdropUrl}
            quiet
          />
          <span className="sheet__hero-scrim" />
        </div>

        <div className="sheet__body">
          <h2 className="sheet__title" id="sheet-title">
            {release.title}
          </h2>

          <div className="sheet__pills">
            <span className="pill" style={{ color: p.accent }}>
              <i />
              <span style={{ color: '#fff' }}>{p.name}</span>
            </span>
            <span className="pill">{KIND_LABEL[release.kind]}</span>
            {dropText && <span className="pill">{dropText}</span>}
            {drop?.fullSeason && <span className="pill">Full season</span>}
            {drop?.finale && <span className="pill">Finale</span>}
            {release.certification && <span className="pill">{release.certification}</span>}
            {release.rating != null && <span className="pill">★ {release.rating.toFixed(1)}</span>}
          </div>

          <dl className="sheet__grid">
            <div className="sheet__stat">
              <dt>Drops</dt>
              <dd>{`${day.weekday}, ${day.day} ${day.month}`}</dd>
            </div>
            <div className="sheet__stat">
              <dt>Languages</dt>
              <dd>{release.languages.map(languageName).join(', ')}</dd>
            </div>
            <div className="sheet__stat">
              <dt>Where</dt>
              <dd>{release.platforms.map((id) => platform(id).name).join(', ')}</dd>
            </div>
            <div className="sheet__stat">
              <dt>Runtime</dt>
              <dd>{release.runtimeMinutes ? `${release.runtimeMinutes} min` : '—'}</dd>
            </div>
          </dl>

          <div className="sheet__section">
            <h4>Overview</h4>
            <p>
              {release.synopsis ??
                'No synopsis yet — this title came in off the weekly release calendar. Details fill in automatically on the next catalogue refresh.'}
            </p>
          </div>

          {release.genres.length > 0 && (
            <div className="sheet__section">
              <h4>Genres</h4>
              <div className="sheet__pills" style={{ marginBottom: 0 }}>
                {release.genres.map((g) => (
                  <span className="pill" key={g}>
                    {g}
                  </span>
                ))}
              </div>
            </div>
          )}

          {release.cast && release.cast.length > 0 && (
            <div className="sheet__section">
              <h4>Cast</h4>
              <p>{release.cast.join(' · ')}</p>
            </div>
          )}

          <div className="sheet__actions">
            <a className="btn btn--primary" href={watchUrl} target="_blank" rel="noreferrer">
              <IconPlay />
              {p.theatrical ? 'Book tickets' : `Open ${p.short}`}
            </a>
            {release.trailerUrl && (
              <a className="btn btn--lg" href={release.trailerUrl} target="_blank" rel="noreferrer">
                <IconExternal />
                Trailer
              </a>
            )}
            <button className="btn btn--lg" onClick={share}>
              {copied ? <IconCheck /> : <IconShare />}
              {copied ? 'Copied' : 'Share'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
