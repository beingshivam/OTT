/**
 * Cuts of the feed that people search for as one thing.
 *
 * The per-platform and per-language pages are the right unit for someone who
 * wants Netflix, or Malayalam. But a large share of Indian entertainment search
 * does not name either — "new web series this week", "south movies on OTT",
 * "new thriller on netflix" — and no platform or language page answers those.
 *
 * A collection is a filter with a name, a URL and a page. Deliberately a table
 * rather than hardcoded routes, so the next one is a row here and nothing else:
 * the build generates a page per row, the router resolves the slug, and the
 * browse links list them.
 *
 * A note on what these are not. Grouping four distinct film industries under
 * "South", or a whole month of unrelated films under "Thriller", is a
 * simplification, and someone who cares about Malayalam cinema specifically is
 * entitled to find it crude. The per-language and per-platform pages remain the
 * honest unit and stay linked from every collection; these are entry points
 * shaped like the way people search, not claims that the members are
 * interchangeable.
 */

export interface Collection {
  /** URL slug, and the page's path. */
  slug: string;
  /** Heading on the page, and the h1. */
  label: string;
  /** Short form for a chip, where the row heading already says "Collections". */
  chip: string;
  /** <title>, written for the query it is meant to answer. */
  title: string;
  /** Meta description; {n} is replaced with the live title count. */
  description: string;

  /**
   * What it gathers. A row matches if it satisfies every dimension that is set,
   * and any value within one — the same "all of these dimensions, any of these
   * values" the board's own filters use, so a collection can never show
   * something the equivalent filter would hide.
   */
  languages?: string[];
  kinds?: string[];
  genres?: string[];
}

export const COLLECTIONS: Collection[] = [
  {
    slug: 'south',
    label: 'South Indian releases',
    chip: 'South Indian',
    languages: ['ta', 'te', 'ml', 'kn'],
    /**
     * Not "Best of South", which was the first name for this page. "Best of"
     * promises curation and this lists everything — with four titles rated 7 or
     * above across eight weeks, a literal best-of would be four rows and an
     * apology. It ranks by what people are talking about and surfaces the
     * best-rated title as one fact, which is a claim the data supports.
     */
    title: 'New South Indian movies and shows — Tamil, Telugu, Malayalam, Kannada',
    description:
      'Every new South Indian release — {n} Tamil, Telugu, Malayalam and Kannada films and series across streaming platforms and cinemas. Updated every Friday. No app, no login.',
  },
  {
    slug: 'web-series',
    label: 'New web series',
    chip: 'Web series',
    kinds: ['series'],
    title: 'New web series this week — every OTT platform in India',
    description:
      '{n} new web series across Netflix, Prime Video, JioHotstar, SonyLIV, ZEE5 and more. Updated every Friday. No app, no login.',
  },
  {
    slug: 'documentaries',
    label: 'New documentaries',
    chip: 'Documentaries',
    kinds: ['documentary'],
    title: 'New documentaries on OTT in India — every platform',
    description:
      '{n} new documentaries and docuseries across every Indian streaming platform, updated every Friday. No app, no login.',
  },
  {
    slug: 'thriller',
    label: 'New thrillers',
    chip: 'Thriller',
    genres: ['Thriller'],
    title: 'New thriller movies and series on OTT in India',
    description:
      '{n} new thrillers across streaming platforms and cinemas in India, updated every Friday. No app, no login.',
  },
  {
    slug: 'comedy',
    label: 'New comedies',
    chip: 'Comedy',
    genres: ['Comedy'],
    title: 'New comedy movies and series on OTT in India',
    description:
      '{n} new comedies across streaming platforms and cinemas in India, updated every Friday. No app, no login.',
  },
  {
    slug: 'action',
    label: 'New action releases',
    chip: 'Action',
    genres: ['Action'],
    title: 'New action movies and series on OTT in India',
    description:
      '{n} new action films and series across streaming platforms and cinemas in India, updated every Friday.',
  },
  {
    slug: 'romance',
    label: 'New romance releases',
    chip: 'Romance',
    genres: ['Romance'],
    title: 'New romantic movies and series on OTT in India',
    description:
      '{n} new romantic films and series across streaming platforms and cinemas in India, updated every Friday.',
  },
  {
    slug: 'crime',
    label: 'New crime releases',
    chip: 'Crime',
    genres: ['Crime'],
    title: 'New crime movies and series on OTT in India',
    description:
      '{n} new crime films and series across streaming platforms and cinemas in India, updated every Friday.',
  },
  {
    slug: 'horror',
    label: 'New horror releases',
    chip: 'Horror',
    genres: ['Horror'],
    title: 'New horror movies and series on OTT in India',
    description:
      '{n} new horror films and series across streaming platforms and cinemas in India, updated every Friday.',
  },
  {
    slug: 'international',
    label: 'International releases',
    chip: 'International',
    languages: ['ko', 'ja', 'es', 'fr', 'de', 'zh'],
    title: 'New Korean, Japanese and international shows on OTT in India',
    description:
      '{n} new Korean, Japanese, Spanish and other international films and series streaming in India, updated every Friday.',
  },
  /**
   * Deliberately absent, and worth writing down so nobody adds them back:
   *
   *   /movies   143 of 183 rows. A page that is most of the site competes with
   *             the homepage rather than adding to it, and two near-identical
   *             documents is how you lose the better one.
   *   /drama    85 rows, close to half of everything, for the same reason.
   *   /korean   real search demand, five titles. MAX_PAGE_SHARE below would
   *             let it through and MIN_PAGE_ROWS barely would; it is folded
   *             into /international until the supply justifies its own page.
   */
];

export const collectionBySlug = (slug: string): Collection | undefined =>
  COLLECTIONS.find((c) => c.slug === slug);

/**
 * Does a row belong to a collection?
 *
 * Exported so the app, the browse links and the build all decide membership
 * with one function — three copies of this rule would drift, and a link to a
 * page the build skipped lands on the SPA fallback showing the whole week.
 */
export function inCollection(
  c: Collection,
  row: { languages?: string[]; kinds?: string[]; kind?: string; genres?: string[] },
): boolean {
  if (c.languages && !(row.languages ?? []).some((l) => c.languages!.includes(l))) return false;
  if (c.kinds && !c.kinds.includes(row.kind ?? '')) return false;
  if (c.genres && !(row.genres ?? []).some((g) => c.genres!.includes(g))) return false;
  return true;
}
