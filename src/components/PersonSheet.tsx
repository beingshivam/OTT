import { useEffect, useRef, useState } from 'react';
import { PosterArt } from './PosterArt';
import { IconClose } from './icons';
import { fetchPerson, type PersonState, type PersonCredit } from '../lib/catalogueTitle';

/**
 * One person, and the work.
 *
 * Reported as a gap and it was also a regression: tapping a person in search
 * used to write their name into the box, which worked only while the box
 * filtered the board — their films appeared underneath because the board
 * matched on cast. The box stopped touching the board, and the tap quietly
 * became a no-op that re-runs the same search.
 *
 * A filmography rather than a biography. Somebody who searched a name is
 * looking for a film they cannot name, not for a date of birth, and TMDB's
 * biographies are long, often untranslated and frequently missing. The grid is
 * the whole answer.
 *
 * Best known first, decided at the edge. A filmography in date order opens on
 * whatever they did most recently, which across a long career is usually the
 * least recognisable thing on it.
 */
export function PersonSheet({
  id,
  fallbackName,
  onClose,
  onPick,
}: {
  id: string;
  fallbackName: string;
  onClose: () => void;
  /** Where a credit leads. App decides, because it knows which of these the
   *  site has a page for. */
  onPick: (credit: PersonCredit) => void;
}) {
  const [state, setState] = useState<PersonState>({ status: 'loading' });
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const ac = new AbortController();
    setState({ status: 'loading' });
    fetchPerson(id, ac.signal).then((next) => {
      if (!ac.signal.aborted) setState(next);
    });
    return () => ac.abort();
  }, [id]);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const p = state.status === 'ready' ? state.person : null;

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
        <div className="sheet__scroll">
          <div className="sheet__body sheet__body--plain">
            {/* No hero. A person has a headshot, not a backdrop, and stretching
                a 2:3 portrait across a 21:9 frame crops it to a forehead. */}
            <div className="person__head">
              {p?.image ? (
                <img className="person__photo" src={p.image} alt="" loading="lazy" decoding="async" />
              ) : (
                <span className="person__photo person__photo--blank" aria-hidden="true" />
              )}
              <div>
                <h2 className="sheet__title" id="sheet-title">
                  {p?.name ?? fallbackName}
                </h2>
                {p?.role && <p className="person__role">{p.role}</p>}
              </div>
            </div>

            {state.status === 'loading' && <p className="sheet__pending">Looking them up…</p>}
            {state.status === 'degraded' && (
              <p className="sheet__pending">
                Couldn’t reach the film database just now. Try again in a moment.
              </p>
            )}
            {state.status === 'missing' && (
              <p className="sheet__pending">That name isn’t in the film database any more.</p>
            )}

            {p && p.credits.length > 0 && (
              <div className="sheet__section">
                <h3>Films and shows</h3>
                {/* A wrapping grid rather than the scrolling row a title uses:
                    this is the answer to the question, not a footnote under
                    one, so it should not have to be swiped through. */}
                <ul className="sheet__more sheet__more--grid">
                  {p.credits.map((c) => (
                    <li key={c.id}>
                      <button type="button" onClick={() => onPick(c)}>
                        <PosterArt
                          className="sheet__more-art"
                          title={c.title}
                          platformId="theatres"
                          imageUrl={c.image ?? undefined}
                          quiet
                        />
                        <span className="sheet__more-name">{c.title}</span>
                        <span className="sheet__more-year">
                          {[c.year, c.as].filter(Boolean).join(' · ')}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {p && p.credits.length === 0 && (
              <p className="sheet__pending">Nothing with artwork on their filmography yet.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
