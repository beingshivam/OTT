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
 * The refresh runs Thursday and Monday at 19:30 UTC — Friday and Tuesday
 * ~01:00 IST. Reported in the reader's own timezone rather than either of ours.
 */
export function nextRefresh(now = new Date()): Date {
  const candidates: Date[] = [];
  for (let ahead = 0; ahead <= 7; ahead++) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() + ahead);
    d.setUTCHours(19, 30, 0, 0);
    const day = d.getUTCDay(); // 1 = Monday, 4 = Thursday
    if ((day === 1 || day === 4) && d.getTime() > now.getTime()) candidates.push(d);
  }
  return candidates.sort((a, b) => a.getTime() - b.getTime())[0];
}

export function nextRefreshLabel(now = new Date()): string {
  const next = nextRefresh(now);
  return next.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
}
