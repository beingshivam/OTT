/**
 * Release weeks run Friday → Thursday, which is how the industry actually
 * schedules drops (and how the WhatsApp-forward calendars everyone already
 * reads are laid out). A week's id is the ISO date of its Friday.
 */

const DAY_MS = 86_400_000;

export function toISODate(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
    d.getUTCDate(),
  ).padStart(2, '0')}`;
}

export function parseISODate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** The Friday on or before `date`. */
export function weekStartFor(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  // getUTCDay(): Sun=0 … Fri=5. Days to walk back to the most recent Friday.
  const back = (d.getUTCDay() + 2) % 7;
  return new Date(d.getTime() - back * DAY_MS);
}

export function weekIdFor(date: Date): string {
  return toISODate(weekStartFor(date));
}

export function addDays(iso: string, days: number): string {
  return toISODate(new Date(parseISODate(iso).getTime() + days * DAY_MS));
}

export function weekEndFor(weekId: string): string {
  return addDays(weekId, 6);
}

/** Every date in the week, Friday first. */
export function daysOfWeek(weekId: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekId, i));
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function formatDay(iso: string): { weekday: string; day: string; month: string } {
  const d = parseISODate(iso);
  return {
    weekday: WEEKDAYS[d.getUTCDay()],
    day: String(d.getUTCDate()).padStart(2, '0'),
    month: MONTHS[d.getUTCMonth()],
  };
}

/** "4 – 10 Sep 2026", collapsing the month when both ends share it. */
export function formatWeekRange(weekId: string): string {
  const a = parseISODate(weekId);
  const b = parseISODate(weekEndFor(weekId));
  const sameMonth = a.getUTCMonth() === b.getUTCMonth();
  const left = sameMonth
    ? String(a.getUTCDate())
    : `${a.getUTCDate()} ${MONTHS[a.getUTCMonth()]}`;
  return `${left} – ${b.getUTCDate()} ${MONTHS[b.getUTCMonth()]} ${b.getUTCFullYear()}`;
}

export function relativeWeekLabel(weekId: string, today = new Date()): string {
  const current = weekIdFor(today);
  const diff = Math.round((parseISODate(weekId).getTime() - parseISODate(current).getTime()) / (7 * DAY_MS));
  if (diff === 0) return 'This week';
  if (diff === 1) return 'Next week';
  if (diff === -1) return 'Last week';
  return diff > 0 ? `In ${diff} weeks` : `${Math.abs(diff)} weeks ago`;
}

export function isToday(iso: string, today = new Date()): boolean {
  return iso === toISODate(today);
}
