import { useEffect, useRef, useState } from 'react';
import { IconCalendar, IconClose, IconExternal, IconShare, IconCheck } from './icons';
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
    // Remember what opened the sheet so focus can go back there on close.
    // Without this, dismissing dropped focus to <body> and a keyboard user lost
    // their place in the board entirely.
    const opener = document.activeElement as HTMLElement | null;

    closeRef.current?.focus();
    document.body.classList.add('is-locked');

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);

    return () => {
      document.body.classList.remove('is-locked');
      window.removeEventListener('keydown', onKey);
      if (opener?.isConnected) opener.focus();
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

  // Land on the title, not the homepage. On a phone these https links are
  // universal links, so the installed app opens instead of the browser.
  const watchUrl =
    release.watchUrl ??
    (p.searchUrl ? p.searchUrl.replace('{q}', encodeURIComponent(release.title)) : p.homeUrl);

  return (
    <div
      className="sheet-backdrop"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="sheet-title"
    >
      <div className="sheet">
        {/* Outside the scrolling region on purpose. It used to sit inside it,
            absolutely positioned, so it scrolled away with the content — on a
            phone, where the sheet is nearly full height and the overview runs
            long, it was gone after the first flick and the only way out left
            was the back gesture. */}
        <button ref={closeRef} className="sheet__close" onClick={onClose} aria-label="Close">
          <IconClose />
        </button>
        <div className="sheet__scroll">
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
            {release.rating != null && (
              <span
                className="pill"
                title={`${release.rating.toFixed(1)} on TMDB${
                  release.votes ? `, from ${release.votes.toLocaleString()} votes` : ''
                }`}
              >
                ★ {release.rating.toFixed(1)}
              </span>
            )}
          </div>

          <div className="sheet__actions sheet__actions--lead">
            {/* One button per place it's actually available, not just the first. */}
            {release.platforms.map((id, i) => {
              const target = platform(id);
              const href =
                i === 0
                  ? watchUrl
                  : target.searchUrl
                    ? target.searchUrl.replace('{q}', encodeURIComponent(release.title))
                    : target.homeUrl;
              return (
                <a
                  key={id}
                  className={i === 0 ? 'btn btn--primary' : 'btn btn--lg'}
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                >
                  {/* An outward arrow, not a play triangle. The play icon said
                      "playback starts here" while the label said the opposite,
                      and the icon is what gets read first — a reader wrote in
                      unsure whether this site streams anything. Naming the
                      destination and pointing away from the page is the whole
                      clarification. */}
                  <IconExternal />
                  {target.theatrical ? 'Book tickets' : `Watch on ${target.short}`}
                </a>
              );
            })}
            {release.trailerUrl && (
              <a className="btn btn--lg" href={release.trailerUrl} target="_blank" rel="noreferrer">
                <IconExternal />
                Trailer
              </a>
            )}
            {/* The other half of the release-date pages: without a link a
                person can click, those pages would be reachable only from a
                search result, and prerendered links no visitor can follow are
                the cloaking problem the whole set is built to avoid. */}
            {release.slug && (
              <a className="btn btn--lg" href={`/ott-release-date/${release.slug}`}>
                <IconCalendar />
                OTT release date
              </a>
            )}
            <button className="btn btn--lg" onClick={share}>
              {copied ? <IconCheck /> : <IconShare />}
              {copied ? 'Copied' : 'Share'}
            </button>
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
            {release.runtimeMinutes != null && (
              <div className="sheet__stat">
                <dt>Runtime</dt>
                <dd>{release.runtimeMinutes} min</dd>
              </div>
            )}
            {release.director && (
              <div className="sheet__stat">
                <dt>Director</dt>
                <dd>{release.director}</dd>
              </div>
            )}
          </dl>

          {release.synopsis && (
            <div className="sheet__section">
              <h4>Overview</h4>
              <p>{release.synopsis}</p>
            </div>
          )}

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

        </div>
        </div>
      </div>
    </div>
  );
}
