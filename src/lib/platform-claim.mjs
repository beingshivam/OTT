/**
 * Whether a page may say "streaming now", or only "expected".
 *
 * `namedBy` marks a platform taken from free text — a release note, a
 * production company, a broadcaster — rather than from a TMDB watch
 * provider. The distinction has mattered since Toxic was badged ZEE5 on the
 * day a contributor's note claimed, with no provider behind it at all.
 *
 * It lives here because the first version of the rule lived in build-seo and
 * the grader rewrote it from scratch, and the two disagreed within the hour:
 * eval looked up one row per slug and found the `~ott` sibling, which is
 * guessed, while the page had correctly used the base row, which is not. It
 * reported eight correct pages as faults. One definition, imported, is the
 * only thing that has ever stopped that happening here.
 *
 * A title's claim rests on every row that supplies it a service — the cinema
 * row and its arrived streaming sibling both can. One confirmed provider
 * among them is enough: a real provider is evidence, and a weaker second
 * source beside it does not take that away. Only when every supplier is a
 * guess does the page have to soften what it says.
 */

const services = (row) => (row?.platforms ?? []).filter((p) => p !== 'theatres');

/** The rows that actually give this title a streaming service. */
export const suppliers = (rows) => rows.filter((r) => r && services(r).length);

/** True when nothing better than free text puts this title on a service. */
export function onlyGuessed(rows) {
  const supplying = suppliers(rows);
  return supplying.length > 0 && supplying.every((r) => Boolean(r.namedBy));
}

/**
 * And whether a guess may be stated rather than hedged.
 *
 * Reported: "Gajab Raat is already on Netflix, still you're saying OTT release
 * date not confirmed." It was on Netflix. The row's platform came from a
 * release note, the note's date was that morning, and both the page and the
 * sheet answered "announced, not yet confirmed by the platform" on the one day
 * the reader could see for themselves that it was there.
 *
 * A note about next month is a claim nobody can check; a note whose date has
 * arrived is a claim that has come due. The record on the second kind is good —
 * of 180 guessed rows measured, 33 were later confirmed by a provider and all
 * 33 agreed, none wrong — so once the date is here the honest thing is to say
 * where the film is and say where that came from, rather than to deny it and
 * be wrong in front of somebody holding the evidence.
 *
 * `today` is passed in rather than read, so the page build, the grader and the
 * sheet can all be asked about the same day.
 */
export const stated = (row, today) =>
  Boolean(row?.namedBy) && Boolean(row?.releaseDate) && row.releaseDate <= today;
