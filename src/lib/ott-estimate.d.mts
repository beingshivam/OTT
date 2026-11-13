/** Types for ott-estimate.mjs — plain JavaScript so the build and the app share it. */

export interface EstimateRow {
  id?: string | number;
  releaseDate?: string;
  platforms?: string[];
  languages?: string[];
  origin?: string[];
}

export interface GapStats {
  n: number;
  median: number;
  p25: number;
  p75: number;
}

export interface WindowStats {
  byLanguage: Record<string, GapStats>;
  all: GapStats | null;
}

export interface OttEstimate {
  /** Most likely arrival: cinema date + the typical gap. */
  likely: string;
  /** The usual window, earliest and latest. */
  from: string;
  to: string;
  /** The typical gap in days. */
  days: number;
  /** What the estimate rests on: the language (null when it borrowed the
   *  all-India pattern) and how many films. */
  basis: { language: string | null; films: number };
}

export type EstimatePhase = 'ahead' | 'due' | 'late';

export declare const INDIAN_LANGUAGES: Set<string>;
export declare const MIN_SAMPLE: number;
export declare function gapPairs(rows: EstimateRow[]): { id: string | number; language: string; days: number }[];
export declare function windowStats(pairs: { language: string; days: number }[]): WindowStats;
export declare function estimateFor(row: EstimateRow | null | undefined, stats: WindowStats | null): OttEstimate | null;
export declare function estimatePhase(est: OttEstimate | null | undefined, today: string): EstimatePhase | null;
export declare function weeksLabel(n: number): string;

export interface EstimateCopy {
  phase: EstimatePhase;
  headline: string;
  detail: string;
  /** For the facts list; null once the window has passed. */
  fact: string | null;
  /** For the title tag; null once the window has passed. */
  tag: string | null;
}

export declare function estimateCopy(
  est: OttEstimate | null | undefined,
  today: string,
  fmt: { languageLabel: (code: string) => string; formatDate: (iso: string) => string },
): EstimateCopy | null;
