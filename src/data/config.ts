/**
 * The two things that need an account somewhere else.
 *
 * Both are optional and both fail quiet: leave a value empty and the feature it
 * powers simply does not render. Nothing here is a secret — the analytics token
 * is designed to be public and the form endpoint is a URL anyone can see in the
 * page source — so this file is safe to commit. Real credentials still belong in
 * .env and GitHub secrets, and none are needed for either of these.
 */

/**
 * Cloudflare Web Analytics.
 *
 * Dashboard → Analytics & Logs → Web Analytics → Add a site. Paste the token
 * from the snippet it gives you (the value of `data-cf-beacon`), not the whole
 * script tag.
 *
 * Chosen over Google Analytics deliberately: it sets no cookies and stores no
 * personal data, so it needs no consent banner and does not undo the "no login,
 * nothing" promise the rest of the product makes. It is also free and already
 * on the platform this deploys to.
 *
 * LEAVE THIS EMPTY while the domain is proxied through Cloudflare.
 *
 * Cloudflare turns Web Analytics on by itself for a proxied zone and injects the
 * beacon at the edge — which is what is already running on newonott.in. Setting
 * a token here adds a *second* beacon on top of that one, and every visit gets
 * counted twice. The measurements then look like growth and are an artefact.
 *
 * This exists for the case where the site is served from somewhere Cloudflare
 * does not proxy, where nothing is injected and the beacon has to ship in the
 * page itself.
 */
export const ANALYTICS_TOKEN = '';

/**
 * Where the email sign-up posts.
 *
 * Set this to '/api/subscribe' — our own Worker route, which writes one row to
 * a Cloudflare D1 table. Relative on purpose: same origin means no CORS
 * preflight and nothing to change if the domain moves.
 *
 * This was meant to be a hosted form service, and the plan did not survive
 * their pricing pages — what is left of the free tiers is a hundred-subscriber
 * ceiling, a monthly submission cap, or a trial. Owning the list means owning
 * deletion requests and the duty not to leak it, which is a real cost; it buys
 * a list that cannot be repriced out from under a product with no revenue.
 * docs/email-setup.md has the setup and the obligations.
 *
 * A full URL still works if a hosted service is ever chosen instead — the form
 * posts { email, email_address } so it fits whichever field name that service
 * reads.
 *
 * Leave it empty until the D1 database is bound (step 3 of the doc). Empty
 * hides both forms; set-but-unbound makes the endpoint answer 503, which the
 * form surfaces as an error rather than a false thank-you.
 */
export const EMAIL_ENDPOINT = '';
