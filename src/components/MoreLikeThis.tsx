import { useEffect, useState } from 'react';
import { PosterArt } from './PosterArt';
import { fetchCatalogueTitle, type CatalogueTitle } from '../lib/catalogueTitle';

export type SimilarHit = CatalogueTitle['similar'][number];

/**
 * "More like this", wherever a title opens.
 *
 * It started inside the sheet that TMDB-only search results opened, which was
 * the narrowest possible place for it: the one kind of title the site has no
 * page for. Asked for everywhere instead, and rightly — a reader who opens
 * Vivah from the board wants the next thing just as much as one who found it
 * through search, and the row is the only part of either sheet that leads
 * somewhere rather than ending.
 *
 * Presentational on purpose. The catalogue sheet already holds these rows from
 * the call that drew the rest of it, and refetching to render them would cost
 * a second request for data sitting in the component's own state. The detail
 * sheet has no such call, so it uses the hook below.
 */
export function MoreLikeThis({
  items,
  platformId,
  onPick,
}: {
  items: SimilarHit[];
  platformId: string;
  onPick: (hit: SimilarHit) => void;
}) {
  if (!items.length) return null;
  return (
    <div className="sheet__section">
      <h3>More like this</h3>
      <ul className="sheet__more">
        {items.map((s) => (
          <li key={s.id}>
            <button type="button" onClick={() => onPick(s)}>
              <PosterArt
                className="sheet__more-art"
                title={s.title}
                platformId={platformId}
                imageUrl={s.image ?? undefined}
                quiet
              />
              <span className="sheet__more-name">{s.title}</span>
              {s.year && <span className="sheet__more-year">{s.year}</span>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The same row for a title the site does have a page for.
 *
 * Fetched rather than built in, because recommendations are the one field the
 * refresh does not collect — 985 extra TMDB calls a day to prerender a row
 * most readers never scroll to. This asks only when a sheet is actually open,
 * and the edge caches the answer for six hours, so the second reader to open
 * the same film pays nothing.
 *
 * An `m-123~ott` row is the same film as `m-123`: the suffix marks a streaming
 * date, not a different title, and TMDB has never heard of it.
 */
export function useSimilar(id: string | undefined): SimilarHit[] {
  const [items, setItems] = useState<SimilarHit[]>([]);

  useEffect(() => {
    const bare = String(id ?? '').replace(/~[a-z]+$/, '');
    if (!/^[mt]-\d+$/.test(bare)) {
      setItems([]);
      return;
    }
    const ac = new AbortController();
    setItems([]);
    fetchCatalogueTitle(bare, ac.signal).then((state) => {
      if (!ac.signal.aborted && state.status === 'ready') setItems(state.title.similar ?? []);
    });
    return () => ac.abort();
  }, [id]);

  return items;
}
