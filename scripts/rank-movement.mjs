/**
 * Where a title stood when the current release week opened.
 *
 * Split out from fetch-catalogue.mjs for the same reason the OMDb client was:
 * that script needs a TMDB token and a network on import, so nothing inside it
 * can be tested from an environment that has neither — and this is the part
 * where being wrong is invisible. A rank comparison that quietly measures the
 * wrong window still produces plausible arrows; it just points some of them the
 * wrong way, or points them all at nothing.
 *
 * ---------------------------------------------------------------------------
 * Why a weekly baseline and not simply "the previous run"
 *
 * The catalogue refreshes on Friday, Saturday and Monday. So the gap between
 * consecutive runs is 26 hours, then two days, then four — never a week. A
 * label reading "up 14 this week" built on consecutive runs would mean four
 * days on Friday and one day on Saturday, and no reader could know which.
 *
 * It also fails at the other end. The first two runs to carry a rank forward
 * landed 27 minutes apart, and all 380 ranked titles came back unmoved: TMDB
 * popularity does not shift in 27 minutes. Zero movement is not a quiet week,
 * it is a measurement of nothing, and the difference matters because only one
 * of them is a reason to withhold the feature.
 *
 * So the baseline is pinned to the Friday that opens the release week — the
 * same boundary the calendar uses — and held across every run inside that week.
 * Every run then measures from the same starting line, and "this week" means
 * the seven days the rest of the site means by it.
 */

const DAY = 86_400_000;

/**
 * The Friday opening the release week that contains `date`, as an ISO day.
 *
 * Mirrors weekStart in fetch-releases.mjs. Two copies of one rule is a risk
 * worth naming: if the site's week ever stops starting on Friday, both have to
 * move, and the movement labels are the half that would fail silently.
 */
export function weekStart(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  return new Date(d.getTime() - ((d.getUTCDay() + 2) % 7) * DAY).toISOString().slice(0, 10);
}

/**
 * The baseline this run should record for one title.
 *
 * @param prior     {rank, week} the last run stored, or undefined
 * @param lastRank  the title's rank on the last run, or undefined
 * @param thisWeek  ISO day of the Friday opening the current week
 * @returns {baseRank, baseWeek} or null when there is no honest baseline
 *
 * Returning null matters as much as the other branches. A title new to the list
 * has not climbed from the bottom — it was not on the list — and rendering
 * absence as a rise is the specific lie this whole module exists to avoid.
 */
export function baselineFor(prior, lastRank, thisWeek) {
  // Inside the week this baseline was taken for: hold it, so a reader who looks
  // on Monday sees movement measured from the same Friday as one who looked on
  // Saturday.
  if (prior && prior.week === thisWeek) return { baseRank: prior.rank, baseWeek: thisWeek };

  // A new week has opened: where the title finished last week is where it
  // starts this one. Also the seeding path the first time a baseline exists at
  // all, which is why it reads the last run's rank rather than the old
  // baseline — that is the truest "start of this week" available.
  if (lastRank != null) return { baseRank: lastRank, baseWeek: thisWeek };

  return null;
}

/**
 * How far a title has moved since the week opened, or null if unknowable.
 *
 * Positive is a climb, because rank 1 is the top and a smaller number is a
 * better position — the sign is worth stating rather than leaving to whoever
 * writes the arrow.
 */
export function movement(row) {
  if (row.baseRank == null || row.popRank == null) return null;
  return row.baseRank - row.popRank;
}
