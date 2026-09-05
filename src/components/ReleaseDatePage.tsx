import { PosterArt } from './PosterArt';
import { Rating } from './Rating';
import { IconPlay, IconTicket, IconExternal } from './icons';
import { platform as platformById, languageName } from '../data/platforms';
import { formatWeekRange } from '../lib/week';
import type { Release, ReleaseFeed } from '../types';

/**
 * "When is <film> coming to OTT?"
 *
 * The highest-volume recurring pattern in Indian entertainment search, and the
 * one question this site is uniquely placed to answer: it already tracks what
 * opened in cinemas and it already re-checks streaming providers twice a week,
 * so the moment a theatrical title gains one, this page has the answer while
 * everyone else is still guessing.
 *
 * The page is published the week the film opens, not the week it streams. That
 * ordering is the whole point — a page indexed and ageing before the search
 * demand arrives is the difference between ranking for it and watching someone
 * else rank for it.
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

  const week = feed.weeks.find((w) => w.releases.some((r) => r.id === release.id));
  const alsoThatWeek = (week?.releases ?? [])
    .filter((r) => r.regions.includes(region) && r.id !== release.id && r.platforms.includes('theatres'))
    .slice(0, 6);

  const cinemas = platformById('theatres');
  const bookUrl = cinemas.searchUrl?.replace('{q}', encodeURIComponent(release.title)) ?? cinemas.homeUrl;

  return (
    <article className="titlepage">
      <div className="titlepage__head">
        <PosterArt
          className="titlepage__art"
          title={release.title}
          platformId={release.platforms[0]}
          imageUrl={release.posterUrl}
        />
        <div className="titlepage__intro">
          <h1>When is {release.title} coming to OTT?</h1>

          {/* The answer, first and unqualified. Everything below is context for
              a reader who wants it; someone who came for the date should be
              able to leave after one line. */}
          <div className={streaming.length ? 'answer answer--yes' : 'answer'}>
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
              <dt>In cinemas</dt>
              <dd>
                {fmtDate(release.releaseDate)}
                {daysOut > 0 && (
                  <span className="titlepage__ago">
                    {' · '}
                    {daysOut === 1 ? 'yesterday' : `${daysOut} days ago`}
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
                <dd>{release.runtimeMinutes} min</dd>
              </div>
            )}
            {release.rating != null && (
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
            {!streaming.length && (
              <a className="btn btn--lg" href={bookUrl} target="_blank" rel="noreferrer">
                <IconTicket />
                Book tickets
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
          <h2>Also in cinemas that week</h2>
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
