import type { Release } from '../types';

/**
 * Ordering a mixed-language list without letting one language win.
 *
 * This is the rule the whole site rests on, and it exists because the numbers
 * lie across languages. TMDB's vote counts and popularity scores track how many
 * people in TMDB's audience have logged a title, and that audience is far
 * denser for English than for Malayalam — so sorting a mixed list by any of
 * those measures is, in practice, sorting by how American a title is. A "best
 * rated" row built that way came out as Avatar, Breaking Bad and Swapped on a
 * page about Indian streaming.
 *
 * So a title is only ever ranked against others in its own language, and the
 * rows are interleaved: every language's best, then every language's second,
 * and so on. Larger languages go first within each round, so a language holding
 * a single title cannot open the row on the strength of having nothing to
 * compare against.
 *
 * Lifted out of PageIntro when a second caller appeared. One implementation, so
 * the two places that rank cannot drift apart — which is exactly how the "best
 * rated" row went wrong in the first place.
 *
 * @param rows    the candidates, already filtered to what belongs in the list
 * @param better  sorts within one language; negative means `a` comes first
 */
export function interleaveByLanguage(
  rows: Release[],
  better: (a: Release, b: Release) => number,
  /**
   * Which language gets the first slot.
   *
   * 'count' — the language with the most rows leads. Right when the job is to
   * spread one day's releases fairly: the biggest group is the one most at risk
   * of being cut off by the cap, so it goes first.
   *
   * 'best' — the language whose best row is best leads. Right when the output
   * is a shortlist rather than a spread, because there 'count' answers the
   * wrong question entirely: on 11 Sep, Tamil had the most cinema listings and
   * so took first place with a heat-33 film, ahead of a heat-95 one. Nobody
   * asking what is big right now means "whichever language has the most films
   * out".
   */
  order: 'count' | 'best' = 'count',
): Release[] {
  const byLang = new Map<string, Release[]>();
  for (const r of rows) {
    // The first language is the original one on every row the feed builds, so
    // a Malayalam film dubbed into Hindi ranks as Malayalam.
    const code = r.languages?.[0];
    if (!code) continue;
    if (!byLang.has(code)) byLang.set(code, []);
    byLang.get(code)!.push(r);
  }

  const queues = [...byLang.values()].map((list) => [...list].sort(better));
  // Each queue is already sorted, so its head is that language's best.
  queues.sort((a, b) => (order === 'best' ? better(a[0], b[0]) : b.length - a.length));

  const out: Release[] = [];
  for (let depth = 0; out.length < rows.length; depth++) {
    let took = false;
    for (const q of queues) {
      if (q[depth]) {
        out.push(q[depth]);
        took = true;
      }
    }
    if (!took) break;
  }
  return out;
}
