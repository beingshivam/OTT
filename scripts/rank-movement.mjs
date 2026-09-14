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
 *
 * ---------------------------------------------------------------------------
 * Measured on 14 September, and the answer is that this must not be rendered
 *
 * The baseline now works. The movement it measures still means nothing, and the
 * reason is not the window — it is that rank distance has no resolution here.
 *
 * Median popularity gap between adjacent ranks, on the 12 September catalogue:
 *
 *     Bengali    0.1        Hindi     0.4
 *     Tamil      0.4        English   5.2
 *
 * TMDB popularity wobbles by more than that on its own, overnight, for titles
 * nobody has watched or talked about. At a 0.4 gap a two-point drift moves a
 * Hindi title five places; at Bengali's 0.1 it reshuffles the list. So the
 * ranks are packed tighter than the noise floor of the number they are sorted
 * by, and a "+5 this week" arrow reports a rounding artefact in a chip that
 * claims to report an audience.
 *
 * The distribution says the same thing from the other side: 306 of 380 ranked
 * titles moved (81%), median absolute movement 3. A ranking where four titles
 * in five move every measurement is not a leaderboard with some churn in it.
 *
 * A threshold does not rescue it. Keeping only |movement| >= 10 leaves 14% of
 * the list, but ten ranks in Bengali is a one-point popularity change — the
 * same noise, filtered to look decisive.
 *
 * Two further defects, recorded because they would matter if a signal ever did
 * justify shipping, and neither is the blocker:
 *
 *   - The catalogue refreshes only on Monday (the dow gate in
 *     refresh-releases.yml), so the nearest sample to any Friday is the
 *     previous Monday. "Since the Friday" cannot be measured at all; in steady
 *     state this reads Monday to Monday, three days out of phase with the week
 *     the rest of the site draws.
 *   - The current baseline is dirtier still. It was seeded on 11 September from
 *     the run before it, and that run was 7 September, because the catalogue
 *     step had been silently skipped for five days by a dead cron gate. So
 *     today's numbers span 4d16h while claiming to start on the 11th.
 *
 * Keep the module. The baseline is correct, cheap, and already carried in the
 * data, so whenever there is a metric worth ranking it is ready. What must not
 * happen is an arrow, a "Trending this week" label, or any rising indicator
 * built on TMDB popularity rank — three separate looks have now reached that
 * conclusion, and this is the one with numbers attached.
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
