/**
 * What a change reads like, in one place.
 *
 * Plain JavaScript rather than TypeScript, and that is the whole point of the
 * file. Every other page on this site is rendered twice — once by
 * scripts/build-seo.mjs for the crawler and the first paint, once by a React
 * component for the reader — and the two copies drift. That is not a
 * hypothetical: the gate spent a Friday failing because build-seo learned to
 * write "Streaming on Netflix from 18 Sep" while a check next door still
 * looked for "Streaming from". A `.mjs` file is importable by the Node build
 * and by Vite, so this sentence exists once and both callers get the same one.
 *
 * Platform names are passed in rather than imported. The registry is TypeScript
 * and build-seo parses it with a regex; asking each caller for the lookup it
 * already has keeps this file free of both.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "3 Oct", with the year only once it stops being obvious. */
export function shortDate(iso, today = new Date()) {
  const d = new Date(`${iso}T00:00:00Z`);
  const year = d.getUTCFullYear() === today.getUTCFullYear() ? '' : ` ${d.getUTCFullYear()}`;
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}${year}`;
}

const list = (names) =>
  names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;

/**
 * The sentence, and the one rule it follows: say only what the archive knows.
 *
 * The temptation on a page like this is to write news — "left cinemas after six
 * weeks", "the wait is nearly over" — and the data cannot carry it. A row
 * leaving the feed is the eight-week window moving, not a film ending its run,
 * and nothing here can tell those apart. Every line below is a difference
 * between two consecutive archives and nothing more.
 */
export function phrase(e, pname = (id) => id) {
  const names = (e.platforms ?? []).map(pname);
  switch (e.kind) {
    case 'dated':
      /* The event this site exists to catch: a film that was only in cinemas
         now has a streaming date. The wait in days is the part people actually
         repeat to each other. */
      return (
        `Got a ${list(names)} date — ${shortDate(e.date)}` +
        (e.afterDays != null ? `, ${e.afterDays} days after its cinema release` : '')
      );
    case 'platform':
      return `Now on ${list(names)}`;
    case 'moved':
      /* Forward or back, named. "Moved" alone makes a reader do the date
         comparison themselves, and the direction is the whole news. */
      return e.to > e.from
        ? `Pushed back to ${shortDate(e.to)}, from ${shortDate(e.from)}`
        : `Brought forward to ${shortDate(e.to)}, from ${shortDate(e.from)}`;
    case 'added':
    default: {
      const where = names.length ? list(names) : 'cinemas';
      return `Added to the calendar — ${where}, ${shortDate(e.date)}`;
    }
  }
}

/** The icon a kind wears. Kept beside the sentence so a new kind cannot be
 *  added in one place and forgotten in the other. */
export const GLYPH = { dated: '📅', platform: '🍿', moved: '↔', added: '✨' };

/**
 * Days, newest first, each with its events.
 *
 * Grouped here rather than in the component because the prerendered page needs
 * exactly the same grouping, and a day boundary is the sort of thing two
 * implementations quietly disagree about.
 */
export function byDay(events, limitDays = 30) {
  const days = new Map();
  for (const e of events) {
    if (!days.has(e.at)) days.set(e.at, []);
    days.get(e.at).push(e);
  }
  return [...days.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, limitDays)
    .map(([at, list]) => ({ at, events: list }));
}

/** "Today", "Yesterday", then the date. A relative label is faster to read and
 *  stops being useful after about a day, which is where this stops using it. */
export function dayLabel(iso, today = new Date()) {
  const days = Math.round(
    (Date.parse(`${today.toISOString().slice(0, 10)}T00:00:00Z`) - Date.parse(`${iso}T00:00:00Z`)) /
      86400000,
  );
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return shortDate(iso, today);
}
