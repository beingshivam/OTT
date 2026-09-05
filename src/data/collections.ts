/**
 * Groups of languages that people actually search for as one thing.
 *
 * The per-language pages already exist, and they are the right unit for
 * someone who wants Malayalam specifically. But a large part of the audience
 * does not think in single languages any more — "south movies on OTT" is one
 * of the queries Indian entertainment search is actually made of, and no
 * per-language page answers it.
 *
 * Deliberately a table rather than a hardcoded /south, so the next one — Korean
 * and Japanese as one page, say, or the Hindi belt — is a row here and nothing
 * else. The build generates a page per row, the router resolves the slug, and
 * the browse links list them.
 *
 * A note on what these are not: grouping four distinct film industries under
 * one heading is a simplification, and a Malayalam viewer is entitled to find
 * it crude. The per-language pages remain the honest unit and stay linked from
 * here; this is an entry point for how people search, not a claim that the four
 * are interchangeable.
 */

export interface Collection {
  /** URL slug, and the page's path. */
  slug: string;
  /** Heading on the page, and the h1. */
  label: string;
  /** Languages it gathers. Matched as "any of", the same as the language filter. */
  languages: string[];
  /** <title>, written for the query it is meant to answer. */
  title: string;
  /** Meta description; {n} is replaced with the live title count. */
  description: string;
}

export const COLLECTIONS: Collection[] = [
  {
    slug: 'south',
    label: 'South Indian releases',
    languages: ['ta', 'te', 'ml', 'kn'],
    /**
     * Not "Best of South", which was the first name for this page.
     *
     * "Best of" is a promise of curation, and this lists everything — with
     * four titles rated 7 or above across eight weeks, a literal best-of would
     * be four rows and an apology. The page ranks by what people are actually
     * talking about and surfaces the best-rated title as one fact among
     * several, which is a claim the data supports.
     */
    title: 'New South Indian movies and shows — Tamil, Telugu, Malayalam, Kannada',
    description:
      'Every new South Indian release — {n} Tamil, Telugu, Malayalam and Kannada films and series across streaming platforms and cinemas. Updated every Friday. No app, no login.',
  },
];

export const collectionBySlug = (slug: string): Collection | undefined =>
  COLLECTIONS.find((c) => c.slug === slug);
