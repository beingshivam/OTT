/**
 * Platform registry. `tmdb` maps our ids onto TMDB watch-provider ids so the
 * refresh script and the UI agree on what "Netflix" means — and so
 * `scripts/fetch-logos.mjs` can pull each provider's real logo.
 *
 * Until those logos are fetched, `mark` drives a monogram lockup in the brand
 * colour. Recognition on a board like this comes from the mark, not the label,
 * so it needs to hold its own rather than read as a missing image.
 */

export interface Platform {
  id: string;
  name: string;
  /** Compact label for chips and card badges. */
  short: string;
  /** 1–4 characters for the monogram shown until a real logo is available. */
  mark: string;
  accent: string;
  /** Second stop for platforms whose brand is a gradient. */
  accent2?: string;
  /** TMDB watch-provider ids. */
  tmdb: number[];
  regions: string[];
  /** Theatrical is not a streamer, but it belongs in the same weekly view. */
  theatrical?: boolean;
  homeUrl: string;
}

export const PLATFORMS: Platform[] = [
  { id: 'theatres',    name: 'In Theatres',  short: 'Theatres',  mark: '▶',  accent: '#FFC94A', accent2: '#FF8A3D', tmdb: [],           regions: ['IN', 'US'], theatrical: true, homeUrl: 'https://in.bookmyshow.com/' },
  { id: 'netflix',     name: 'Netflix',      short: 'Netflix',   mark: 'N',    accent: '#E50914', accent2: '#FF3B30', tmdb: [8, 1796],    regions: ['IN', 'US'], homeUrl: 'https://www.netflix.com/' },
  { id: 'prime',       name: 'Prime Video',  short: 'Prime',     mark: 'pv',   accent: '#00A8E1', accent2: '#48D2FF', tmdb: [9, 119],     regions: ['IN', 'US'], homeUrl: 'https://www.primevideo.com/' },
  { id: 'jiohotstar',  name: 'JioHotstar',   short: 'JioHotstar',mark: 'JH',   accent: '#7B5CFF', accent2: '#22B8FF', tmdb: [122, 970],   regions: ['IN'],       homeUrl: 'https://www.hotstar.com/in' },
  { id: 'appletv',     name: 'Apple TV+',    short: 'Apple TV+', mark: 'tv+',  accent: '#E8E8ED', accent2: '#9BA0AC', tmdb: [350, 2],     regions: ['IN', 'US'], homeUrl: 'https://tv.apple.com/' },
  { id: 'sonyliv',     name: 'SonyLIV',      short: 'SonyLIV',   mark: 'LIV',  accent: '#6C5CE7', accent2: '#00C2FF', tmdb: [237],        regions: ['IN'],       homeUrl: 'https://www.sonyliv.com/' },
  { id: 'zee5',        name: 'ZEE5',         short: 'ZEE5',      mark: 'Z5',   accent: '#8A2BE2', accent2: '#C13BFF', tmdb: [232],        regions: ['IN'],       homeUrl: 'https://www.zee5.com/' },
  { id: 'sunnxt',      name: 'Sun NXT',      short: 'Sun NXT',   mark: 'SUN',  accent: '#E4002B', accent2: '#FF5C7A', tmdb: [309],        regions: ['IN'],       homeUrl: 'https://www.sunnxt.com/' },
  { id: 'hoichoi',     name: 'hoichoi',      short: 'hoichoi',   mark: 'ho',   accent: '#F5333F', accent2: '#FF7A45', tmdb: [313],        regions: ['IN'],       homeUrl: 'https://www.hoichoi.tv/' },
  { id: 'simplysouth', name: 'Simply South', short: 'Simply South', mark: 'SS', accent: '#F0384B', accent2: '#FF8A9B', tmdb: [1885],     regions: ['IN'],       homeUrl: 'https://www.simplysouth.tv/' },
  { id: 'aha',         name: 'aha',          short: 'aha',       mark: 'aha',  accent: '#FF4E3A', accent2: '#FFA23A', tmdb: [532],        regions: ['IN'],       homeUrl: 'https://www.aha.video/' },
  { id: 'lionsgate',   name: 'Lionsgate Play', short: 'Lionsgate', mark: 'LG', accent: '#C8A24A', accent2: '#F0D488', tmdb: [1898],     regions: ['IN'],       homeUrl: 'https://www.lionsgateplay.com/' },
  { id: 'mubi',        name: 'MUBI',         short: 'MUBI',      mark: 'M',    accent: '#0A5AFF', accent2: '#5B9BFF', tmdb: [11],         regions: ['IN', 'US'], homeUrl: 'https://mubi.com/' },
  { id: 'crunchyroll', name: 'Crunchyroll',  short: 'Crunchyroll', mark: 'CR', accent: '#F47521', accent2: '#FFA95C', tmdb: [283],      regions: ['IN', 'US'], homeUrl: 'https://www.crunchyroll.com/' },
  { id: 'hbomax',      name: 'HBO Max',      short: 'HBO Max',   mark: 'MAX',  accent: '#8A4BFF', accent2: '#2E6BFF', tmdb: [1899, 384],  regions: ['US'],       homeUrl: 'https://www.max.com/' },
  { id: 'hulu',        name: 'Hulu',         short: 'Hulu',      mark: 'hu',   accent: '#1CE783', accent2: '#7CFFC0', tmdb: [15],         regions: ['US'],       homeUrl: 'https://www.hulu.com/' },
  { id: 'disney',      name: 'Disney+',      short: 'Disney+',   mark: 'D+',   accent: '#1B44C8', accent2: '#4E8CFF', tmdb: [337],        regions: ['US'],       homeUrl: 'https://www.disneyplus.com/' },
  { id: 'paramount',   name: 'Paramount+',   short: 'Paramount+',mark: 'P+',   accent: '#0064FF', accent2: '#49A0FF', tmdb: [531],        regions: ['US'],       homeUrl: 'https://www.paramountplus.com/' },
  { id: 'peacock',     name: 'Peacock',      short: 'Peacock',   mark: 'P',    accent: '#00B2E3', accent2: '#FFC800', tmdb: [386],        regions: ['US'],       homeUrl: 'https://www.peacocktv.com/' },
  { id: 'shudder',     name: 'Shudder',      short: 'Shudder',   mark: 'SH',   accent: '#B31217', accent2: '#E23B3B', tmdb: [99],         regions: ['US'],       homeUrl: 'https://www.shudder.com/' },
];

export const PLATFORM_BY_ID = new Map(PLATFORMS.map((p) => [p.id, p]));

export function platform(id: string): Platform {
  return (
    PLATFORM_BY_ID.get(id) ?? {
      id,
      name: id,
      short: id,
      mark: id.slice(0, 2).toUpperCase(),
      accent: '#8A93A6',
      tmdb: [],
      regions: ['IN', 'US'],
      homeUrl: '#',
    }
  );
}

/**
 * Some brands are near-white (Apple TV+ is #E8E8ED), so white ink on their
 * accent disappears. Pick the ink from relative luminance instead of assuming
 * every brand colour is dark enough to sit text on.
 */
export function inkOn(accent: string): string {
  const hex = accent.replace('#', '');
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const luminance = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return luminance > 0.45 ? '#0b0d12' : '#ffffff';
}

export const REGIONS = [
  { code: 'IN', label: 'India', flag: '🇮🇳' },
  { code: 'US', label: 'United States', flag: '🇺🇸' },
];

export const LANGUAGES: Record<string, string> = {
  hi: 'Hindi',
  en: 'English',
  ta: 'Tamil',
  te: 'Telugu',
  ml: 'Malayalam',
  kn: 'Kannada',
  bn: 'Bengali',
  mr: 'Marathi',
  pa: 'Punjabi',
  gu: 'Gujarati',
  or: 'Odia',
  ur: 'Urdu',
  ko: 'Korean',
  ja: 'Japanese',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
};

export function languageName(code: string): string {
  return LANGUAGES[code] ?? code.toUpperCase();
}

export const KIND_LABEL: Record<string, string> = {
  film: 'Film',
  series: 'Series',
  documentary: 'Documentary',
  reality: 'Reality',
  anime: 'Anime',
  special: 'Special',
};
