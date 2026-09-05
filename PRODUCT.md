# New on OTT — product brief

## The problem

Every week a large amount of content releases across a dozen services, and there
is no single place that shows it. What exists instead is a screenshot: someone
makes a nicely designed image of Friday's releases and it gets forwarded through
WhatsApp groups. That image is the competition, and it's worth being honest about
why it wins — it's glanceable, it's complete across platforms, and it costs the
reader nothing. It loses on three things, and those three things are the product:

1. **It's frozen.** One day, no history, no next week.
2. **It's not filterable.** You can't say "only what I actually pay for," or
   "only Tamil," or "only films."
3. **It's not linkable.** You can't share "this bit" with a friend.

Existing apps mostly solve a different problem — they're catalogue search
(*where can I watch X?*) rather than a release calendar (*what's new this week?*).
That's a browse problem versus a discovery problem, and the second one is the one
people are actually forwarding screenshots about.

## Who it's for

Someone who subscribes to three or four services, watches across two or three
languages, and doesn't want to open four apps to find out what's new. India-first,
because that's where the multi-platform, multi-language problem is sharpest — but
the model is region-agnostic and ships with the US as a second region.

## The one thing it has to do

Answer *"what's new this week, and which of it is on something I have?"* in under
ten seconds, on a phone, with no account.

Everything in v1 was chosen against that sentence. Everything that wasn't needed
for it was cut.

## What v1 ships

| | |
|---|---|
| **The week** | Friday→Thursday, grouped by release day, arrow keys through past and upcoming weeks |
| **The big ones** | A ranked rail across all platforms, so "just tell me what's worth watching" has an answer |
| **Filters** | Platform, type, language, genre, free-text search — all reflected in the URL |
| **My lineup** | Pick your platforms and languages once, on-device; one tap filters the week to them |
| **Detail** | Where it's streaming, what day, which languages, season/episode, finale flags, deep link out |
| **Share** | Any filtered view is a link; individual titles use the native share sheet |
| **Regions** | India and the US, each with its own platform set |

## What v1 deliberately doesn't ship

- **Accounts.** Personalisation is real but local. Nothing here is worth a signup
  wall, and adding one would cost more users than it earns.
- **Ratings and reviews of our own.** We're not a review site. We point at where
  things are.
- **Watchlists that sync.** The moment they sync, they need accounts. Revisit only
  if retention data says people want it.
- **Notifications.** Earn the weekly habit first.
- **Every platform on earth.** A registry of ~20 that covers the vast majority of
  what people actually subscribe to, extensible in one file.

## Why the design is what it is

- **The calendar is the spine.** Sorting reorders titles *within* a day rather
  than dissolving day grouping. The moment you flatten it, you're a catalogue,
  and catalogues already exist.
- **Platform filters are never hidden behind a menu.** It's the first thing anyone
  reaches for, so it's a permanently visible chip row.
- **Generated poster art.** Most calendar rows exist before anyone has published a
  poster. Rather than a grid of grey rectangles, every title gets deterministic
  generated art keyed off its name and platform. It's stable across visits, and
  real artwork takes over the moment the feed has it.
- **No fabricated data.** The seeded week carries only what the source calendar
  actually stated. Ratings and synopses are absent rather than invented, and the
  UI says so. A release guide that's wrong is worse than one that's incomplete.
- **Static file, not a live API.** The whole site is one JSON fetch. The key never
  reaches a browser, the CDN serves it instantly, and a TMDB outage on a Friday
  morning doesn't take the page down.

## How we'd know it's working

- **Weekly return rate.** The only metric that matters. This is a habit product;
  if people don't come back on Friday, nothing else counts.
- **Time to first filter.** If people filter, they found the thing that makes this
  better than the screenshot.
- **Lineup adoption.** What share of returning visitors have set their platforms.
- **Outbound clicks per session.** Proof we sent someone to actually watch
  something.

Explicitly *not* session duration. Time on site is a failure mode here — the goal
is to answer the question and get out of the way.

## What comes next, in order

1. **More sources.** TMDB is thin on regional Indian OTT. Add JustWatch and direct
   platform feeds to cover ZEE5, Sun NXT, hoichoi and aha properly.
2. **Trailer inline.** The single highest-intent action after "what's new" is
   "show me."
3. **Add to calendar.** One tap to put a Friday release on your actual calendar —
   habit-forming, no account needed.
4. **Weekly digest.** Email or WhatsApp, opt-in, filtered to your lineup. This is
   the point where the screenshot forward gets replaced rather than mirrored.
5. **Shareable card image.** Meet the existing behaviour where it lives — let
   people export their filtered week as the image they were going to forward
   anyway, with a link back.
