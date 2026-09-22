/**
 * Types for changes.mjs, which is plain JavaScript on purpose.
 *
 * The implementation has to be importable by scripts/build-seo.mjs — plain
 * Node, no build step — and by the app, so that the sentence on the
 * prerendered page and the sentence in the React one are the same string
 * rather than two that agree today. This file is how the app's half keeps its
 * types without dragging the Node half into TypeScript.
 */

export interface ChangeEvent {
  at: string;
  kind: string;
  id: string;
  title: string;
  lang?: string;
  platforms?: string[];
  date?: string;
  from?: string;
  to?: string;
  afterDays?: number;
}

export interface ChangeDay {
  at: string;
  events: ChangeEvent[];
}

export declare function shortDate(iso: string, today?: Date): string;
export declare function phrase(e: ChangeEvent, pname?: (id: string) => string): string;
export declare function byDay(events: ChangeEvent[], limitDays?: number): ChangeDay[];
export declare function dayLabel(iso: string, today?: Date): string;
export declare const GLYPH: Record<string, string>;
