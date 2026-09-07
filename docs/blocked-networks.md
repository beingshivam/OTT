# When the site does not render on a corporate network

Written down because it took a week to find and the symptom points nowhere near
the cause.

## The symptom

The page loads, but as plain text — the prerendered fallback, previously with no
styling at all. It reads as a broken or half-built site rather than a blocked
one, which is why it was first reported as a styling bug.

## What it actually was

Zscaler, on a corporate laptop, answering **one file** with a block page:

```
We found a security threat.  Website blocked
PageRisk block  inbound response  page is unsafe
You tried to visit: https://newonott.in/assets/index-BSmBptkL.js
                                                          D29
```

`/diag/` on the affected machine narrowed it to that single file:

| Request | Result |
| --- | --- |
| `/` | 200, current commit, `max-age=0, must-revalidate` |
| `/assets/index-*.css` (38KB) | 200, `text/css` |
| `/diag-probe.js` (small) | loads, with and without `crossorigin` |
| `/assets/index-*.js` (214KB) | **403, `text/html`, 14,760 bytes** |

So: not the domain, not the site, not caching, not `crossorigin`, and not "`.js`
is blocked" — a small script at the same origin loaded fine. One file, scanned
and refused.

**PageRisk** is a heuristic score, not a detection. It reads the response and
rates how much it resembles something dangerous. The bundle contains no `eval`,
no `Function` constructor, no `atob`, no `data:` URIs and no `document.write` —
it is a stock React production build. What it does have is the shape every
minified bundle has: nine lines, the longest 113,244 characters of dense
high-entropy text. Add a domain a few weeks old on a TLD with no reputation
behind it, and the score clears the threshold their policy blocks at.

## What to do about it

The site is a false positive, and the routes that exist for that are the ones to
use:

1. **Submit the domain to Zscaler's site review** at <https://sitereview.zscaler.com>.
   This is the sanctioned channel for a misclassification, and it is our own
   domain being misclassified.
2. **Ask the network's administrators to allow it.** The block page names the
   contact. On a work laptop this is their call, not ours.

**Not** by reshaping the build to score below someone's security threshold. The
file is benign, but tuning a bundle to get past a scanner is evading a control
somebody deployed on purpose, and it is not a thing this repo should do. Any
change to how the bundle is split or minified should be justified by load time,
on its own merits, for every reader — never by this.

Reputation also accrues on its own as a domain ages and is seen, so this class
of block tends to fade without action.

## What was fixed on our side

Three things surfaced while looking, all real, none of them the cause:

- `_headers` set cache revalidation on `/index.html` — a path no browser
  requests — so no page on the site carried a cache directive at all.
- Fixing that revealed Cloudflare *adds* the headers of every matching rule
  rather than replacing them, which had silently cancelled the year-long cache
  on hashed assets. The rules are disjoint now and the deploy asserts it.
- `crossorigin` on the stylesheet and bundle tags, dropped. Harmless here, and
  it makes a middlebox's redirect fail harder than it needs to.

And the failure now announces itself: the fallback carries its own background
and font so a blocked page is readable, and a watchdog shows a banner naming
what was stopped, linking to `/diag/`.

## The check page

`/diag/` runs the site's own requests from the affected browser and reports what
came back — status and content type per asset, whether a redirect happened,
whether the page served is the page the origin has, the text of whatever
answered instead, and whether a byte range of a refused file is allowed through
(which separates a scanned file from a refused address). Plain ES5, inline
styles, no external anything: it has to work where the real page does not.
Nothing it collects is sent anywhere.
