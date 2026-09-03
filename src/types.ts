/** Canonical shape of everything the app renders. One release = one title landing on one date. */

export type TitleKind =
  | 'film'
  | 'series'
  | 'documentary'
  | 'reality'
  | 'anime'
  | 'special';

/** A season/episode drop, so series cards can say "S2 E4" without parsing the title. */
export interface DropInfo {
  season?: number;
  episode?: number;
  /** True when this drop closes out the season/series. Rendered as a "FINALE" flag. */
  finale?: boolean;
  /** True when the whole season lands at once. */
  fullSeason?: boolean;
}

export interface Release {
  id: string;
  title: string;
  kind: TitleKind;
  /** Platform ids from the registry in `src/data/platforms.ts`. A title can drop in more than one place. */
  platforms: string[];
  /** ISO-639-1 codes. First entry is treated as the primary language. */
  languages: string[];
  genres: string[];
  /** ISO date (YYYY-MM-DD) the title becomes available. */
  releaseDate: string;
  /** Regions this release applies to (ISO-3166-1). Used by the region switcher. */
  regions: string[];
  drop?: DropInfo;
  runtimeMinutes?: number;
  /** 0–10, TMDB-style. Undefined for unrated/too-new titles. */
  rating?: number;
  /** 0–100 popularity used for the Trending sort. Higher is hotter. */
  heat?: number;
  synopsis?: string;
  cast?: string[];
  director?: string;
  certification?: string;
  posterUrl?: string;
  backdropUrl?: string;
  trailerUrl?: string;
  /** Where to actually watch it. */
  watchUrl?: string;
  /** Set when the row came from the seeded sample set rather than a live TMDB pull. */
  sample?: boolean;
}

/** One Friday→Thursday release week. */
export interface ReleaseWeek {
  /** ISO date of the week's Friday. Doubles as the week's id. */
  id: string;
  start: string;
  end: string;
  releases: Release[];
}

export interface ReleaseFeed {
  /** ISO timestamp of the last successful refresh. */
  generatedAt: string;
  source: 'tmdb' | 'sample';
  weeks: ReleaseWeek[];
}

export type SortKey = 'trending' | 'newest' | 'rating' | 'az';

export interface Filters {
  weekId: string;
  region: string;
  platforms: string[];
  kinds: TitleKind[];
  languages: string[];
  genres: string[];
  query: string;
  sort: SortKey;
}
