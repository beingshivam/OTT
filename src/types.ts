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
  /**
   * Where this row's platform came from, when it did not come from a watch
   * provider. Absent on provider rows, which are the default.
   *
   * A provider is TMDB reporting that a title is available somewhere. The other
   * three are weaker: `note` is free text a contributor typed onto the release
   * date, `studio` is inferred from the production company, `network` from a
   * series' broadcaster. They exist because a provider cannot answer about a
   * title that is not out yet, and on the current feed they name almost every
   * upcoming row — but each can be wrong in a way a provider cannot, and being
   * wrong here sends a reader to a subscription they do not need.
   *
   * Carried so that a platform someone reports as wrong can be traced to the
   * source that claimed it, instead of the row looking identical to a fact.
   */
  namedBy?: 'note' | 'studio' | 'network';
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
  /**
   * Rank within this title's own language on the back catalogue's popularity
   * pass — 1 is the most popular Malayalam title, 1 is also the most popular
   * Hindi one (scripts/fetch-catalogue.mjs).
   *
   * A rank rather than a raw popularity number, because raw numbers are not
   * comparable across languages: TMDB's audience is not Indian, so a Malayalam
   * hit scores far below an American one no matter how much India watched it.
   * Ranks are comparable, which is what lets a trending view interleave the
   * languages and stay both honest and diverse.
   */
  popRank?: number;
  /**
   * The same rank on the previous refresh, where the title was on that list
   * too. Absent for anything new to it — a title that was not ranked last week
   * has not risen, and treating "absent" as "came from the bottom" would invent
   * movement that never happened.
   */
  prevPopRank?: number;
  /**
   * IMDb's id for this title, from TMDB during enrichment.
   *
   * Only here so the IMDb score can be looked up by id rather than by name —
   * matching on a title and a year is a guess, and its failure mode is a
   * regional film silently wearing an unrelated one's rating.
   */
  imdbId?: string;
  /**
   * IMDb's score and the votes behind it (scripts/enrich-ratings.mjs).
   *
   * Kept separate from `rating`/`votes`, which are TMDB's, rather than merged
   * into them: they are different voting populations and usually land a few
   * tenths apart, so a card showing one and a page ranking by the other would
   * disagree in public. Always set together or not at all — a score with no
   * vote count cannot be ranked on honestly.
   */
  imdbRating?: number;
  imdbVotes?: number;
  synopsis?: string;
  cast?: string[];
  director?: string;
  certification?: string;
  /**
   * How widely the film opened in cinemas here, from TMDB's release types.
   *
   * Absent on most rows and on every series, and absence means unknown rather
   * than small — see theatricalFrom in scripts/enrich-releases.mjs. Only ever
   * used to hold something back, never to promote it.
   */
  theatrical?: 'wide' | 'limited';
  /**
   * ISO country codes the film was produced in.
   *
   * Not a synonym for language: nine of the twelve titles this feed files as
   * English in Indian cinemas are Indian films TMDB has mislabelled. Origin is
   * the fact language was being asked to stand in for — see originFrom in
   * scripts/enrich-releases.mjs.
   */
  origin?: string[];
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
