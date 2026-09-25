import { useEffect, useRef, useState } from 'react';
import { PosterArt } from './PosterArt';
import { MoreLikeThis } from './MoreLikeThis';
import { IconClose, IconExternal } from './icons';
import { platform, languageName, KIND_LABEL } from '../data/platforms';
import { runtimeLabel } from '../lib/format';
import {
  fetchCatalogueTitle,
  platformsFor,
  type CatalogueState,
} from '../lib/catalogueTitle';

/**
 * The sheet a search result opens when the calendar has never heard of it.
 *
 * Deliberately not DetailSheet. That component is built around a release date
 * — "3 days ago", a countdown, a drop time, "leaves Friday" — and every one of
 * those sentences is a lie about a 1994 film. Threading a mode through it
 * would have put an `if` beside each of them and left the next reader working
 * out which half of the component applied. This one has no calendar in it at
 * all, which is the whole difference between the two things.
 *
 * It shares the sheet's markup and classes, so it is the same object on screen.
 */
export function CatalogueSheet({
  id,
  fallbackTitle,
  onClose,
}: {
  id: string;
  fallbackTitle: string;
  onClose: () => void;
}) {
  /* The sheet owns which title it is showing rather than reading the prop
     directly, because a recommendation replaces the contents in place. Opening
     a different result from search resets it through the effect below. */
  const [showing, setShowing] = useState({ id, title: fallbackTitle });
  useEffect(() => setShowing({ id, title: fallbackTitle }), [id, fallbackTitle]);

  const [state, setState] = useState<CatalogueState>({ status: 'loading' });
  const closeRef = useRef<HTMLButtonElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ac = new AbortController();
    setState({ status: 'loading' });
    /* Back to the top, or a reader who tapped a recommendation from the bottom
       of a long sheet lands halfway down the next one. */
    scrollRef.current?.scrollTo({ top: 0 });
    fetchCatalogueTitle(showing.id, ac.signal).then((next) => {
      if (!ac.signal.aborted) setState(next);
    });
    return () => ac.abort();
  }, [showing.id]);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const t = state.status === 'ready' ? state.title : null;

  /* Streaming and renting are different answers and the pills cannot say which
     is which, so they are two rows with two headings. */
  const streaming = t ? platformsFor(t.providerIds) : [];
  const rentBuy = t ? platformsFor(t.rentBuyIds).filter((p) => !streaming.includes(p)) : [];
  const lead = streaming[0] ?? rentBuy[0] ?? 'theatres';
  const hero = t?.backdropUrl ?? t?.posterUrl ?? null;
  const heroIsPoster = Boolean(t && !t.backdropUrl && t.posterUrl);

  return (
    <div
      className="sheet-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="sheet-title"
    >
      <div className="sheet">
        <button ref={closeRef} className="sheet__close" onClick={onClose} aria-label="Close">
          <IconClose />
        </button>
        <div className="sheet__scroll" ref={scrollRef}>
          <div className={`sheet__hero${heroIsPoster ? ' sheet__hero--poster' : ''}`}>
            <PosterArt
              className="art"
              title={t?.title ?? showing.title}
              platformId={lead}
              imageUrl={hero ?? undefined}
              quiet
            />
            <span className="sheet__hero-scrim" />
          </div>

          <div className="sheet__body">
            <h2 className="sheet__title" id="sheet-title">
              {t?.title ?? showing.title}
            </h2>

            {state.status === 'loading' && <p className="sheet__pending">Looking it up…</p>}

            {state.status === 'degraded' && (
              <p className="sheet__pending">
                Couldn’t reach the film database just now. Try again in a moment.
              </p>
            )}
            {state.status === 'missing' && (
              <p className="sheet__pending">That title isn’t in the film database any more.</p>
            )}

            {t && (
              <>
                <div className="sheet__pills">
                  <span className="pill">{KIND_LABEL[t.kind]}</span>
                  {t.year && <span className="pill">{t.year}</span>}
                  {t.certification && <span className="pill">{t.certification}</span>}
                  {t.rating != null && <span className="pill">★ {t.rating.toFixed(1)}</span>}
                  {t.seasons != null && (
                    <span className="pill">
                      {t.seasons} season{t.seasons === 1 ? '' : 's'}
                    </span>
                  )}
                </div>

                {/*
                  The reason the sheet exists. Everything above is context; this
                  is the question the site is for, answered for a title that is
                  nowhere near the release calendar.
                */}
                {streaming.length > 0 ? (
                  <div className="sheet__section">
                    <h3>Streaming in India</h3>
                    <div className="sheet__actions sheet__actions--lead">
                      {streaming.map((pid) => {
                        const p = platform(pid);
                        return (
                          <a
                            key={pid}
                            className="btn btn--lg"
                            href={
                              p.searchUrl
                                ? p.searchUrl.replace('{q}', encodeURIComponent(t.title))
                                : p.homeUrl
                            }
                            target="_blank"
                            rel="noreferrer"
                            style={{ color: p.accent }}
                          >
                            <span style={{ color: '#fff' }}>Watch on {p.name}</span>
                            <IconExternal />
                          </a>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  /* Said plainly rather than left blank. "We don't know" and
                     "it isn't streaming here" are different answers, and only
                     one of them is true — TMDB knows the Indian providers, so
                     an empty list means nobody carries it. */
                  <div className="sheet__section">
                    <h3>Streaming in India</h3>
                    <p>Not on any service we track right now.</p>
                  </div>
                )}

                {rentBuy.length > 0 && (
                  <div className="sheet__section">
                    <h3>Rent or buy</h3>
                    <p>{rentBuy.map((pid) => platform(pid).name).join(', ')}</p>
                  </div>
                )}

                {t.synopsis && (
                  <div className="sheet__section">
                    <h3>What it’s about</h3>
                    <p>{t.synopsis}</p>
                  </div>
                )}

                <dl className="sheet__grid">
                  {t.languages.length > 0 && (
                    <div>
                      <dt>Language</dt>
                      <dd>{t.languages.map(languageName).join(', ')}</dd>
                    </div>
                  )}
                  {t.runtimeMinutes != null && (
                    <div>
                      <dt>Runtime</dt>
                      <dd>{runtimeLabel(t.runtimeMinutes)}</dd>
                    </div>
                  )}
                  {t.director && (
                    <div>
                      <dt>{t.kind === 'series' ? 'Created by' : 'Director'}</dt>
                      <dd>{t.director}</dd>
                    </div>
                  )}
                </dl>

                {t.cast.length > 0 && (
                  <div className="sheet__section">
                    <h3>Cast</h3>
                    <p>{t.cast.join(', ')}</p>
                  </div>
                )}

                {t.genres.length > 0 && (
                  <div className="sheet__section">
                    <h3>Genre</h3>
                    <p>{t.genres.join(', ')}</p>
                  </div>
                )}

                <MoreLikeThis
                  items={t.similar}
                  platformId={lead}
                  onPick={(s) => setShowing({ id: s.id, title: s.title })}
                />
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
