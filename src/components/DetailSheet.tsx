import { useEffect, useRef, useState } from 'react';
import { IconCalendar, IconClose, IconDoc, IconExternal, IconShare, IconCheck, IconWhatsApp } from './icons';
import { PosterArt } from './PosterArt';
import { dropLabel } from './ReleaseCard';
import { KIND_LABEL, languageName, platform } from '../data/platforms';
import { outbound } from '../data/affiliates';
import { runtimeLabel } from '../lib/format';
import { formatDay } from '../lib/week';
import { scoreOf, scoreTitle } from '../lib/score';
import { shareLine, shareUrl, whatsappHref } from '../lib/share';
import type { Release } from '../types';
import { MoreLikeThis, useSimilar, type SimilarHit } from './MoreLikeThis';

interface Props {
  release: Release;
  onClose: () => void;
  /** Where a "More like this" card goes. The sheet does not decide — a
   *  recommendation this site has a page for should become a page view, and
   *  only App knows the corpus well enough to tell. */
  onPickSimilar: (hit: SimilarHit) => void;
}

export function DetailSheet({ release, onClose, onPickSimilar }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const similar = useSimilar(release.id);
  const [copied, setCopied] = useState(false);
  const p = platform(release.platforms[0]);
  const day = formatDay(release.releaseDate);
  const drop = release.drop;
  const dropText = dropLabel(release);
  /* Same call the card behind this sheet makes, so opening a title never shows
     a different number than the row you tapped. */
  const score = scoreOf(release);

  /**
   * What the link to the title page is actually offering.
   *
   * It said "OTT release date" on everything with a slug, which is a promise
   * only one of the four states can keep. Reported on Zakir Khan: Papa Yaar —
   * a Netflix special that came out this morning, where the sheet offered
   * "Watch on Netflix" and, directly beside it, a calendar icon promising a
   * date that had already happened. The page itself was right the whole time;
   * its heading reads "Where to watch Zakir Khan: Papa Yaar" and its first
   * line says "Streaming now on Netflix". Only the button lied.
   *
   * The URL does not change with the state and must not: one document earning
   * its age across a title's whole lifecycle is the entire design of these
   * pages, and /ott-release-date/<slug> is where Google already has them. What
   * a reader is promised on the way in is a different thing from where they
   * land, and that is the half that has to move.
   *
   * So the four states, in the order the page itself asks them — is it out,
   * and does it stream:
   *
   *   streaming, out        the OTT date is not news any more; what the page
   *                         adds is the cast, the runtime and the trailer
   *   streaming, upcoming   the date is the answer, and it is a streaming one
   *   cinema, upcoming      the date is the answer, and it is an opening
   *   cinema, out           the genuine article: out of cinemas, no OTT date
   *                         yet, and that question is what the page exists for
   */
  /* Artwork for the hero, and whether it is standing in — see the frame below. */
  const hero = release.backdropUrl ?? release.posterUrl;
  const heroIsPoster = !release.backdropUrl && Boolean(release.posterUrl);

  const streams = release.platforms.some((id) => id !== 'theatres');
  /* Derived the same way as the page's own heading (ReleaseDatePage), so the
     button and the page it opens can never disagree about the tense. */
  const upcoming =
    Math.floor((Date.now() - Date.parse(`${release.releaseDate}T00:00:00Z`)) / 86_400_000) < 0;
  const detail = streams
    ? upcoming
      ? { label: 'Streaming date', icon: <IconCalendar /> }
      : { label: 'Full details', icon: <IconDoc /> }
    : upcoming
      ? { label: 'Release date', icon: <IconCalendar /> }
      : { label: 'OTT release date', icon: <IconCalendar /> };

  useEffect(() => {
    // Remember what opened the sheet so focus can go back there on close.
    // Without this, dismissing dropped focus to <body> and a keyboard user lost
    // their place in the board entirely.
    const opener = document.activeElement as HTMLElement | null;

    closeRef.current?.focus();
    document.body.classList.add('is-locked');

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);

    return () => {
      document.body.classList.remove('is-locked');
      window.removeEventListener('keydown', onKey);
      if (opener?.isConnected) opener.focus();
    };
  }, [onClose]);

  /*
   * One sentence, built once, used by both ways out of this sheet.
   *
   * This wrote its own line — `title — Platform, Fri 18 Sep` — from
   * `platforms[0]`, which never asked whether the film was actually out: a
   * release three weeks away was forwarded as though it were on tonight. And
   * it shared `window.location.href`, so a title opened from the board sent
   * the reader to the homepage rather than to the film. Both now come from
   * lib/share.ts, which asks the same four states the title page does.
   *
   * No `streamsOn` passed: the sheet has one row and the film's digital date
   * lives on another. The title page has both and says the better sentence;
   * this says the true one.
   */
  const line = shareLine(release);
  const url = shareUrl(release, window.location.href, window.location.origin);

  async function share() {
    const text = line;
    if (navigator.share) {
      try {
        await navigator.share({ title: release.title, text, url });
        return;
      } catch {
        /* User dismissed the share sheet — fall through to copying. */
      }
    }
    try {
      await navigator.clipboard.writeText(`${text}\n${url}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* Clipboard blocked; nothing useful left to do. */
    }
  }

  // Land on the title, not the homepage. On a phone these https links are
  // universal links, so the installed app opens instead of the browser.
  const watchUrl =
    release.watchUrl ??
    (p.searchUrl ? p.searchUrl.replace('{q}', encodeURIComponent(release.title)) : p.homeUrl);

  return (
    <div
      className="sheet-backdrop"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="sheet-title"
    >
      <div className="sheet">
        {/* Outside the scrolling region on purpose. It used to sit inside it,
            absolutely positioned, so it scrolled away with the content — on a
            phone, where the sheet is nearly full height and the overview runs
            long, it was gone after the first flick and the only way out left
            was the back gesture. */}
        <button ref={closeRef} className="sheet__close" onClick={onClose} aria-label="Close">
          <IconClose />
        </button>
        <div className="sheet__scroll">
        {/*
          * The poster stands in when there is no backdrop.
          *
          * Reported on Now streaming: open anything there and the artwork is
          * missing. The hero reads backdropUrl and the back catalogue has
          * none — zero of 664 rows — because fetch-catalogue never carried
          * backdrop_path, so every title on that lens opened onto the
          * generated gradient. The same gap hits the calendar more quietly:
          * 105 of its 495 rows have a poster and no backdrop.
          *
          * The catalogue now collects backdrops (fetch-catalogue.mjs) and
          * will have them after the next Monday pass. This is the other half,
          * and it is worth having on its own: TMDB simply does not have a
          * backdrop for every title, and a small Malayalam release is exactly
          * the kind that goes without. There is always a poster.
          *
          * It fills the frame, the way a backdrop does on a title that has
          * one. The first attempt showed the poster whole over a blurred copy
          * of itself, on the reasoning that cropping a 2:3 portrait to 21:9
          * costs most of the picture — true, and it read as a small panel
          * floating in a wide frame rather than as the hero the sheet has
          * everywhere else. Consistency wins: one shape for every title,
          * whichever artwork is behind it.
          *
          * Cropped high rather than centred, which is the one thing the crop
          * gets to choose. A poster's faces and title sit in its upper half
          * and its lower third is the billing block, so a centred band lands
          * on somebody's chest.
          */}
        <div className={`sheet__hero${heroIsPoster ? ' sheet__hero--poster' : ''}`}>
          <PosterArt
            className="art"
            title={release.title}
            platformId={p.id}
            imageUrl={hero}
            quiet
          />
          <span className="sheet__hero-scrim" />
        </div>

        <div className="sheet__body">
          <h2 className="sheet__title" id="sheet-title">
            {release.title}
          </h2>

          <div className="sheet__pills">
            <span className="pill" style={{ color: p.accent }}>
              <i />
              <span style={{ color: '#fff' }}>{p.name}</span>
            </span>
            <span className="pill">{KIND_LABEL[release.kind]}</span>
            {dropText && <span className="pill">{dropText}</span>}
            {drop?.fullSeason && <span className="pill">Full season</span>}
            {drop?.finale && <span className="pill">Finale</span>}
            {release.certification && <span className="pill">{release.certification}</span>}
            {score && (
              <span className="pill" title={scoreTitle(score)}>
                ★ {score.value.toFixed(1)}
              </span>
            )}
          </div>

          <div className="sheet__actions sheet__actions--lead">
            {/* One button per place it's actually available, not just the first. */}
            {release.platforms.map((id, i) => {
              const target = platform(id);
              const destination =
                i === 0
                  ? watchUrl
                  : target.searchUrl
                    ? target.searchUrl.replace('{q}', encodeURIComponent(release.title))
                    : target.homeUrl;
              /* Wrapped only where a programme is actually live; otherwise this
                 returns the same URL it was given. rel carries "sponsored"
                 when it is paid, which is what Google asks of affiliate links
                 and what keeps a search-dependent site out of trouble. */
              /**
               * A platform with nowhere to send anybody.
               *
               * `ott` is a date without a service: TMDB publishes a digital
               * release date weeks ahead but assigns the provider on release
               * day, so the calendar can say when and not where. It has no
               * homeUrl and no searchUrl by design, which left this rendering
               * "Watch on Digital" pointing at undefined — a button that
               * promises the one thing the row cannot deliver.
               *
               * The date is still the answer most people came for, so the row
               * stays and says exactly what it knows.
               */
              if (!destination) {
                return (
                  <p key={id} className="sheet__pending">
                    Streaming date confirmed — the service has not been announced yet.
                  </p>
                );
              }

              const link = outbound(id, destination);
              return (
                <a
                  key={id}
                  className={i === 0 ? 'btn btn--primary' : 'btn btn--lg'}
                  href={link.href}
                  target="_blank"
                  rel={link.sponsored ? 'sponsored noopener noreferrer' : 'noreferrer'}
                >
                  {/* An outward arrow, not a play triangle. The play icon said
                      "playback starts here" while the label said the opposite,
                      and the icon is what gets read first — a reader wrote in
                      unsure whether this site streams anything. Naming the
                      destination and pointing away from the page is the whole
                      clarification. */}
                  <IconExternal />
                  {target.theatrical ? 'Book tickets' : `Watch on ${target.short}`}
                </a>
              );
            })}
            {release.trailerUrl && (
              <a className="btn btn--lg" href={release.trailerUrl} target="_blank" rel="noreferrer">
                <IconExternal />
                Trailer
              </a>
            )}
            {/* The other half of the release-date pages: without a link a
                person can click, those pages would be reachable only from a
                search result, and prerendered links no visitor can follow are
                the cloaking problem the whole set is built to avoid. */}
            {release.slug && (
              <a className="btn btn--lg" href={`/ott-release-date/${release.slug}`}>
                {detail.icon}
                {detail.label}
              </a>
            )}
            {/* The forward, and the reason it is a link rather than a button:
                a WhatsApp hand-off is a navigation, so it gets middle-click,
                long-press and "open in new tab" for free, and it works with
                JavaScript still loading. */}
            <a
              className="btn btn--lg btn--wa"
              href={whatsappHref(line, url)}
              target="_blank"
              rel="noreferrer"
            >
              <IconWhatsApp />
              WhatsApp
            </a>
            <button className="btn btn--lg" onClick={share}>
              {copied ? <IconCheck /> : <IconShare />}
              {copied ? 'Copied' : 'Share'}
            </button>
          </div>

          <dl className="sheet__grid">
            <div className="sheet__stat">
              <dt>Drops</dt>
              <dd>{`${day.weekday}, ${day.day} ${day.month}`}</dd>
            </div>
            <div className="sheet__stat">
              <dt>Languages</dt>
              <dd>{release.languages.map(languageName).join(', ')}</dd>
            </div>
            {release.runtimeMinutes != null && (
              <div className="sheet__stat">
                <dt>Runtime</dt>
                <dd>{runtimeLabel(release.runtimeMinutes)}</dd>
              </div>
            )}
            {release.director && (
              <div className="sheet__stat">
                <dt>Director</dt>
                <dd>{release.director}</dd>
              </div>
            )}
          </dl>

          {release.synopsis && (
            <div className="sheet__section">
              <h4>Overview</h4>
              <p>{release.synopsis}</p>
            </div>
          )}

          {release.genres.length > 0 && (
            <div className="sheet__section">
              <h4>Genres</h4>
              <div className="sheet__pills" style={{ marginBottom: 0 }}>
                {release.genres.map((g) => (
                  <span className="pill" key={g}>
                    {g}
                  </span>
                ))}
              </div>
            </div>
          )}

          {release.cast && release.cast.length > 0 && (
            <div className="sheet__section">
              <h4>Cast</h4>
              <p>{release.cast.join(' · ')}</p>
            </div>
          )}

          {/* The same row the catalogue sheet carries. It lived only there at
              first, which was the narrowest possible place for it: the one
              kind of title this site has no page for. A reader who opens a
              film from the board wants the next thing just as much. */}
          <MoreLikeThis items={similar} platformId={p.id} onPick={onPickSimilar} />

        </div>
        </div>
      </div>
    </div>
  );
}
