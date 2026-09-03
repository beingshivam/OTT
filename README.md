# dropday

**Everything new, everywhere, this week.** One page that shows every film, series,
documentary and theatrical release landing across Netflix, Prime Video, JioHotstar,
Apple TV+, SonyLIV, Sun NXT, hoichoi, aha, Shudder, HBO Max, Hulu and more — plus
what's opening in theatres.

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

`.github/workflows/deploy.yml` publishes the site to **GitHub Pages** on every
push to the default branch, and again whenever the calendar refresh commits new
data. It sets the base path from the repo name, so the site lands at
`https://<user>.github.io/<repo>/`.

**One-time setup:** turn Pages on under *Settings › Pages › Source: **GitHub
Actions***. Creating a Pages site needs repo-admin scope, which the Actions token
deliberately doesn't have, so this can't be automated from inside the workflow.
Until it's enabled the workflow still builds and stays green, logging a notice
instead — flip the setting, re-run it, and the site goes up.

If your account restricts Pages for private repos, either make the repo public or
point Vercel/Netlify/Cloudflare Pages at it instead — build command `npm run
build`, output directory `dist`, no environment variables needed.

### One self-contained file

```bash
npm run build:single      # → dist/dropday.html
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
cp .env.example .env        # then paste your token in
TMDB_TOKEN=... npm run refresh
```

Get a token — the **API Read Access Token**, not the v3 key — from
<https://www.themoviedb.org/settings/api>.

Options: `--weeks-back N` (backfill history, default 2) and `--weeks-ahead N`
(pull upcoming weeks, default 2). Set `REGIONS=IN,US` to control which regions get
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

- **Weeks run Friday → Thursday**, because that's how releases are actually
  scheduled and how the calendars people already read are laid out.
- **Results are always grouped by release day.** Sorting reorders titles *within*
  a day rather than dissolving the calendar, which is the thing being aggregated.
- **Titles with no artwork get generated poster art**, keyed off the title and
  platform so it's stable across visits. Most calendar rows arrive before anyone
  has published a poster, and a wall of grey placeholders kills the page.
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
