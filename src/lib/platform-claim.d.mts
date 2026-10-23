/**
 * Types for platform-claim.mjs, which is plain JavaScript on purpose.
 *
 * Same arrangement as changes.d.mts, and for the same reason: the rule has to
 * be importable by scripts/build-seo.mjs and scripts/eval.mjs — plain Node, no
 * build step — and by the app, so the sentence the crawler reads and the
 * sentence in the sheet are the same decision rather than two that agree
 * today. They have disagreed before: the hedge was written into DetailSheet
 * after the Toxic report and never into the prerendered page, which is to say
 * fixed on the surface with the fewest readers.
 */

/** Only the fields the rule reads, so either half can pass its own row type. */
export interface PlatformClaimRow {
  platforms?: string[];
  namedBy?: string;
  releaseDate?: string;
}

export declare function suppliers<T extends PlatformClaimRow>(rows: (T | null | undefined)[]): T[];
export declare function onlyGuessed(rows: (PlatformClaimRow | null | undefined)[]): boolean;
export declare function stated(
  row: PlatformClaimRow | null | undefined,
  today: string,
): boolean;
