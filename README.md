# New on OTT

**Everything new, everywhere, this week.** One page that shows every film, series,
documentary and theatrical release landing across Netflix, Prime Video, JioHotstar,
Apple TV+, ZEE5, SonyLIV, Sun NXT, hoichoi, aha, Shudder, HBO Max, Hulu and more —
plus what's opening in theatres.

No login. No account. No app to install.

<!-- The problem: every week a pile of things release, and the only place that
     collects them is a screenshot someone forwards on WhatsApp. -->

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # static site in dist/
```

The build output in `dist/` is plain static files — deploy it to GitHub Pages,
Vercel, Netlify, Cloudflare Pages, or any bucket. For a subpath deploy (GitHub
Pages under `/<repo>/`), set the base path:

```bash
BASE_PATH=/ott/ npm run build
```

## Hosting

### Cloudflare — the primary deploy

Connecting the repo in the Cloudflare dashboard creates a **Workers** project
(new projects no longer land on Pages), which deploys with `npx wrangler deploy`
and serves at `newonott.in` (and still at its `*.workers.dev` address).

`wrangler.jsonc` in the repo root drives that deploy. It is deliberately
**assets-only** — no Worker script, nothing running at request time — because the
release feed is a committed file, not an API call. It also pins the project name
and turns on single-page-application handling so unknown paths serve the app.

There is deliberately **no `_redirects` file**. A `/* /index.html 200` rule
conflicts with that SPA handling — Cloudflare normalises `/index.html` back to
`/`, which re-matches the rule, and the deploy is rejected for an infinite loop.
`not_found_handling` covers the same ground on its own.

That explicit config matters: without it, `wrangler deploy` tries to auto-detect
the framework, reaches for `@cloudflare/vite-plugin`, and fails its own version
check. With it, framework detection is bypassed entirely.

Build settings in the dashboard: **build command** `npm run build`,
**output directory** `dist`, **production branch** the repo's default branch.
No environment variables — Cloudflare only serves the committed `releases.json`.

**How a refresh reaches the site:** the GitHub Action rebuilds the calendar and
commits it → the `workflow_run` trigger on `deploy-cloudflare.yml` fires when
that job completes → the new week is live. It is the completion, not the
commit, that starts the deploy: a push made with the default `GITHUB_TOKEN`
does not trigger `on: push`. `TMDB_TOKEN` stays a GitHub secret and is never
needed by the host.

### GitHub Pages

Removed on 8 September 2026. It was a second, independent deploy of the same
site, and once Cloudflare was the real one it was costing more than it gave: a
crawlable duplicate of all 129 pages competing for crawl budget on a domain
with nothing indexed yet, plus a workflow that failed on GitHub's own artifact
API and produced red marks nobody needed to act on.

The one thing it did that mattered has moved. A calendar refresh commits as
`github-actions[bot]` using the default `GITHUB_TOKEN`, and GitHub does not
start workflow runs from events a `GITHUB_TOKEN` caused — so `on: push` never
fires for a refresh. That is why the Pages workflow carried a `workflow_run`
trigger, and why `deploy-cloudflare.yml` now carries the same one. Without it
the calendar would rebuild every Friday, commit cleanly, report success, and
never reach the site.

### Netlify or Vercel

Both work unchanged: build command `npm run build`, output directory `dist`, no
environment variables. Netlify reads the same `_headers`; Vercel uses
`vercel.json`. Neither needs an SPA rewrite — every view lives in the query
string, so `/` is the only route the app ever serves.

### One self-contained file

```bash
npm run build:single      # → dist/newonott.html
```

Everything — styles, script, and the release feed — inlined into a single HTML
file with no relative fetches. It opens straight from `file://`, so it also works
for hosts that take one page, or for handing someone a copy to read offline.

## Where the data comes from

The app reads one static file: `public/data/releases.json`. That file is rebuilt
by `scripts/fetch-releases.mjs`, which pulls from
[TMDB](https://www.themoviedb.org/) — release windows via the discover endpoints,
and the actual streaming home for each title via TMDB's watch-provider data for
each region.

Deliberately a **build-time** pull rather than a browser call:

- the API key never ships to a client,
- the page is one cacheable JSON fetch, so it loads instantly at the edge,
- and if TMDB is down on a Friday morning, last week's file still serves.

### Refreshing by hand

```bash
cp .env.example .env        # Windows: copy .env.example .env
# paste your token into .env, then:
npm run refresh
```

The scripts read `.env` themselves, so the credential never goes on a command
line. That matters beyond tidiness: `TMDB_TOKEN=... npm run refresh` is bash
syntax and fails outright on Windows `cmd.exe`, and `set TMDB_TOKEN="x"` there
silently keeps the quotes as part of the value. A file avoids both.

A real environment variable still wins over `.env`, which is what CI relies on.

`refresh` runs two passes, and the split is the important part:

1. **`fetch-releases.mjs`** discovers what's dropping, via TMDB's discover and
   watch-provider endpoints. Curated rows already in the feed are kept — discover
   never returns most regional Indian titles, so a rebuild adds to the hand-checked
   calendar instead of replacing it.
2. **`enrich-releases.mjs`** attaches the artwork: posters, backdrops, synopses,
   ratings, runtimes, cast and director, matched by title.

3. **`fetch-logos.mjs`** writes `public/data/logos.json` — real platform logos
   from TMDB's watch-provider list. It's the only source that carries JioHotstar,
   ZEE5, SonyLIV, Sun NXT, hoichoi and aha alongside the global services;
   icon sets like Simple Icons stop at the American platforms, which would leave
   the board half-branded.

Run them individually with `npm run enrich` (add `--force` to re-fetch rows that
already have artwork, `--verbose` to see what didn't match) and `npm run logos`.

**Matching is deliberately strict.** A candidate is accepted only on an exact
normalised title match with a plausible year; anything less is left alone. A
poster for the wrong film is worse than no poster — it's confidently wrong, and
the generated fallback already looks intentional. Expect some titles, especially
brand-new regional ones, to keep their generated art until TMDB catalogues them.

Get a credential from <https://www.themoviedb.org/settings/api>. **Either one
works** — the v4 *API Read Access Token* (a long `eyJ...` JWT) or the v3
*API Key* (32 hex characters). The scripts detect which you gave them and pick
the matching auth scheme, so there is nothing to get wrong. In CI the secret may
be named `TMDB_TOKEN` or `TMDB_API_KEY`.

Options: `--weeks-back N` (backfill history, default 3) and `--weeks-ahead N`
(pull upcoming weeks, default 4) — the window leans forward because a release
calendar is read forwards. Set `REGIONS=IN,US` to control which regions get
watch-provider lookups.

### Refreshing automatically

`.github/workflows/refresh-releases.yml` runs the same script twice a week —
Friday and Tuesday, ~01:00 IST — and commits the result. Add your token as a repo
secret named `TMDB_TOKEN` (Settings › Secrets and variables › Actions). Until you
do, the job logs a notice and exits green rather than failing every week.

### The shipped sample data

`public/data/releases.json` currently holds one week (4–10 Sep 2026) transcribed
from a published weekly release calendar. Titles, platforms, languages, types and
dates are as printed there. Ratings and synopses are **not** included rather than
guessed — they populate on the first live refresh. The app flags this state in the
UI so nothing fake is ever presented as fact.

## Adding a platform

Everything platform-specific lives in `src/data/platforms.ts` — brand colour, chip
label, region availability, and the TMDB watch-provider ids that map onto it. The
refresh script parses that same file at run time, so adding a row there teaches
both the UI and the data pipeline at once.

```ts
{ id: 'zee5', name: 'ZEE5', short: 'ZEE5', accent: '#8A2BE2',
  tmdb: [232], regions: ['IN'], homeUrl: 'https://www.zee5.com/' },
```

Provider ids come from TMDB's `/watch/providers/movie?watch_region=IN` endpoint.

## How it's put together

```
src/
  data/platforms.ts     platform registry — colours, regions, TMDB provider ids
  lib/week.ts           Friday→Thursday week maths
  lib/filters.ts        filtering, sorting, and facet counts
  lib/urlState.ts       filters ⇄ query string, so every view is a shareable link
  lib/prefs.ts          on-device personalisation (localStorage, never uploaded)
  components/           nav, controls, trending rail, cards, detail sheet
scripts/fetch-releases.mjs   the TMDB → releases.json pipeline
```

A few decisions worth knowing about:

- **The board is the product, not a poster grid.** The thing people already
  forward on WhatsApp is one dense image: platform-grouped, readable at a glance,
  no scrolling, and no artwork at all. It beats a streaming-app browse grid
  because a wall of posters is exactly what you're trying to escape when you ask
  what's new. So the board is the default view and the poster grid is the
  alternative. Whole week, one screen on desktop.
- **Platform logos carry the wayfinding.** Nobody reads "Netflix", they spot the
  red N. Real logos come from TMDB; until they're fetched, a monogram in the
  brand colour stands in. Ink colour is picked from the accent's luminance, since
  brands like Apple TV+ are near-white and would swallow white text.

- **Weeks run Friday → Thursday**, because that's how releases are actually
  scheduled and how the calendars people already read are laid out.
- **Results are always grouped by release day.** Sorting reorders titles *within*
  a day rather than dissolving the calendar, which is the thing being aggregated.
- **Real artwork when it exists, generated art when it doesn't.** Posters come
  from TMDB via the enrich pass. Anything unmatched — or whose image URL later
  rots — falls back to art keyed off the title and platform, stable across
  visits. Most calendar rows arrive before anyone has published a poster, and a
  wall of grey placeholders kills the page.
- **Filters live in the URL.** "Every Tamil film this week" is a link, not a
  screenshot.
- **Personalisation without accounts.** Pick your platforms once; it's kept in
  `localStorage` and never leaves the device. There's nothing to sign in to.
- **Dark-only, on purpose.** It's a lean-back surface and every platform it
  aggregates is dark. One well-tuned theme beats two mediocre ones.

## Licence

Data from TMDB, used under their terms. This product is not endorsed or certified
by TMDB. Platform names and marks belong to their respective owners; they're
referenced here as plain text, and no brand assets are redistributed.
