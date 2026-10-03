/**
 * When a cinema listing and a streaming service can both be true of one film.
 *
 * This exists because the rule had three implementations and all three were
 * wrong in the same way.
 *
 * "Drishyam: The Conclusion" was reported twice. The first report produced a
 * guard in the fetch script and a matching gate in the eval, both testing
 * `releaseDate > today`: a provider on a film that has not opened cannot be a
 * fact, because there is nothing for anyone to stream. That reasoning is
 * sound and it checks a case that never happens — the pass that *attaches*
 * those providers only runs on rows that have already been released. Guard,
 * gate and bug sat in disjoint sets. Everything was green, and the morning
 * after the film opened it wore a Prime badge again.
 *
 * Two copies of a rule are two chances to be wrong once. Three copies of the
 * same wrong rule are worse than none, because the gate reports the builder's
 * blind spot back as a pass. So the rule lives here, is imported by everything
 * that needs it, and anything that disagrees with it now has to disagree out
 * loud.
 */

const DAY = 86_400_000;

/**
 * How long after opening a film is still presumed to be *in* cinemas.
 *
 * TMDB's watch providers carry no date. They answer "is this on a service"
 * and never "since when", so a provider sitting on a cinema row is undated
 * evidence, and the only thing that can date it is the calendar.
 *
 * Three weeks because that is what this site has actually watched happen, not
 * because of anything the trade press says. The first draft of this used four
 * weeks on the strength of the usual claim about Indian distribution contracts
 * — eight weeks the old norm, four the post-2020 short end — and data/windows.json,
 * which exists precisely to measure this, had already recorded two Telugu
 * films reaching Prime in twenty-one days. A number the repo's own
 * observations contradict is not a floor, it is a guess wearing a comment.
 *
 * So: the shortest window this site has ever seen. Above it a provider on a
 * cinema row is plausible and kept; below it the film is still in its run and
 * the provider is describing something else. For the Drishyam franchise that
 * something else is the earlier films, which really are on Prime — the
 * Malayalam Drishyam 3 has been streaming there since May, and the site has
 * that right, in the catalogue, where it belongs.
 *
 * Deliberately a constant and not a figure derived from windows.json at run
 * time. Deriving it would close a loop: a contaminated row becomes a short
 * observation, the short observation lowers the floor, the lower floor admits
 * more contamination. The eval gate watches for an observation below this
 * number instead, which is the same correction without the feedback.
 *
 * A floor is the right shape because being wrong in the two directions costs
 * differently. Suppressing a real platform for a few days costs a reader a
 * badge on a film they can already see in a cinema. Showing a false one costs
 * them a subscription. There is no symmetric choice to make here.
 */
export const THEATRICAL_FLOOR_DAYS = 21;

/** True once a film is old enough to have plausibly left cinemas. */
export function outOfCinemas(releaseDate, today) {
  if (!releaseDate) return false;
  const age = Date.parse(today) - Date.parse(releaseDate);
  return Number.isFinite(age) && age >= THEATRICAL_FLOOR_DAYS * DAY;
}

/**
 * True when a row claims to be in cinemas and on a streaming service at once,
 * close enough to its opening that both cannot be so.
 *
 * Note what this does *not* flag. A future release with no cinema listing
 * keeps its platform — a streaming-only title announced for a date is real and
 * the calendar should carry it. A film well past its run can legitimately be
 * both. Only the contradiction is named.
 */
export function contradicts(row, today) {
  const platforms = row?.platforms ?? [];
  if (!platforms.includes('theatres')) return false;
  if (outOfCinemas(row.releaseDate, today)) return false;
  return platforms.some((p) => p !== 'theatres');
}

/** The row with the impossible claim removed, or the row unchanged. */
export function withoutImpossibleStreaming(row, today) {
  if (!contradicts(row, today)) return row;
  return { ...row, platforms: ['theatres'] };
}
