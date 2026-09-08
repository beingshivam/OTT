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

/**
 * TMDB artwork, re-served from our own origin.
 *
 * The share card draws posters onto a canvas, and a canvas that has drawn a
 * cross-origin image cannot be read back unless the server said it could.
 * image.tmdb.org does not: proved by simulating both policies against a real
 * Chromium — with the header the poster draws in every cache state, without it
 * the load fails every time, and no client-side trick changes that. The picture
 * came out as coloured gradients on the live site, which is the fallback doing
 * its job and not the design anybody wanted.
 *
 * So the bytes come through here instead, which makes them same-origin and the
 * question moot. Only the share card uses this — the posters on the page are
 * plain <img> tags that never touch a canvas and have no reason to pay for a
 * hop.
 *
 * Narrow on purpose. An open proxy is somebody else's bandwidth bill and a way
 * into networks that trust this origin, so the path has to look exactly like a
 * TMDB image path and nothing else is forwarded: no query string, no client
 * headers, no cookies, no methods but GET and HEAD.
 */
const TMDB_IMAGE = /^\/img\/(w\d{2,4}|original)\/([A-Za-z0-9_-]{8,64}\.(?:jpg|png|webp|svg))$/;

async function proxyPoster(request, url) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return json(405, { error: 'method_not_allowed' });
  }
  const match = url.pathname.match(TMDB_IMAGE);
  if (!match) return json(404, { error: 'not_an_image_path' });

  const [, size, file] = match;
  const upstream = await fetch(`https://image.tmdb.org/t/p/${size}/${file}`, {
    method: request.method,
    // Cloudflare caches this at the edge, so a popular poster is fetched from
    // TMDB once rather than once per person who shares the week.
    cf: { cacheEverything: true, cacheTtl: 86_400 },
  });

  if (!upstream.ok) return json(upstream.status === 404 ? 404 : 502, { error: 'upstream' });

  const headers = new Headers();
  headers.set('content-type', upstream.headers.get('content-type') ?? 'image/jpeg');
  // TMDB paths are content-addressed: the same path is always the same image.
  headers.set('cache-control', 'public, max-age=31536000, immutable');
  return new Response(upstream.body, { status: 200, headers });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    /**
     * Assets first, and by a wide margin. run_worker_first is on so that
     * /api/subscribe can exist at all, which means page loads pass through
     * here too — so this branch is the hot path and does exactly one string
     * comparison before handing off. env.ASSETS.fetch applies the SPA
     * fallback from wrangler.jsonc, so unknown paths still serve the board.
     */
    if (url.pathname.startsWith('/img/')) return proxyPoster(request, url);

    /**
     * One casing per page — but page paths only, because anything with a file
     * extension keeps its capitals.
     *
     * The first version of this redirected on capitals alone and took the
     * whole site down for the length of one deploy: Vite's hashed bundles are
     * named like index-CqG28YpW.js, so every asset 301'd to a lowercase path
     * that does not exist, fell through to the SPA fallback, and arrived at
     * the browser as index.html with a JavaScript content type. The page then
     * rendered its prerendered shell with no styling and no behaviour.
     *
     * A published page path never has a dot in it — platform ids, language
     * names, slugs, /w/<iso-date> — and every dotted path is a file whose name
     * is somebody else's to choose: bundles, /build.txt, /sitemap.xml, posters.
     * So the extension is the test, not the casing.
     */
    if (/[A-Z]/.test(url.pathname) && !/\.[a-z0-9]+$/i.test(url.pathname)) {
      url.pathname = url.pathname.toLowerCase();
      return Response.redirect(url.toString(), 301);
    }

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

    /**
     * The welcome mail, deliberately after the response is decided.
     *
     * waitUntil rather than await: the address is the durable thing and the
     * email is best-effort, so a slow Brevo must not hold the form open and a
     * dead one must not turn a stored subscription into a visible failure. The
     * reader has done their part the moment the row exists.
     */
    // Optional-chained: the row is already written, and a runtime that hands
    // us no ctx must not turn a successful subscription into a 500.
    ctx?.waitUntil?.(sendWelcome(env, address));
    return json(200, { ok: true });
  },
};

/** Where the mail comes from. A verified sender on the site's own domain —
 *  Brevo will refuse anything else, and so will most inboxes. */
const SENDER = { name: 'New on OTT', email: 'mail@newonott.in' };

/**
 * Send the current week's digest to somebody who has just subscribed.
 *
 * Someone who signs up on a Tuesday and hears nothing until Friday has, by
 * Friday, forgotten doing it. This closes that gap with the email they signed
 * up for rather than a separate "thanks for subscribing" that says nothing —
 * the first message proves what the subscription is worth.
 *
 * The body is the same file the build ships to /email/, rebuilt by every
 * refresh, so there is no second template to keep in step with the first.
 *
 * Every failure here is swallowed on purpose. This runs after the subscriber
 * has been told they are subscribed, and they have been: the row is written.
 * Throwing would only produce an unhandled rejection in a context nobody
 * reads, so failures are logged and dropped.
 */
async function sendWelcome(env, address) {
  if (!env.BREVO_API_KEY) return; // Not configured — a signup still succeeds.
  try {
    const [html, text, subject] = await Promise.all(
      ['latest.html', 'latest.txt', 'subject.txt'].map((f) =>
        env.ASSETS.fetch(new Request(`https://newonott.in/email/${f}`)).then((r) =>
          r.ok ? r.text() : null,
        ),
      ),
    );
    // No digest built into this deploy: skip rather than send an empty mail.
    if (!html || html.length < 10) return;

    /**
     * The unsubscribe token in the template is meant for a provider that
     * substitutes its own link. Brevo does not do that for transactional
     * sends, so shipping it literally would print "{{ unsubscribe }}" in
     * somebody's inbox — worse than having no unsubscribe at all.
     */
    const optOut = 'Don\u2019t want these? Reply with "stop" and you are off the list.';
    const body = {
      sender: SENDER,
      to: [{ email: address }],
      subject: (subject ?? 'New on OTT — this week').trim(),
      htmlContent: html.replace(/\{\{\s*unsubscribe\s*\}\}/g, optOut),
      textContent: (text ?? '').replace(/\{\{\s*unsubscribe\s*\}\}/g, optOut) || undefined,
      /**
       * Gives Gmail and Outlook a real unsubscribe control of their own. A
       * mailto rather than a URL because there is no unsubscribe endpoint yet
       * — this is honest about what exists, and an inbox-level unsubscribe
       * button is worth more than a link nobody scrolls to.
       */
      headers: { 'List-Unsubscribe': `<mailto:${SENDER.email}?subject=unsubscribe>` },
    };

    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'api-key': env.BREVO_API_KEY,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) console.error('welcome: brevo refused', res.status, await res.text());
  } catch (err) {
    console.error('welcome: send failed', err);
  }
}
