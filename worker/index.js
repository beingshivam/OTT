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

  /**
   * The dead man's switch.
   *
   * The refresh is a GitHub Actions cron, and GitHub's scheduler is best-effort:
   * its own documentation says a scheduled run can be delayed under load and
   * dropped entirely. This repository has seen both — the one scheduled run on
   * record started 2h16m after its slot, and the Friday slot on 11 Sep produced
   * nothing at all.
   *
   * A late refresh is survivable. What is not is that a refresh which never
   * happens looks exactly like one that worked: the site keeps serving, the
   * board keeps rendering, and the only symptom is a date quietly falling
   * behind. The owner found out because a page looked thin, four days later.
   * Monitoring that lives inside the job being monitored cannot report the job
   * not running, which is the one failure that matters here.
   *
   * So the check runs somewhere else entirely. Cloudflare's cron fires this
   * Worker daily, it reads the feed the site is actually serving — not a
   * status page, not a build log, the same JSON a reader gets — and if that
   * feed is older than the last refresh that should have happened, it says so
   * by email. It needs no GitHub token and no third-party service: the sender
   * is already configured for the welcome mail.
   *
   * It cannot fix anything. It exists so that silence stops meaning "fine".
   */
  async scheduled(event, env, ctx) {
    ctx?.waitUntil?.(checkFreshness(env));
  },
};

/**
 * The refresh schedule, mirrored from .github/workflows/refresh-releases.yml.
 *
 * Two statements of one fact, which is a real risk and named here rather than
 * hidden: if the cron there changes and this does not, the watchdog starts
 * alerting on a schedule nobody runs, and an alert that cries wolf is deleted
 * unread — the same silence it was built to end. Kept as UTC weekday/hour/minute
 * because that is exactly how the workflow states them.
 */
const REFRESH_SLOTS = [
  { day: 5, hour: 2, minute: 30 }, // Fri 02:30 UTC — the week flips
  { day: 5, hour: 8, minute: 30 }, // Fri 08:30 UTC — Friday's own OTT drops
  { day: 6, hour: 4, minute: 30 }, // Sat 04:30 UTC — anything that landed late
  { day: 1, hour: 13, minute: 30 }, // Mon 13:30 UTC — the weekend and the week ahead
];

/**
 * How long after a slot a run is still considered merely late.
 *
 * Three hours, from the evidence: the one scheduled run on record was 2h16m
 * late and completed fine. Alerting sooner would page on GitHub being GitHub.
 */
const GRACE_HOURS = 3;

/**
 * The most recent slot that is far enough in the past that a run should have
 * finished by now. Returns a Date, or null if none has come due yet.
 */
export function lastDueSlot(now, graceHours = GRACE_HOURS) {
  const cutoff = now.getTime() - graceHours * 3600_000;
  let best = null;
  // Walk back eight days so the answer is right on a Monday, when the most
  // recent due slot is the previous Saturday's.
  for (let back = 0; back <= 8; back++) {
    const d = new Date(now.getTime() - back * 86_400_000);
    for (const slot of REFRESH_SLOTS) {
      if (d.getUTCDay() !== slot.day) continue;
      const at = Date.UTC(
        d.getUTCFullYear(),
        d.getUTCMonth(),
        d.getUTCDate(),
        slot.hour,
        slot.minute,
      );
      if (at <= cutoff && (best === null || at > best)) best = at;
    }
  }
  return best === null ? null : new Date(best);
}

async function checkFreshness(env) {
  const due = lastDueSlot(new Date());
  if (!due) return; // Nothing has come due yet — nothing to say.

  let generatedAt = null;
  try {
    const res = await env.ASSETS.fetch(new Request('https://newonott.in/data/releases.json'));
    if (res.ok) generatedAt = (await res.json()).generatedAt ?? null;
  } catch (err) {
    console.error('watchdog: could not read the feed', err);
  }

  // A feed the Worker cannot read at all is worse than a stale one, so it
  // alerts rather than returning quietly — the alternative is the exact
  // silence this exists to remove.
  const built = generatedAt ? Date.parse(generatedAt) : NaN;
  if (Number.isFinite(built) && built >= due.getTime()) {
    console.log(`watchdog: feed built ${generatedAt}, after the ${due.toISOString()} slot — ok`);
    return;
  }

  const hours = Number.isFinite(built)
    ? Math.round((Date.now() - built) / 3600_000)
    : null;
  const detail = Number.isFinite(built)
    ? `The feed was last rebuilt ${generatedAt} — ${hours} hours ago.`
    : 'The Worker could not read a build time from the feed at all.';

  console.error(`watchdog: stale. ${detail}`);
  await sendAlert(
    env,
    'New on OTT: the refresh has not run',
    [
      `The refresh that was due at ${due.toISOString()} has not produced a new feed.`,
      '',
      detail,
      '',
      'The site is still up and still serving — this is about the data behind it',
      'going stale, which nothing else would have told you about.',
      '',
      'To fix it now, run the "Refresh release calendar" workflow by hand:',
      'https://github.com/beingshivam/OTT/actions/workflows/refresh-releases.yml',
      '',
      'This check runs once a day from the Cloudflare Worker, deliberately outside',
      'GitHub, so that a refresh which never starts is still able to tell you.',
    ].join('\n'),
  );
}

/** Plain text, to the site's own address. No template and no digest — an alert
 *  that needs a build artefact to render is an alert that fails when the build
 *  is what broke. */
async function sendAlert(env, subject, text) {
  if (!env.BREVO_API_KEY) {
    console.log('watchdog: would have alerted, but no BREVO_API_KEY is bound');
    return;
  }
  const to = env.ALERT_EMAIL || SENDER.email;
  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'api-key': env.BREVO_API_KEY,
      },
      body: JSON.stringify({ sender: SENDER, to: [{ email: to }], subject, textContent: text }),
    });
    if (res.ok) console.log('watchdog: alert sent to', to);
    else console.error('watchdog: brevo refused', res.status, await res.text());
  } catch (err) {
    console.error('watchdog: alert failed', err);
  }
}

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
  /**
   * Every outcome says something, including the quiet ones.
   *
   * The first version logged only failures, so a working send and an
   * unconfigured one were both silent — and "nothing in the log" could not
   * distinguish "it worked" from "it never ran". That is the one thing a log
   * exists to tell you.
   */
  if (!env.BREVO_API_KEY) {
    console.log('welcome: skipped — no BREVO_API_KEY bound to this Worker');
    return;
  }
  try {
    const [html, text, subject] = await Promise.all(
      ['latest.html', 'latest.txt', 'subject.txt'].map((f) =>
        env.ASSETS.fetch(new Request(`https://newonott.in/email/${f}`)).then((r) =>
          r.ok ? r.text() : null,
        ),
      ),
    );
    // No digest built into this deploy: skip rather than send an empty mail.
    if (!html || html.length < 10) {
      console.log('welcome: skipped — no digest at /email/latest.html in this deploy');
      return;
    }

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
    if (res.ok) {
      const { messageId } = await res.json().catch(() => ({}));
      console.log('welcome: sent', address, messageId ?? '(no messageId)');
    } else {
      console.error('welcome: brevo refused', res.status, await res.text());
    }
  } catch (err) {
    console.error('welcome: send failed', err);
  }
}
