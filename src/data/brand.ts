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
 * index.html keeps a literal title for `npm run dev` only; the build overwrites
 * it, so it never reaches a visitor.
 */

export const BRAND = 'dropday';

export const TAGLINE = 'every new release, every platform, one page.';

export const HEADLINE = 'everything new, everywhere, this week';
