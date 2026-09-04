import type { Release } from '../types';

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
 */

/** Worth drawing the eye to: genuinely well-liked, on enough votes to mean it. */
const STRONG_SCORE = 7.5;
const STRONG_VOTES = 50;

export function Rating({ release, className = '' }: { release: Release; className?: string }) {
  if (release.rating == null) return null;

  const strong = release.rating >= STRONG_SCORE && (release.votes ?? 0) >= STRONG_VOTES;

  return (
    <span
      className={`rating ${className}`.trim()}
      data-strong={strong || undefined}
      // Says where the number came from and what it rests on, so a 9.0 off six
      // votes can be taken for what it is. TMDB, named honestly — it is not
      // IMDb, which polls a different crowd and lands a few tenths elsewhere.
      title={
        release.votes
          ? `${release.rating.toFixed(1)} on TMDB, from ${release.votes.toLocaleString()} vote${
              release.votes === 1 ? '' : 's'
            }`
          : `${release.rating.toFixed(1)} on TMDB`
      }
    >
      <span aria-hidden="true">★</span>
      {release.rating.toFixed(1)}
    </span>
  );
}
