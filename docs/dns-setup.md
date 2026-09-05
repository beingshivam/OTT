# DNS setup for newonott.in

Everything the domain needs, in the order it has to happen. Written down because
the Cloudflare dashboard suggests records that are either created for you or not
needed yet, and it is easy to add three things that fight each other.

---

## 0. Nameservers — nothing else works until this is done

The zone shows **pending**, and no DNS record you add will do anything while it
does. Pending is not about records; it is Cloudflare waiting for your registrar
to hand the domain over.

1. Cloudflare → `newonott.in` → **Overview**. It names **two** nameservers, e.g.
   `alice.ns.cloudflare.com` and `bob.ns.cloudflare.com`.
2. At **your registrar** (where you bought the domain): `newonott.in` →
   Nameservers → switch from the registrar's defaults to **Custom**, and enter
   both. Replace what is there; do not append.
3. Back on Cloudflare's Overview → **Check nameservers now**.

Usually active within an hour on `.in`, occasionally up to 24. Some registrars
also refuse nameserver changes for the first hour after registration.

To check independently: `dnschecker.org`, enter `newonott.in`, type **NS**.
Cloudflare's names showing means it is propagating; the registrar's means step 2
did not take.

### Doing it on Hostinger

The domain is registered with Hostinger, and Hostinger has two settings that
look like the same thing and are not:

| Setting | What it does |
| ------- | ------------ |
| **Domains → your domain → DNS / Nameservers → Change nameservers** | Hands the domain to Cloudflare. **This is the one.** |
| **Domains → your domain → DNS Zone** (the records editor) | Edits records *Hostinger* serves. Irrelevant once nameservers move, and adding NS records here does nothing. |

Under **Change nameservers**, pick **Use custom nameservers** and enter exactly
the two Cloudflare assigned to this zone — the pair shown on the Cloudflare
Overview page for `newonott.in`, e.g. `heidi.ns.cloudflare.com` and
`wilson.ns.cloudflare.com`.

Three things that produce "Invalid nameservers" on the Cloudflare side:

1. **Leaving Hostinger's own nameservers in slots 3 and 4.** A mixed delegation
   is not a partial one — it is a broken one. Only the two Cloudflare names may
   be present; clear the rest.
2. **Using a different Cloudflare pair.** Every zone is assigned its own pair.
   Another zone's, or one copied from a guide, resolves as a real hostname but
   does not serve your records.
3. **Adding them as NS records in the DNS Zone editor** instead of changing the
   nameservers. That edits a zone nobody is asking any more.

Attaching a website or hosting plan in hPanel can also silently reset the
nameservers back to Hostinger's. If the status flips back after being fine,
that is what happened.

---

## 1. Pointing the domain at the Worker

**Do not add the root or `www` records by hand.** Attaching a Custom Domain
creates them for you, with the right target and a TLS certificate, and doing it
manually first causes an "already exists" error you then have to unpick.

Once the zone is active:

- Worker (`dropday`) → **Settings → Domains & Routes → Add → Custom domain**
- Enter `newonott.in`. Repeat for `www.newonott.in`.

That is the whole step. The two "Visitors cannot reach…" recommendations in the
DNS tab resolve themselves the moment it completes.

<details>
<summary>The manual alternative, if you ever need it</summary>

A Worker Route needs a proxied DNS record to attach to, and the address is a
placeholder — a proxied record's origin is never contacted when a Route handles
the request.

| Type | Name  | Content | Proxy            |
| ---- | ----- | ------- | ---------------- |
| AAAA | `@`   | `100::` | Proxied (orange) |
| AAAA | `www` | `100::` | Proxied (orange) |

Then Worker → Settings → Domains & Routes → **Add route**: `newonott.in/*` and
`www.newonott.in/*`. Custom Domain is simpler and handles certificates itself;
prefer it.

</details>

---

## 2. Email records — only once a provider is chosen

The newsletter sends from a service (Buttondown, ConvertKit, Resend…), and each
gives you its own values. Adding guessed ones is worse than adding none: a wrong
SPF record makes legitimate mail fail authentication.

So do this **after** picking a provider, and paste exactly what it gives you.

### How the form works

**Add record** in the DNS tab:

| Field       | What to put                                                          |
| ----------- | -------------------------------------------------------------------- |
| **Type**    | `TXT` for SPF/DKIM/DMARC, `MX` to receive mail, `CNAME` for an alias |
| **Name**    | `@` is the root domain. Otherwise the subdomain **only** — `www`, not `www.newonott.in` |
| **Content** | The value from your provider, pasted verbatim                        |
| **Proxy**   | **DNS only (grey cloud)** for TXT and MX. Proxying them breaks mail  |
| **TTL**     | Auto                                                                 |

### What you will be adding

| Purpose    | Type | Name                | Value                                             |
| ---------- | ---- | ------------------- | ------------------------------------------------- |
| SPF        | TXT  | `@`                 | `v=spf1 include:<provider's host> ~all`            |
| DKIM       | TXT  | provider-specific   | A long key the provider generates                 |
| DMARC      | TXT  | `_dmarc`            | `v=DMARC1; p=none; rua=mailto:you@example.com`     |
| Receiving  | MX   | `@`                 | Only if you want mail *to* @newonott.in           |

Notes that matter:

- **One SPF record per domain.** Two `v=spf1` TXT records is a failure, not a
  merge. If one exists, edit it rather than adding another.
- **Start DMARC at `p=none`.** That monitors without rejecting. Move to
  `quarantine` and then `reject` once the reports show your own mail passing.
- **MX is only for receiving.** Sending a newsletter does not need it.

### Why this is not optional

A `.in` domain with no SPF/DKIM lands in Promotions or Spam. The subscribe
banner will collect addresses either way, so getting this wrong quietly wastes
every subscriber it earns.

---

## 3. After it is live

- `newonott.in` serves the board, `www.newonott.in` reaches the same place
- `newonott.in/build.txt` names the deployed commit
- `newonott.in/robots.txt` still carries its `Sitemap:` line — Cloudflare's AI
  crawler settings can manage robots.txt and may replace it
- Then, and only then, add the property in Google Search Console and submit
  `https://newonott.in/sitemap.xml`
