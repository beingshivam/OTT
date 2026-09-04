/**
 * How current the calendar is, and when it next updates.
 *
 * A static feed can go stale invisibly. Saying when it was built — and when the
 * next build lands — is what makes the data feel alive rather than uploaded once
 * and forgotten.
 */

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export function relativeTime(iso: string, now = Date.now()): string {
  const delta = now - Date.parse(iso);
  if (!Number.isFinite(delta)) return '';
  if (delta < 2 * MIN) return 'just now';
  if (delta < HOUR) return `${Math.round(delta / MIN)}m ago`;
  if (delta < DAY) return `${Math.round(delta / HOUR)}h ago`;
  const days = Math.round(delta / DAY);
  return days === 1 ? 'yesterday' : `${days}d ago`;
}

/**
 * The refresh schedule, mirroring the cron in
 * .github/workflows/refresh-releases.yml. UTC, because cron is.
 *
 * Everything the reader is told about refreshes derives from this one list. The
 * footer used to carry its own hardcoded "Refreshes Tuesdays & Fridays", which
 * was a third copy of the schedule and true only in India — for a reader in
 * London the same runs land on Monday and Thursday.
 */
const SCHEDULE = [
  { day: 1, hour: 19, minute: 30 }, // Mon 19:30 UTC — Tuesday ~01:00 IST
  { day: 4, hour: 19, minute: 30 }, // Thu 19:30 UTC — Friday ~01:00 IST
];

/** The next runs after `now`, soonest first. */
function upcoming(now: Date): Date[] {
  const out: Date[] = [];
  for (let ahead = 0; ahead <= 7; ahead++) {
    for (const slot of SCHEDULE) {
      const d = new Date(now);
      d.setUTCDate(d.getUTCDate() + ahead);
      d.setUTCHours(slot.hour, slot.minute, 0, 0);
      if (d.getUTCDay() === slot.day && d.getTime() > now.getTime()) out.push(d);
    }
  }
  return out.sort((a, b) => a.getTime() - b.getTime());
}

export function nextRefresh(now = new Date()): Date | undefined {
  return upcoming(now)[0];
}

export function nextRefreshLabel(now = new Date()): string {
  const next = nextRefresh(now);
  return next
    ? next.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })
    : '';
}

/**
 * e.g. "Tuesdays & Fridays" in India, "Mondays & Thursdays" in the UK — the same
 * two runs, named in the reader's own timezone.
 */
export function refreshDaysLabel(now = new Date()): string {
  const names = [
    ...new Set(
      upcoming(now)
        .slice(0, SCHEDULE.length)
        .sort((a, b) => a.getDay() - b.getDay())
        .map((d) => `${d.toLocaleDateString(undefined, { weekday: 'long' })}s`),
    ),
  ];
  return names.length === 2 ? `${names[0]} & ${names[1]}` : names.join(', ');
}
