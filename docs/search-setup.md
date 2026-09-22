# Search across everything, not just this site

The box in the header searches two things at once.

**The site's own rows** — the eight-week calendar plus the back catalogue,
about 963 titles — come from files the browser has already downloaded. That half
works with no configuration and always will. It is the half that can say
"Netflix, from Friday", which is the entire reason this site exists.

**Everything else** comes from `/api/search`, a Worker route in this repo
(`worker/index.js`) that proxies TMDB's `/search/multi`. That is roughly a
million titles and every actor, director and composer TMDB has. It knows none of
them are on Netflix in India, which is why the results are shown in their own
section rather than blended in.

The two halves are never merged into one ranked list. A blend would bury the
three rows that answer the question under twenty that do not.

---

## The one thing to set up

The proxy needs a TMDB credential **bound to the Worker**.

The refresh scripts already use a TMDB token, but that one lives in this repo's
GitHub Actions secrets and Actions cannot lend it to a Worker. They are separate
stores and this is the step that gets missed.

Cloudflare dashboard → your Worker → **Settings → Variables and Secrets → Add**:

| Name         | Value                                     |
| ------------ | ----------------------------------------- |
| `TMDB_TOKEN` | a TMDB API Read Access Token, or an API key |

Either form works — the route sends a `Bearer` header for a v4 read token (they
begin `ey`) and an `api_key` query parameter for a v3 key. Encrypt it; a secret
is the default for this field.

Get one at <https://www.themoviedb.org/settings/api>. It is free for this use.

### Checking it landed

```
curl -s https://newonott.in/api/watchdog
```

`"searchable": true` means the binding exists. It reports only that — never the
value.

That endpoint exists because **the failure is quiet by design**. With no
credential the route answers honestly rather than erroring — `remote: false`,
no results — and the page keeps working on the local half alone. A reader just
sees a smaller search.

The header says **"Search 1M+ titles"** either way. That is one line at every
width, phone first, and it is the claim the site is making: the token is what
makes it true, so bind it before anyone else sees the site. The only place the
difference shows is the empty state, which says "Nothing on New on OTT matches
X" rather than a flat "Nothing matches" while the wider half is missing.

---

## What it costs

Nothing, in practice.

Every answer is cached at the Cloudflare edge for an hour, keyed on the
lowercased query and nothing else, so a film in the news is fetched from TMDB
once per hour rather than once per person typing its name. An empty query — the
probe the front end sends on load to learn which placeholder it may print —
costs no upstream call at all.

Results are trimmed at the Worker to the six fields a row draws, from TMDB's
~2KB per result down to a couple of hundred bytes. On Indian mobile data that is
the difference between a search that feels instant and one that does not.

Poster and profile images are rewritten to `/img/…`, which the same Worker
proxies and the edge caches for a year. Nothing in the dropdown loads from
`image.tmdb.org` directly.

---

## Rotating the token

Add the new one under the same name and save; the next request picks it up.
Revoke the old one at TMDB afterwards, not before — the route has no fallback
and the minute between the two is a minute of degraded search.

A token that has ever been pasted into a chat window, a screenshot, an issue or
a commit is burned. Rotate it rather than deciding it was probably fine.
