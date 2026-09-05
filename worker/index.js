/**
 * The one thing that runs at request time.
 *
 * Everything else about this site is a file: the release feed is JSON built at
 * deploy time, the board is static markup, and no request touches a database.
 * That was worth protecting, so this Worker does as close to nothing as it can
 * — every path but one is handed straight back to the static assets, and the
 * one exception writes a single row.
 *
 * Why a Worker at all, when a hosted form service is a link and a paste: the
 * free tiers that used to make that true have mostly closed. What remains is
 * either a hundred-subscriber ceiling, a monthly submission cap, or a trial.
 * Cloudflare's free tier already hosts this site, and one D1 row per sign-up is
 * inside it by three orders of magnitude — so the list lives here, and nothing
 * about it can be repriced out from under a product that has no revenue.
 *
 * The trade is real and worth stating: an address someone gives you is theirs,
 * not yours. Storing it here means honouring deletion by hand (see
 * docs/email-setup.md) and keeping the table out of anything public. What it
 * buys is that the list is a table you own and can export in one command,
 * rather than an account that can be closed.
 *
 * Written in JavaScript on purpose. tsconfig only includes src/, so a .ts file
 * here would need @cloudflare/workers-types and a second tsconfig to typecheck
 * — a dependency and a build step for forty lines of request handling.
 */

/** Deliberately permissive. The job is to reject typos and junk, not to
 *  adjudicate RFC 5322 — an over-strict pattern turns away real addresses,
 *  which is a worse failure than storing one that bounces. */
const LOOKS_LIKE_EMAIL = /^[^\s@]+@[^\s@.]+\.[^\s@]{2,}$/;

/** A body larger than this is not a sign-up. Read as text first so an
 *  attacker cannot make us buffer a stream of arbitrary length. */
const MAX_BODY = 2048;

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    /**
     * Assets first, and by a wide margin. run_worker_first is on so that
     * /api/subscribe can exist at all, which means page loads pass through
     * here too — so this branch is the hot path and does exactly one string
     * comparison before handing off. env.ASSETS.fetch applies the SPA
     * fallback from wrangler.jsonc, so unknown paths still serve the board.
     */
    if (url.pathname !== '/api/subscribe') return env.ASSETS.fetch(request);

    if (request.method !== 'POST') {
      return json(405, { error: 'method_not_allowed' });
    }

    /**
     * Same-origin only. The form posts from our own page, so a request
     * carrying somebody else's Origin is either a mistake or somebody using
     * our list as a spam sink. Missing Origin is allowed: curl sends none,
     * and so does a legitimate same-origin form post in some browsers.
     */
    const origin = request.headers.get('origin');
    if (origin && new URL(origin).host !== url.host) {
      return json(403, { error: 'bad_origin' });
    }

    /**
     * No database bound yet means say so, loudly and in the logs, rather
     * than accepting an address and dropping it. The front end keeps its
     * form hidden until EMAIL_ENDPOINT is set, so in practice nobody should
     * ever see this — but a sign-up form that reports success while storing
     * nothing is the exact failure this whole file exists to avoid.
     */
    if (!env.DB) {
      console.error('subscribe: no D1 binding — see docs/email-setup.md');
      return json(503, { error: 'not_configured' });
    }

    let address = '';
    try {
      const raw = await request.text();
      if (raw.length > MAX_BODY) return json(413, { error: 'too_large' });
      const body = JSON.parse(raw);
      // The form sends both names because providers disagree about which one
      // they read; either is fine here.
      address = String(body.email ?? body.email_address ?? '').trim();
    } catch {
      return json(400, { error: 'bad_json' });
    }

    if (!LOOKS_LIKE_EMAIL.test(address) || address.length > 254) {
      return json(400, { error: 'bad_email' });
    }

    /**
     * Lowercased as the key so the same person subscribing twice is one row,
     * and INSERT OR IGNORE so the second attempt is a success rather than a
     * 500. Someone re-subscribing has done nothing wrong and should not be
     * told the form is broken.
     *
     * The original casing is kept alongside it: mail servers are free to
     * treat the local part as case-sensitive, so the address we actually send
     * to should be the one that was typed.
     */
    try {
      await env.DB.prepare(
        `INSERT OR IGNORE INTO subscribers (email, address, created_at, country)
         VALUES (?1, ?2, ?3, ?4)`,
      )
        .bind(
          address.toLowerCase(),
          address,
          new Date().toISOString(),
          request.cf?.country ?? null,
        )
        .run();
    } catch (err) {
      console.error('subscribe: insert failed', err);
      return json(500, { error: 'store_failed' });
    }

    return json(200, { ok: true });
  },
};
