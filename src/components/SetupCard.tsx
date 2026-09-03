import { IconClose } from './icons';
import { languageName, platform } from '../data/platforms';
import type { Prefs } from '../lib/prefs';

interface Props {
  prefs: Prefs;
  platformOptions: string[];
  languageOptions: string[];
  onChange: (next: Partial<Prefs>) => void;
  onDone: () => void;
}

/**
 * The whole personalisation story, without an account: pick your platforms and
 * languages once and they're remembered on this device. Nothing is uploaded,
 * so there's nothing to sign in to.
 */
export function SetupCard({ prefs, platformOptions, languageOptions, onChange, onDone }: Props) {
  const picked = prefs.platforms.length + prefs.languages.length;

  return (
    <section className="setup">
      <button className="setup__dismiss" onClick={onDone} aria-label="Dismiss">
        <IconClose />
      </button>
      <h3>Make this yours — no account needed</h3>
      <p>
        Tell us what you actually subscribe to and we'll lead with it every week. Saved on this
        device only.
      </p>

      <div className="panel__group" style={{ marginBottom: 16 }}>
        <span className="panel__label">Your platforms</span>
        <div className="panel__chips">
          {platformOptions.map((id) => {
            const p = platform(id);
            const on = prefs.platforms.includes(id);
            return (
              <button
                key={id}
                className="chip"
                data-on={on}
                aria-pressed={on}
                style={{ '--chip-accent': p.accent } as React.CSSProperties}
                onClick={() =>
                  onChange({
                    platforms: on
                      ? prefs.platforms.filter((x) => x !== id)
                      : [...prefs.platforms, id],
                  })
                }
              >
                <span className="chip__dot" />
                {p.short}
              </button>
            );
          })}
        </div>
      </div>

      <div className="panel__group" style={{ marginBottom: 18 }}>
        <span className="panel__label">Your languages</span>
        <div className="panel__chips">
          {languageOptions.map((code) => {
            const on = prefs.languages.includes(code);
            return (
              <button
                key={code}
                className="chip"
                data-on={on}
                aria-pressed={on}
                onClick={() =>
                  onChange({
                    languages: on
                      ? prefs.languages.filter((x) => x !== code)
                      : [...prefs.languages, code],
                  })
                }
              >
                {languageName(code)}
              </button>
            );
          })}
        </div>
      </div>

      <button className="btn btn--primary" onClick={onDone}>
        {picked > 0 ? 'Show my week' : 'Skip for now'}
      </button>
    </section>
  );
}
