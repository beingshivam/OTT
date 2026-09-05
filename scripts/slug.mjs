/**
 * Title → URL slug, in one place.
 *
 * The app has to resolve /ott-release-date/<slug> back to a title, and the
 * build has to write the file at that path. Two implementations of this would
 * drift on the first title with a colon in it, and the failure is silent: the
 * page exists, the link points at it, and the app renders nothing.
 *
 * So there is exactly one implementation — this one — and the build stamps the
 * slug it computed onto each row of the shipped feed. The app reads the field
 * rather than deriving it, which means it cannot disagree even in principle.
 */
export function slugify(title) {
  return (
    String(title)
      .normalize('NFKD')
      // Strip diacritics so "Pathaan" and "Pāthaan" cannot become two pages.
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      // & reads as a word in a URL; dropping it silently would join two words.
      .replace(/&/g, ' and ')
      .replace(/['’]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80)
      .replace(/-+$/, '')
  );
}
