/**
 * "No login, nothing" still leaves room for personalisation — we just keep it on
 * the device. Picking your platforms and languages once turns the whole page into
 * a personal feed, and nothing leaves the browser.
 */

const KEY = 'dropday.prefs.v1';

/**
 * The site briefly shipped as firstday. Anyone who picked their platforms during
 * that window would otherwise silently lose them and be shown the onboarding
 * card again, which reads as the app forgetting them. Cheap to keep reading.
 */
const LEGACY_KEY = 'firstday.prefs.v1';

export interface Prefs {
  platforms: string[];
  languages: string[];
  region: string;
  /** Set once the user has answered (or dismissed) the setup prompt. */
  onboarded: boolean;
}

export const DEFAULT_PREFS: Prefs = {
  platforms: [],
  languages: [],
  region: 'IN',
  onboarded: false,
};

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(KEY) ?? localStorage.getItem(LEGACY_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<Prefs>;
    return {
      platforms: Array.isArray(parsed.platforms) ? parsed.platforms : [],
      languages: Array.isArray(parsed.languages) ? parsed.languages : [],
      region: typeof parsed.region === 'string' ? parsed.region : DEFAULT_PREFS.region,
      onboarded: Boolean(parsed.onboarded),
    };
  } catch {
    // Private mode, blocked storage, corrupted value — none of it should break the page.
    return DEFAULT_PREFS;
  }
}

export function savePrefs(prefs: Prefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* Storage is a convenience here, never a requirement. */
  }
}

/** Region guess from the browser locale, used only before the user picks one. */
export function guessRegion(): string {
  try {
    const locales = navigator.languages?.length ? navigator.languages : [navigator.language];
    for (const loc of locales) {
      const region = new Intl.Locale(loc).region;
      if (region === 'IN' || region === 'US') return region;
    }
    if (Intl.DateTimeFormat().resolvedOptions().timeZone?.startsWith('Asia/Kolkata')) return 'IN';
  } catch {
    /* fall through */
  }
  return 'IN';
}
