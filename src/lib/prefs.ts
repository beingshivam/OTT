/**
 * The one thing worth remembering between visits: which region's calendar you
 * read. Kept on the device, so there is still nothing to sign in to.
 */

// Named for an earlier brand, and deliberately left that way: it is an opaque
// key rather than anything a visitor reads, and changing it would drop the
// stored region of every returning reader for no gain.
const KEY = 'dropday.prefs.v1';

/** The site briefly shipped as firstday; anyone who set a region then keeps it. */
const LEGACY_KEY = 'firstday.prefs.v1';

export interface Prefs {
  region: string;
}

export const DEFAULT_PREFS: Prefs = {
  region: 'IN',
};

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(KEY) ?? localStorage.getItem(LEGACY_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<Prefs>;
    // Older builds also stored a platform/language "lineup" here. That was set
    // through an onboarding card that no longer exists, so the keys are read
    // past rather than migrated — the filter bar covers the same ground, and
    // the URL carries it, without interrupting anyone on arrival.
    return { region: typeof parsed.region === 'string' ? parsed.region : DEFAULT_PREFS.region };
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
