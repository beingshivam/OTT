/**
 * Outbound links, wrapped for affiliate credit where a programme exists.
 *
 * The site's whole job is to end with someone leaving for the place a title
 * actually plays, so the outbound click is the only moment it is ever paid for
 * anything. This is the one place that knows how to earn on it.
 *
 * What is worth knowing before touching this:
 *
 * Cinema is the half that pays. A ticket is a ₹300 transaction one click away,
 * and BookMyShow pays on completed bookings. A streaming click is not a
 * purchase — most people already have the subscription, Netflix runs no
 * affiliate programme anywhere in the world, and Prime Video pays ₹3.15 a sale
 * through Cuelinks. So the ordering of effort is: cinemas first, Prime second,
 * everything else not at all.
 *
 * Nobody should expect rent from this. At ten thousand visitors a month it is
 * a few hundred rupees. It is here because it costs nothing to run once built
 * and it compounds with traffic, not because it is a business.
 *
 * ── How to switch it on ──────────────────────────────────────────────────
 * Sign up with a network (Cuelinks and INRDeals both carry BookMyShow and
 * pre-approve publishers), then paste the deep-link template they give you
 * into `template` below. Nothing else in the codebase changes. Until a
 * template is filled in, every link stays exactly as it is today — a wrong or
 * guessed template would send readers to a broken redirect, which costs far
 * more than the few rupees it would earn, so an empty one is left alone.
 *
 * The template is whatever the network's dashboard shows, with the
 * destination as `{url}`. It is substituted URL-encoded, e.g.
 *   'https://linksredirect.com/?cid=00000&source=linkkit&url={url}'
 *
 * These IDs are not secrets. They travel in the href of every outbound link
 * and are visible to anyone reading the page, which is why they live in the
 * repo rather than in an environment variable.
 */

export interface AffiliateProgram {
  /**
   * The network's deep-link template, with `{url}` where the destination
   * goes. Empty means not enrolled — the link is left untouched.
   */
  template: string;
  /** Named in the disclosure, so the reader can see who is paying. */
  network: string;
}

/**
 * Keyed by platform id (see platforms.ts). Only platforms that actually run a
 * programme belong here; a key with an empty template is a note that one
 * exists and has not been signed up for yet, which is different from a
 * platform that has none at all.
 */
export const AFFILIATES: Record<string, AffiliateProgram> = {
  // Ticket bookings — the highest-intent click on the site, and the only one
  // attached to a real purchase. ~₹7–10 a sale.
  theatres: { template: '', network: 'BookMyShow' },
  // Subscription sign-ups. Pays ₹3.15 and only for someone who does not
  // already subscribe, which is most of the audience.
  prime: { template: '', network: 'Amazon' },
  // Deliberately absent: Netflix (no programme exists), JioHotstar, ZEE5,
  // SonyLIV, Apple TV+ and the rest. Adding a key here without a real
  // programme behind it would be a redirect that earns nothing and can break.
};

export interface OutboundLink {
  href: string;
  /**
   * True when the href earns money. Drives rel="sponsored", which Google
   * requires on paid links — an affiliate link passing plain link equity is
   * a manual-action risk, and this site's traffic is mostly search.
   */
  sponsored: boolean;
}

/**
 * The destination for a platform, wrapped if there is anything to wrap with.
 *
 * Returns the URL unchanged when the platform has no programme or has not been
 * enrolled yet, so this is safe to call on every outbound link on the site.
 */
export function outbound(platformId: string, url: string): OutboundLink {
  const program = AFFILIATES[platformId];
  if (!program?.template) return { href: url, sponsored: false };
  return {
    href: program.template.replace('{url}', encodeURIComponent(url)),
    sponsored: true,
  };
}

/** Whether any programme is live, so the disclosure can stay off the page
 *  until there is actually something to disclose. */
export const hasAffiliates = Object.values(AFFILIATES).some((p) => p.template !== '');

/** The networks currently paying, for the disclosure line. */
export const affiliateNetworks = [
  ...new Set(Object.values(AFFILIATES).filter((p) => p.template).map((p) => p.network)),
];
