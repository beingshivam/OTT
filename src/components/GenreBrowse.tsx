import { useCallback, useEffect, useState } from 'react';
import { PosterArt } from './PosterArt';
import { fetchBrowse, type BrowseHit } from '../lib/browse';

/**
 * The rest of the genre.
 *
 * /action listed 268 titles under a header promising a million, which is a
 * site contradicting itself in one screen. Measuring settled what the honest
 * number is, and it is neither of those: 5,749 action titles are streaming in
 * India right now. The 268 are the ones with a release date in the last eight
 * weeks — the page's whole reason to exist and the part Google indexes. The
 * other 5,481 are the reason somebody typed "action movies" in the first
 * place.
 *
 * So both, in the order they are wanted: what is new, then everything else.
 *
 * Underneath the fold and behind a tap. Nothing here is prerendered or
 * crawled, the first page arrives only when a reader has scrolled to it, and
 * the grid grows twenty at a time rather than pretending to hold five
 * thousand. The dated rows above stay the page's published content; this is a
 * browse, the same way a search result is.
 *
 * It fails quietly. A genre page that works is a genre page with rows on it,
 * and a TMDB outage should cost a reader the extra grid, not the page.
 */
export function GenreBrowse({
  genre,
  label,
  onOpen,
}: {
  /** The collection slug, which is also the genre the route knows. */
  genre: string;
  /** "action", for the sentence. Lowercased by the caller's own copy. */
  label: string;
  /** Where a tile goes. App decides — our page when we have one, the sheet
   *  when we do not — so this cannot drift from what a recommendation does. */
  onOpen: (hit: { id: string; title: string }) => void;
}) {
  const [items, setItems] = useState<BrowseHit[]>([]);
  const [total, setTotal] = useState(0);
  const [filmsOnly, setFilmsOnly] = useState(false);
  const [page, setPage] = useState(0);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'gone'>('idle');

  const load = useCallback(
    async (next: number) => {
      setStatus('loading');
      const body = await fetchBrowse(genre, next);
      if (!body || body.degraded) {
        setStatus('gone');
        return;
      }
      setTotal(body.total);
      setFilmsOnly(body.filmsOnly);
      /* Deduped across pages: TMDB's popularity ordering shifts under
         pagination, so the same film can arrive on page 2 and page 3, and a
         grid that shows it twice reads as a bug rather than as churn. */
      setItems((prev) => {
        const seen = new Set(prev.map((r) => r.id));
        return [...prev, ...body.results.filter((r) => !seen.has(r.id))];
      });
      setPage(next);
      setStatus('ready');
    },
    [genre],
  );

  /* The first page on mount rather than on a tap: a section whose heading is
     a number cannot print the heading until it has asked. */
  useEffect(() => {
    let live = true;
    setItems([]);
    setPage(0);
    fetchBrowse(genre, 1).then((body) => {
      if (!live) return;
      if (!body || body.degraded) {
        setStatus('gone');
        return;
      }
      setItems(body.results);
      setTotal(body.total);
      setFilmsOnly(body.filmsOnly);
      setPage(1);
      setStatus('ready');
    });
    return () => {
      live = false;
    };
  }, [genre]);

  /* Nothing to say yet, or nothing to say at all. Either way the page above is
     unaffected — this section simply is not there. */
  if (status === 'gone' || (status === 'ready' && !items.length)) return null;
  if (!items.length) return null;

  return (
    <section className="genrebrowse shell" aria-labelledby="genrebrowse-heading">
      <h2 className="genrebrowse__title" id="genrebrowse-heading">
        Every {label} title streaming in India
      </h2>
      <p className="genrebrowse__note">
        {/* The count is TMDB's, and it is the honest answer to the question the
            header's "1M+" was being read as. Saying where it comes from costs a
            clause and stops it reading as a boast. */}
        {total.toLocaleString('en-IN')} {filmsOnly ? 'films' : 'titles'} on Netflix, Prime Video,
        JioHotstar, SonyLIV, ZEE5 and the rest — not just this week's releases.
        {filmsOnly && ' Films only: TMDB files series of this kind under other genres.'}
      </p>

      <ul className="genrebrowse__grid">
        {items.map((r) => (
          <li key={r.id}>
            <button type="button" onClick={() => onOpen({ id: r.id, title: r.title })}>
              <PosterArt
                className="genrebrowse__art"
                title={r.title}
                platformId="theatres"
                imageUrl={r.image ?? undefined}
                quiet
              />
              <span className="genrebrowse__name">{r.title}</span>
              <span className="genrebrowse__year">
                {[r.year, r.kind === 'series' ? 'Series' : null].filter(Boolean).join(' · ')}
              </span>
            </button>
          </li>
        ))}
      </ul>

      {/* A button, not an infinite scroll. The footer carries the browse links
          and the email form, and a grid that grows as you approach it means a
          reader can never reach either. */}
      {items.length < total && (
        <button
          className="btn genrebrowse__more"
          onClick={() => load(page + 1)}
          disabled={status === 'loading'}
        >
          {status === 'loading' ? 'Loading…' : `Show more ${label}`}
        </button>
      )}
    </section>
  );
}
