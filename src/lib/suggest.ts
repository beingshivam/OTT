import { applyFilters } from './filters';
import { formatWeekRange } from './week';
import { KIND_LABEL, languageName, platform } from '../data/platforms';
import type { Filters, ReleaseFeed } from '../types';

/**
 * When a filter combination finds nothing, "clear filters" is a shrug. The
 * useful answer is the nearest thing that *does* exist — so relax one dimension
 * at a time and report what that would find, and look in the other loaded weeks
 * before concluding there's nothing.
 */

export interface Suggestion {
  label: string;
  count: number;
  /** Filter changes to apply when taken. */
  patch: Partial<Filters>;
}

const DIMENSIONS: {
  key: 'platforms' | 'languages' | 'genres' | 'kinds';
  describe: (values: string[]) => string;
}[] = [
  { key: 'platforms', describe: (v) => v.map((x) => platform(x).short).join(', ') },
  { key: 'languages', describe: (v) => v.map(languageName).join(', ') },
  { key: 'genres', describe: (v) => v.join(', ') },
  { key: 'kinds', describe: (v) => v.map((x) => KIND_LABEL[x] ?? x).join(', ') },
];

export function suggestions(feed: ReleaseFeed | null, filters: Filters): Suggestion[] {
  if (!feed) return [];
  const week = feed.weeks.find((w) => w.id === filters.weekId);
  const out: Suggestion[] = [];

  // 1. Drop one constraint at a time, within this week.
  for (const { key, describe } of DIMENSIONS) {
    const active = filters[key] as string[];
    if (!active.length) continue;
    const relaxed = { ...filters, [key]: [] as string[] };
    const count = week ? applyFilters(week.releases, relaxed).length : 0;
    if (count > 0) {
      out.push({
        label: `Without ${describe(active)} — ${count} ${count === 1 ? 'title' : 'titles'}`,
        count,
        patch: { [key]: [] },
      });
    }
  }

  // 2. Drop the text query, which is the most likely thing to be over-narrow.
  if (filters.query && week) {
    const count = applyFilters(week.releases, { ...filters, query: '' }).length;
    if (count > 0) {
      out.push({
        label: `Without "${filters.query}" — ${count} ${count === 1 ? 'title' : 'titles'}`,
        count,
        patch: { query: '' },
      });
    }
  }

  // 3. Same filters, other weeks. A search that finds nothing this week but two
  //    matches next week should say so rather than claim there's nothing.
  for (const other of feed.weeks) {
    if (other.id === filters.weekId) continue;
    const count = applyFilters(other.releases, { ...filters, weekId: other.id }).length;
    if (count > 0) {
      out.push({
        label: `${count} in ${formatWeekRange(other.id)}`,
        count,
        patch: { weekId: other.id },
      });
    }
  }

  return out.sort((a, b) => b.count - a.count).slice(0, 4);
}
