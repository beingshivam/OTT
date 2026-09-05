# The subscriber list

The sign-up form on the site posts to `/api/subscribe`, which is a Worker route
in this repo (`worker/index.js`) that writes one row to a Cloudflare D1
database. No third-party form service is involved.

## Why not a hosted form service

That was the original plan, and it did not survive contact with the pricing
pages. The tiers that made "sign up, paste a URL, done" the obvious answer have
mostly closed: what is left is a hundred-subscriber ceiling, a monthly
submission cap, or a trial that becomes a bill. None of those is a foundation
for a product with no revenue.

Cloudflare already serves this site, and one D1 row per sign-up sits so far
inside the free tier that it will not be the thing that costs money. So the list
lives here.

**The trade, stated plainly:** an address someone hands you is theirs. Holding
it here means honouring deletion by hand, not leaking the table, and not using
it for anything but the weekly email. That is the price of the list not being
repriceable out from under you.

---

## Setup — about ten minutes, all in the dashboard

### 1. Create the database

Cloudflare dashboard → **Storage & Databases → D1 → Create database**.

Name it `newonott-subscribers`. Copy the **Database ID** it shows.

### 2. Create the table

Open the database → **Console**, paste this, run it:

```sql
CREATE TABLE IF NOT EXISTS subscribers (
  email      TEXT PRIMARY KEY,   -- lowercased, so one person is one row
  address    TEXT NOT NULL,      -- as typed; the local part may be case-sensitive
  created_at TEXT NOT NULL,      -- ISO 8601
  country    TEXT                -- from Cloudflare, for knowing where this lands
);
```

### 3. Bind it

In `wrangler.jsonc`, uncomment the `d1_databases` block at the bottom and paste
the id from step 1 into `database_id`. Note the leading comma — the block sits
after `assets`.

It ships commented out on purpose: a binding pointing at a database that does
not exist fails the deploy, and this config deploys the live site.

### 4. Turn the form on

In `src/data/config.ts`:

```ts
export const EMAIL_ENDPOINT = '/api/subscribe';
```

Relative on purpose — same origin, so there is no CORS preflight and nothing to
change if the domain ever moves.

### 5. Push, and test it once

Workers Builds deploys in about twenty seconds. Then subscribe with your own
address on the live site and confirm the row landed:

```sql
SELECT * FROM subscribers;
```

Test on the deployed site, not `npm run dev` — Vite serves the front end only,
so `/api/subscribe` does not exist there and the form will report an error.
`npx wrangler dev` runs both if you want it locally.

---

## Sending the weekly email

`npm run digest` writes `email/subject.txt`, `email/latest.html` and
`email/latest.txt`. Getting the list:

```
npx wrangler d1 execute newonott-subscribers --remote \
  --command "SELECT address FROM subscribers ORDER BY created_at"
```

or the same query in the dashboard console.

**At launch scale, send it from Gmail.** Paste the HTML into a compose window,
put every address in **BCC**, send to yourself in To. It is free, it works, and
at thirty subscribers no amount of infrastructure beats it. Gmail caps a free
account at a few hundred recipients a day; you will know well before you reach
it.

Two things to get right while doing it by hand:

- **BCC, never To or CC.** Putting a subscriber list in a visible header
  publishes every address to every other subscriber. That is a data breach, not
  a formatting mistake.
- **Replace `{{ unsubscribe }}`** in the template. It is a token meant for a
  provider that substitutes its own link, and sending it literally is worse than
  having no unsubscribe at all. Sending by hand, make it a line people can
  actually act on:

  ```
  Don't want these? Reply with "stop" and you're off the list.
  ```

  Then honour it the same day:

  ```sql
  DELETE FROM subscribers WHERE email = 'them@example.com';
  ```

**When hand-sending stops scaling** — somewhere past a hundred or so, or when
you want open rates — move to a sending service. Check its current free tier
yourself before committing; that assumption is what sent this design down the
Worker route in the first place. The collection side does not care either way:
export the table, import the CSV, and nothing in this repo changes.

Whatever you pick, add its SPF and DKIM records first — `docs/dns-setup.md` §2.
A `.in` domain sending unauthenticated mail lands in spam, which quietly wastes
every subscriber the form earns.

---

## Things worth knowing

- **The form fails closed.** With `EMAIL_ENDPOINT` empty, neither the banner nor
  the footer form renders. With it set but no database bound, the endpoint
  answers 503 and the form shows an error rather than a false thank-you.
- **Duplicate sign-ups are a success**, not an error — `INSERT OR IGNORE` on the
  lowercased address. Someone subscribing twice has done nothing wrong and
  should not be told the form is broken.
- **The Worker now runs on every request** (`run_worker_first`), because
  otherwise the SPA fallback would swallow `/api/subscribe`. It does one string
  comparison and hands non-API requests back to the asset server, so the site is
  still static in every way that matters.
- **Deletion is manual.** One `DELETE`, run the day it is asked for. Nobody is
  going to do it for you.
