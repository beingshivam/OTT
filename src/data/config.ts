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
 * Any hosted form endpoint that accepts a JSON POST works — Buttondown,
 * ConvertKit, Formspree, a Google Form. Paste the full URL. There is
 * deliberately no backend of our own here: storing other people's email
 * addresses means owning deletion requests, breach duty and a database, and a
 * weekly newsletter does not justify any of that yet.
 *
 * The field is posted as { email: "..." }.
 */
export const EMAIL_ENDPOINT = '';
