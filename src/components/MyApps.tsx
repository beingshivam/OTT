import { useEffect, useState } from 'react';
import { PLATFORMS } from '../data/platforms';
import { PlatformLogo } from './PlatformLogo';

/**
 * "My apps" — the subscriptions this reader actually pays for.
 *
 * Opt-in, never on arrival: an earlier onboarding card asked for a platform
 * lineup before the reader had seen anything and was removed for it (see
 * lib/prefs.ts). This is a button in the toolbar. The first tap asks once,
 * with the apps' own icons; after that one tap narrows the whole site to
 * those apps and another tap lifts it. Remembered on this device only.
 */
export function MyAppsButton({
  apps,
  active,
  onToggle,
  onEdit,
  wide = false,
}: {
  apps: string[];
  active: boolean;
  onToggle: () => void;
  onEdit: () => void;
  /** The toolbar copy (hidden on narrow phones) rather than the own-line one. */
  wide?: boolean;
}) {
  const set = apps.length > 0;
  return (
    <>
      <span className={wide ? 'myapps myapps--toolbar' : 'myapps myapps--line'}>
        <button
          className="btn"
          /* The label text is hidden at phone width, which takes it out of the
             accessibility tree too — same reason the other toolbar buttons
             carry an aria-label (see Controls.tsx). */
          aria-label="My apps"
          data-active={active || undefined}
          aria-pressed={set ? active : undefined}
          onClick={() => (set ? onToggle() : onEdit())}
          title={set ? 'Show only my apps' : 'Pick the apps you subscribe to'}
        >
          <span aria-hidden="true">★</span>
          <span className="btn__text">My apps</span>
          {set && <span className="btn__count">{apps.length}</span>}
        </button>
        {set && (
          <button className="myapps__edit" onClick={onEdit} aria-label="Edit my apps">
            Edit
          </button>
        )}
      </span>
    </>
  );
}

export function MyAppsPicker({
  initial,
  region,
  onClose,
  onSave,
}: {
  initial: string[];
  region: string;
  onClose: () => void;
  onSave: (apps: string[]) => void;
}) {
  const [chosen, setChosen] = useState<string[]>(initial);
  const options = PLATFORMS.filter((p) => !p.theatrical && p.regions.includes(region)).sort((a, b) => a.rank - b.rank);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const flip = (id: string) => setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));

  return (
    <div className="myapps__scrim" role="presentation" onClick={onClose}>
      <div
        className="myapps__sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="myapps-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="myapps-title">Which apps do you have?</h2>
        <p>Pick the ones you pay for. One tap on ★ My apps then shows only what's on them.</p>
        <div className="myapps__grid">
          {options.map((p) => {
            const on = chosen.includes(p.id);
            return (
              <button
                key={p.id}
                className="myapps__opt"
                data-on={on || undefined}
                aria-pressed={on}
                onClick={() => flip(p.id)}
              >
                <PlatformLogo platformId={p.id} size={30} />
                <span>{p.name}</span>
                <span className="myapps__tick" aria-hidden="true">
                  {on ? '✓' : ''}
                </span>
              </button>
            );
          })}
        </div>
        <div className="myapps__actions">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn myapps__save" onClick={() => onSave(chosen)}>
            {chosen.length ? `Save ${chosen.length} app${chosen.length === 1 ? '' : 's'}` : 'Clear my apps'}
          </button>
        </div>
      </div>
    </div>
  );
}
