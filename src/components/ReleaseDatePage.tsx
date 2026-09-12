import { PosterArt } from './PosterArt';
import { Rating } from './Rating';
import { IconPlay, IconTicket, IconExternal } from './icons';
import { platform as platformById, languageName } from '../data/platforms';
import { outbound } from '../data/affiliates';
import { runtimeLabel } from '../lib/format';
import { formatWeekRange } from '../lib/week';
import { scoreOf } from '../lib/score';
import type { Release, ReleaseFeed } from '../types';
import { BRAND } from '../data/brand';

/**
 * "When is <film> coming to OTT?"
 *
 * The highest-volume recurring pattern in Indian entertainment search, and the
 * one question this site is uniquely placed to answer: it already tracks what
 * opened in cinemas and it already re-checks streaming providers twice a week,
 * so the moment a theatrical title gains one, this page has the answer while
 * everyone else is still guessing.
 *
 * The page is published the week the film is *announced*, not the week it
 * opens and not the week it streams. That ordering is the whole point — a page
 * indexed and ageing before the search demand arrives is the difference between
 * ranking for it and watching someone else rank for it.
 *
 * So it has three states and one URL, and says something true in each:
 *
 *   before it opens   the release date, which is what people search in the
 *                     weeks running up to a film and the busiest of the three
 *   after it opens    streaming unannounced, and honestly so
 *   once it streams   the platform that has it
 *
 * The URL does not change between them, which is the reason the states exist
 * on one page rather than three: the document earns its age across the whole
 * lifecycle instead of starting from nothing each time the question changes.
 *
 * What it will not do is guess. There is a strong temptation to print "films
 * usually arrive on OTT in about eight weeks", and with four cinema-to-OTT
 * transitions in the feed there is no honest basis for a number like that. An
 * unannounced date says unannounced. A page that invents a date is worth less
 * than no page, because the one thing a reader is here to find out is whether
 * they can trust the answer.
 */

interface Props {
  release: Release;
  feed: ReleaseFeed;
  region: string;
}

const DAY = 86_400_000;

const fmtDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

export function ReleaseDatePage({ release, feed, region }: Props) {
  const streaming = release.platforms.filter((p) => p !== 'theatres');
  const daysOut = Math.floor((Date.now() - Date.parse(`${release.releaseDate}T00:00:00Z`)) / DAY);
  /** Negative days out means the film has not opened. Derived from the same
   *  number rather than a second date comparison, so the heading and the
   *  "in N days" line beside it can never disagree. */
  const upcoming = daysOut < 0;
  const daysToGo = -daysOut;

  /**
   * The film's own streaming date, which lives on a different row.
   *
   * A title with an announced digital date is two rows in this feed: the cinema
   * listing in the week it opened, and a second row in the week it reaches OTT.
   * This page is built from the first, so it answered "when is this coming to
   * OTT" with "not announced" while the feed three weeks along held the date —
   * on the one page whose entire purpose is that question.
   *
   * It names its service, because every row in the feed does now — the
   * placeholder that used to stand in for an unknown one is gone, and a
   * streaming date that cannot say where is no longer written at all.
   */
  const dated = feed.weeks
    .flatMap((w) => w.releases)
    .find(
      (r) =>
        r.id === `${release.id}~ott` &&
        // The film's date *here*. The End of Oak Street has a US digital date
        // and no Indian one, and printing an American release date to an Indian
        // reader is a worse answer than admitting we do not have theirs.
        r.regions.includes(region),
    );
  /* Both halves or neither: an archive row written before the rule could still
     carry a date with no service, and half an answer is the thing this page
     refuses to print. */
  const streamsOn =
    dated?.platforms.length && Date.parse(`${dated.releaseDate}T00:00:00Z`) >= Date.now() - DAY
      ? dated.releaseDate
      : null;

  const week = feed.weeks.find((w) => w.releases.some((r) => r.id === release.id));
  const alsoThatWeek = (week?.releases ?? [])
    .filter((r) => r.regions.includes(region) && r.id !== release.id && r.platforms.includes('theatres'))
    .slice(0, 6);

  const cinemas = platformById('theatres');
  /* The highest-intent click on the site: a cinema listing one step from a
     ticket. Wrapped for affiliate credit when a programme is live, untouched
     otherwise — see data/affiliates.ts. */
  /* Null when the registry has nowhere to send anybody. `theatres` always
     does, but homeUrl became optional the day a platform existed that has no
     destination at all — a digital date whose service TMDB has not assigned
     yet — and a button whose href is undefined is worse than no button. */
  const bookHref =
    cinemas.searchUrl?.replace('{q}', encodeURIComponent(release.title)) ?? cinemas.homeUrl;
  const book = bookHref ? outbound('theatres', bookHref) : null;

  return (
    <article className="titlepage">
      <nav className="crumbs" aria-label="Breadcrumb">
        <a href="/">{BRAND}</a>
        <span aria-hidden="true">›</span>
        <a href="/theatres">In cinemas</a>
        <span aria-hidden="true">›</span>
        <span>{release.title}</span>
      </nav>

      <div className="titlepage__head">
        <PosterArt
          className="titlepage__art"
          title={release.title}
          platformId={release.platforms[0]}
          imageUrl={release.posterUrl}
        />
        <div className="titlepage__intro">
          {/* Once it is streaming the question is answered, so asking it again
              in the heading reads as though the page has not noticed — and
              "where to watch" is what someone at this stage actually typed. */}
          <h1>
            {streaming.length
              ? `Where to watch ${release.title}`
              : upcoming
                ? `When does ${release.title} release?`
                : `When is ${release.title} coming to OTT?`}
            {/* The heading keeps asking the question even when the answer is
                a date rather than a platform — that is still what someone
                typed, and the line below answers it outright. */}
          </h1>

          {/* The answer, first and unqualified. Everything below is context for
              a reader who wants it; someone who came for the date should be
              able to leave after one line. */}
          <div className={streaming.length || streamsOn ? 'answer answer--yes' : 'answer'}>
            {streaming.length ? (
              <>
                <strong>Streaming now</strong> on{' '}
                {streaming.map((id, i) => (
                  <span key={id}>
                    {i > 0 && ', '}
                    <a href={`/${id}`}>{platformById(id).name}</a>
                  </span>
                ))}
                .
              </>
            ) : streamsOn ? (
              /* Both halves of the answer somebody arrived for: when, and
                 where. This used to be able to give only the date, because the
                 row behind it wore a placeholder instead of a service. */
              <>
                <strong>
                  Streaming on {dated!.platforms.map((id) => platformById(id).name).join(', ')} from{' '}
                  {fmtDate(streamsOn)}
                </strong>
                .
              </>
            ) : upcoming ? (
              /* Before a film opens, "not announced" is a true answer to the
                 wrong question — nobody has arrived here yet asking about
                 streaming. Lead with the date they came for, then say plainly
                 that the OTT date does not exist rather than implying one is
                 being withheld. */
              <>
                <strong>In cinemas from {fmtDate(release.releaseDate)}</strong>
                {daysToGo > 0 && ` — ${daysToGo === 1 ? 'tomorrow' : `${daysToGo} days away`}`}.{' '}
                No streaming date yet: a film is normally picked up by a platform after its
                theatrical run. This page updates automatically the day one announces.
              </>
            ) : (
              <>
                <strong>Not announced yet.</strong> {release.title} has not been dated for any
                streaming platform. This page updates automatically — we re-check every platform
                twice a week, so it will say so here the day that changes.
              </>
            )}
          </div>

          <dl className="titlepage__facts">
            <div>
              <dt>{upcoming ? 'In cinemas from' : 'In cinemas'}</dt>
              <dd>
                {fmtDate(release.releaseDate)}
                {daysOut > 0 && (
                  <span className="titlepage__ago">
                    {' · '}
                    {daysOut === 1 ? 'yesterday' : `${daysOut} days ago`}
                  </span>
                )}
                {daysToGo > 0 && (
                  <span className="titlepage__ago">
                    {' · '}
                    {daysToGo === 1 ? 'tomorrow' : `in ${daysToGo} days`}
                  </span>
                )}
              </dd>
            </div>
            {release.languages?.length > 0 && (
              <div>
                <dt>Language</dt>
                <dd>
                  {release.languages.map((l, i) => (
                    <span key={l}>
                      {i > 0 && ', '}
                      <a href={`/${languageName(l).toLowerCase()}`}>{languageName(l)}</a>
                    </span>
                  ))}
                </dd>
              </div>
            )}
            {release.genres?.length > 0 && (
              <div>
                <dt>Genre</dt>
                <dd>{release.genres.join(', ')}</dd>
              </div>
            )}
            {release.certification && (
              <div>
                <dt>Certificate</dt>
                <dd>{release.certification}</dd>
              </div>
            )}
            {release.runtimeMinutes && (
              <div>
                <dt>Runtime</dt>
                <dd>{runtimeLabel(release.runtimeMinutes)}</dd>
              </div>
            )}
            {scoreOf(release) && (
              <div>
                <dt>Rating</dt>
                <dd>
                  <Rating release={release} />
                </dd>
              </div>
            )}
          </dl>

          <div className="titlepage__actions">
            {release.trailerUrl && (
              <a className="btn btn--lg" href={release.trailerUrl} target="_blank" rel="noreferrer">
                <IconPlay />
                Trailer
              </a>
            )}
            {!streaming.length && book && (
              <a
                className="btn btn--lg"
                href={book.href}
                target="_blank"
                rel={book.sponsored ? 'sponsored noopener noreferrer' : 'noreferrer'}
              >
                <IconTicket />
                {/* Advance booking usually opens days before a film does, but
                    not always, and this cannot tell which. "Book tickets" on a
                    film with no seats yet promises something the next screen
                    does not deliver; "Check booking" is true either way. */}
                {upcoming ? 'Check booking' : 'Book tickets'}
                <IconExternal />
              </a>
            )}
          </div>
        </div>
      </div>

      {release.synopsis && (
        <section className="titlepage__block">
          <h2>What it's about</h2>
          <p>{release.synopsis}</p>
        </section>
      )}

      {release.cast && release.cast.length > 0 && (
        <section className="titlepage__block">
          <h2>Cast</h2>
          <p>{release.cast.join(' · ')}</p>
        </section>
      )}

      {alsoThatWeek.length > 0 && week && (
        <section className="titlepage__block">
          <h2>{upcoming ? 'Also opening that week' : 'Also in cinemas that week'}</h2>
          <ul className="titlepage__also">
            {alsoThatWeek.map((r) => (
              <li key={r.id}>
                {r.slug ? <a href={`/ott-release-date/${r.slug}`}>{r.title}</a> : r.title}
              </li>
            ))}
          </ul>
          <p className="titlepage__more">
            <a href={`/w/${week.id}`}>Everything released {formatWeekRange(week.id)}</a> ·{' '}
            <a href="/theatres">All new cinema releases</a>
          </p>
        </section>
      )}
    </article>
  );
}
