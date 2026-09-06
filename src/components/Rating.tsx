import type { Release } from '../types';
import { scoreOf, scoreTitle } from '../lib/score';

/**
 * The audience score, shown wherever a title is.
 *
 * The instinct to put a star on every row is right — it is the fastest signal
 * for "is this worth my evening". The risk is what eighteen bright gold stars
 * in one column does to a page whose whole promise is a calm glance: repeated
 * accent colour stops meaning anything, and the titles themselves lose the
 * fight for attention.
 *
 * So every rated title gets the star, and only the ones worth stopping for get
 * the colour. Everything else sits in the same muted grey as the metadata line,
 * present and readable but not competing. A field of grey with three gold marks
 * in it is scannable in a way that a field of gold is not.
 *
 * The second half of "doesn't pain the eye" is the rows with no score at all,
 * which is most of them — nothing has a rating before it comes out. Rendering
 * nothing keeps the slot empty rather than ragged, and because this sits in a
 * fixed-width right-hand column with the day chip, the numbers line up and the
 * gaps are invisible.
 *
 * Which source the number comes from, and whether it is trustworthy enough to
 * colour, is decided in lib/score.ts — the same call the sort and the "best
 * rated" pill make, so a card and the order it sits in cannot disagree.
 */

export function Rating({ release, className = '' }: { release: Release; className?: string }) {
  const score = scoreOf(release);
  if (!score) return null;

  return (
    <span
      className={`rating ${className}`.trim()}
      data-strong={score.strong || undefined}
      // Names the source and what it rests on, so a 9.0 off six votes can be
      // taken for what it is — and so a reader is never left assuming an IMDb
      // number came from TMDB, or the reverse.
      title={scoreTitle(score)}
    >
      <span aria-hidden="true">★</span>
      {score.value.toFixed(1)}
    </span>
  );
}
