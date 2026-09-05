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
  /**
   * URL slug, stamped onto the feed by the build for titles that got their own
   * page (scripts/build-seo.mjs, via scripts/slug.mjs). Absent on everything
   * else — its presence is exactly the test for "does this title have a page".
   * Never derived in the app: one implementation of the slug rule means the
   * path the build wrote and the path the app resolves cannot drift.
   */
  slug?: string;
  /** Regions this release applies to (ISO-3166-1). Used by the region switcher. */
  regions: string[];
  drop?: DropInfo;
  runtimeMinutes?: number;
  /**
   * 0–10, from TMDB's own audience score — not IMDb, which is a different
   * voting population and usually lands a few tenths away.
   *
   * Undefined for a title nobody has scored yet, which is most of what a
   * release calendar carries: nothing has a rating before it comes out.
   */
  rating?: number;
  /**
   * How many votes that score rests on. A 9.0 from six people and a 9.0 from
   * six thousand are not the same claim, and the board leans on this to decide
   * which scores are worth drawing the eye to.
   */
  votes?: number;
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
  /**
   * What's actually hot right now, regardless of when it came out — a title
   * that dropped a month ago and is peaking this week belongs here and could
   * never surface from a single week's rows. Absent until a live refresh runs.
   */
  trending?: Release[];
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
