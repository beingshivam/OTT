/**
 * The brand, in one place.
 *
 * The site has been renamed twice, and each time the name was scattered across
 * the header, the share card, the calendar file, the manifest, the OG image and
 * the SEO pass — so each time something was missed and shipped stale. The build
 * scripts read these same values out of this file (scripts/brand.mjs) and
 * rewrite the shipped title and manifest from them, so a rename means editing
 * this file, then `npm run og` to re-render the social card.
 *
 * The Worker keeps its own name in wrangler.jsonc and does not follow this.
 * Cloudflare cannot rename a Worker — a new name creates a second one and
 * orphans the deployment — and with a custom domain attached the Worker's name
 * is never seen by anyone anyway.
 *
 * index.html keeps a literal title for `npm run dev` only; the build overwrites
 * it, so it never reaches a visitor.
 */

export const BRAND = 'New on OTT';

/**
 * The same name where a space would be wrong: downloaded filenames, the
 * single-file build's output, anywhere a slug reads better than a sentence.
 * Kept beside the name it comes from rather than derived, so renaming means
 * editing one file and reading both values off it.
 */
export const SLUG = 'newonott';

/**
 * The Instagram handle, and only the handle.
 *
 * The URL it came from was a QR share link carrying `igsi` and `utm_source=qr`
 * — parameters that identify the share that produced it, not the account. Left
 * in, every visitor to the site would have been attributed to a QR scan that
 * never happened, and the tracking on Instagram's own side would be wrong for
 * as long as the link sat in the footer.
 *
 * Stored as the handle rather than a URL so the link, the JSON-LD `sameAs` and
 * anywhere a caption wants to print "@newon_ott" all build from one string and
 * cannot drift apart.
 */
export const INSTAGRAM = 'newon_ott';
export const INSTAGRAM_URL = `https://www.instagram.com/${INSTAGRAM}/`;

export const TAGLINE = 'every new release, every platform, one page.';

export const HEADLINE = 'everything new, everywhere, this week';
