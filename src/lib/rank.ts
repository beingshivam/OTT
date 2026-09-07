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
  queues.sort((a, b) => b.length - a.length);

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
