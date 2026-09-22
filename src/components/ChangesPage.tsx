import { platform as platformById, languageName } from '../data/platforms';
import { byDay, dayLabel, phrase, GLYPH, type ChangeDay } from '../lib/changes.mjs';
import { BRAND } from '../data/brand';

/**
 * What the refresh noticed, in the order it noticed it.
 *
 * The pipeline has always seen these — a film gaining a streaming date is the
 * single event this whole site exists to catch — and nothing surfaced them.
 * The calendar shows what is out; this shows what *moved*, which is the part
 * worth coming back for and the only thing here that is news rather than a
 * schedule.
 *
 * It says only what two consecutive archives can prove. There is an obvious
 * better-reading version of this page full of lines like "Coolie left cinemas
 * after six weeks", and the data cannot support one of them: a row leaving the
 * eight-week window is the window moving, not a film ending its run. The
 * sentences live in lib/changes.mjs, shared verbatim with the prerendered copy
 * in build-seo.mjs, because this page existing in two implementations is how
 * the two of them start disagreeing.
 *
 * Empty is a real state and a common one. Most days nothing is announced, and
 * the honest thing to show then is a page that says so — not a filler item, and
 * not a spinner that never resolves.
 */

export interface Change {
  at: string;
  kind: string;
  id: string;
  title: string;
  lang?: string;
  platforms?: string[];
  date?: string;
  from?: string;
  to?: string;
  afterDays?: number;
}

interface Props {
  events: Change[] | null;
  slugById: Map<string, string>;
}

const pname = (id: string) => platformById(id).name;

export function ChangesPage({ events, slugById }: Props) {
  const days = events ? byDay(events, 30) : [];

  return (
    <article className="shell changes">
      <div className="pageintro">
        <p className="pageintro__label">Live</p>
        <h1 className="pageintro__title">What changed today</h1>
        <p className="changes__lede">
          Every dating, every move, every arrival — the moment {BRAND} sees it. The calendar is
          re-checked once a day and anything that moved lands here.{' '}
          <a className="changes__rss" href="/changes.xml">
            RSS
          </a>
        </p>
      </div>

      {events === null ? (
        /* Loading. A skeleton rather than a spinner, so the page does not jump
           when it fills — and only two rows, because most days are short. */
        <div className="changes__day">
          <div className="skel skel--line" style={{ width: '32%' }} />
          <div className="skel skel--line" style={{ width: '78%', marginTop: 14 }} />
          <div className="skel skel--line" style={{ width: '64%', marginTop: 10 }} />
        </div>
      ) : days.length === 0 ? (
        <div className="empty">
          <span className="empty__icon" aria-hidden="true">
            ✨
          </span>
          <h3>Nothing has moved yet</h3>
          <p>
            No dates announced, no titles added since we started keeping this log. It fills itself
            — come back after the next refresh.
          </p>
          <div className="empty__actions">
            <a className="btn btn--lg" href="/">
              What's out this week
            </a>
          </div>
        </div>
      ) : (
        days.map((day: ChangeDay) => (
          <section className="changes__day" key={day.at}>
            <h2 className="changes__date">{dayLabel(day.at)}</h2>
            <ul className="changes__list">
              {day.events.map((e: Change, i: number) => {
                /* The id carries the `~ott` suffix on a streaming-date row, and
                   the page belongs to the film — so the slug is looked up by
                   the bare id, the same rule the rails use for the same
                   reason. */
                const slug = slugById.get(e.id) ?? slugById.get(e.id.replace(/~[a-z]+$/, ''));
                return (
                  <li className="changes__item" key={`${e.at}-${e.id}-${e.kind}-${i}`}>
                    <span className={`changes__glyph changes__glyph--${e.kind}`} aria-hidden="true">
                      {GLYPH[e.kind as keyof typeof GLYPH] ?? '•'}
                    </span>
                    <div className="changes__body">
                      {slug ? (
                        <a className="changes__title" href={`/ott-release-date/${slug}`}>
                          {e.title}
                        </a>
                      ) : (
                        <span className="changes__title">{e.title}</span>
                      )}
                      <p className="changes__detail">
                        {phrase(e, pname)}
                        {e.lang && <span className="changes__lang"> · {languageName(e.lang)}</span>}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
    </article>
  );
}
