import { useEffect, useMemo, useRef, useState } from 'react';
import { IconClose, IconSearch } from './icons';
import {
  EMPTY,
  askRemote,
  localMatches,
  placeholderFor,
  recallRemote,
  rememberRemote,
  withoutLocal,
  type RemoteHit,
  type SearchState,
} from '../lib/globalSearch';
import { platform } from '../data/platforms';
import { formatDay } from '../lib/week';
import type { Release } from '../types';

/**
 * One box, two corpora, and the seam left visible.
 *
 * The old header search filtered the board and nothing else, over the 963 rows
 * the browser happens to have. That answers "is this in the week I'm looking
 * at" — but nobody types into a search box to ask that. They type a name
 * because they want to know where to watch it, and on a site about Indian film
 * "Rajinikanth" returned nothing at all.
 *
 * So the box now asks two things at once, and shows the answers apart:
 *
 *   On New on OTT   rows the site can actually answer about — platform, date,
 *                   and a page
 *   People          actors and directors, which the site has never indexed
 *   Everywhere else what TMDB knows and this calendar does not
 *
 * The third section is the honest one and the reason they are not merged. A
 * ranked blend would bury the two rows that say "Netflix, Friday" under twenty
 * that say only "this film exists" — and the difference between those is the
 * entire value of the site.
 */

interface Props {
  value: string;
  onChange: (value: string) => void;
  /** Everything loaded: the calendar, plus the back catalogue once it's in. */
  corpus: Release[];
  /** Opens the detail sheet for a row that has no page of its own. */
  onOpen: (release: Release) => void;
}

/** Below this the header cannot hold the wordmark and a field at once, so the
 *  wordmark stands down (see .logo__word in the stylesheet) and the "/" hint
 *  comes off the field. */
const ROOM_FOR_A_FIELD = 720;
/** Long enough that a fast typist spends one request on a word, short enough
 *  that the list feels like it is keeping up. */
const SETTLE_MS = 220;

/*
 * How many of each fit before the panel starts scrolling.
 *
 * Twelve rows is about 560px, which is the panel's cap — and the third section
 * has to be visible without scrolling, because it is the whole point of the
 * change. A dropdown that only ever shows the six rows the site already had
 * has not gained a million titles from where the reader is sitting. The full
 * local list is on the board underneath either way.
 */
const LOCAL_ROWS = 5;
const PEOPLE_ROWS = 2;
const ELSEWHERE_ROWS = 5;

type Row =
  | { key: string; kind: 'local'; release: Release }
  | { key: string; kind: 'remote'; hit: RemoteHit };

export function GlobalSearch({ value, onChange, corpus, onOpen }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [wide, setWide] = useState(
    () => typeof window !== 'undefined' && window.innerWidth >= ROOM_FOR_A_FIELD,
  );
  const [focused, setFocused] = useState(false);
  const [remote, setRemote] = useState<SearchState>(() => ({
    ...EMPTY,
    remote: typeof window !== 'undefined' && recallRemote(),
  }));
  const [cursor, setCursor] = useState(-1);

  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${ROOM_FOR_A_FIELD}px)`);
    const read = () => setWide(mq.matches);
    read();
    mq.addEventListener('change', read);
    return () => mq.removeEventListener('change', read);
  }, []);

  /*
   * The capability probe.
   *
   * An empty query costs the Worker no upstream call — it exists so the box can
   * learn whether it is allowed to print "1M+" before anybody types. Without a
   * credential bound the proxy says so, and the placeholder stops making a
   * claim it cannot keep.
   */
  useEffect(() => {
    let live = true;
    askRemote('').then((s) => {
      if (!live) return;
      rememberRemote(s.remote);
      setRemote((prev) => ({ ...prev, remote: s.remote }));
    });
    return () => {
      live = false;
    };
  }, []);

  const query = value.trim();

  /* The local half, recomputed on the keystroke. No debounce: it is a substring
     scan over rows already in memory, and making the reader wait 220ms for an
     answer the browser has is the kind of delay that reads as slowness. */
  const local = useMemo(() => localMatches(corpus, query, LOCAL_ROWS), [corpus, query]);

  /* The remote half, debounced and abortable. Each keystroke cancels the last
     request rather than racing it — otherwise "kan", "kant", "kanta" can land
     out of order and the list settles on the wrong word. */
  useEffect(() => {
    if (query.length < 2) {
      setRemote((prev) => ({ ...EMPTY, remote: prev.remote }));
      return;
    }
    const ac = new AbortController();
    const t = setTimeout(async () => {
      const s = await askRemote(query, ac.signal);
      if (ac.signal.aborted) return;
      /* A failed request must not retract the capability: the box can still
         reach TMDB, this one query did not come back. */
      setRemote((prev) => ({ ...s, remote: s.remote || prev.remote }));
    }, SETTLE_MS);
    return () => {
      clearTimeout(t);
      ac.abort();
    };
  }, [query]);

  const people = useMemo(
    () => remote.hits.filter((h): h is RemoteHit => h.kind === 'person').slice(0, PEOPLE_ROWS),
    [remote.hits],
  );
  const elsewhere = useMemo(
    () => withoutLocal(remote.hits.filter((h) => h.kind !== 'person'), corpus).slice(0, ELSEWHERE_ROWS),
    [remote.hits, corpus],
  );

  /* One flat list behind the headings, because the arrow keys move through what
     is on screen and do not care which corpus a row came from. The third
     section is not in it: those rows do nothing when activated, and a cursor
     that steps into six dead ends is worse than one that stops. */
  const rows: Row[] = useMemo(
    () => [
      ...local.map((r) => ({ key: `l:${r.id}`, kind: 'local' as const, release: r })),
      ...people.map((h) => ({ key: `p:${h.id}`, kind: 'remote' as const, hit: h })),
    ],
    [local, people],
  );
  const empty = !local.length && !people.length && !elsewhere.length;

  useEffect(() => setCursor(-1), [query]);

  const open = focused && query.length >= 2;

  // Dismiss on an outside press, like every other popover in this header.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setFocused(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // "/" to search, from anywhere on the page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      const typing = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
      if (e.key === '/' && !typing) {
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  function pick(row: Row) {
    if (row.kind === 'local') {
      const { release } = row;
      /* A page when there is one — it is prerendered, shareable and the thing
         a search result should lead to. The sheet only for rows the build did
         not give a page. */
      if (release.slug) window.location.href = `/ott-release-date/${release.slug}`;
      else {
        onOpen(release);
        setFocused(false);
      }
      return;
    }
    /* A person is a query, not a destination: the site has no page for one, but
       it does index cast lists, so their full name is the most useful thing to
       put in the box. */
    if (row.hit.kind === 'person' && row.hit.name) {
      onChange(row.hit.name);
      input.current?.focus();
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      if (value) onChange('');
      else input.current?.blur();
      return;
    }
    if (!open || !rows.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      /* -1 is the field itself, and it stays in the cycle: arrowing back up
         past the first row has to return you to what you typed, or a
         half-finished query becomes unreachable without the mouse. */
      setCursor((c) => {
        const next = c + step;
        if (next < -1) return rows.length - 1;
        if (next >= rows.length) return -1;
        return next;
      });
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (cursor >= 0) pick(rows[cursor]);
      /* Enter with nothing selected is not nothing. The board underneath is
         already showing every match for this query — far more than the five
         rows up here — so the panel gets out of the way rather than sitting
         over the answer. */
      else setFocused(false);
    }
  }

  /*
   * The field is drawn at every width, including 360px.
   *
   * It used to collapse to a 34px circle below 720, because the header held
   * six controls and something had to give. It holds four now, and the one
   * that gave was the wrong one: on a phone — which is most of this site's
   * traffic — the single thing a reader arrives wanting was a tap away behind
   * an icon. What gives instead is the wordmark, below 520px, where the play
   * mark carries the link home on its own.
   */
  return (
    <div className="gsearch" ref={wrap}>
      <div className="search">
        <IconSearch />
        <input
          ref={input}
          type="search"
          placeholder={placeholderFor(remote.remote)}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-expanded={open}
          aria-controls="gsearch-results"
          aria-autocomplete="list"
          aria-activedescendant={cursor >= 0 ? `gsearch-row-${cursor}` : undefined}
          aria-label="Search films, series and people"
        />
        {value ? (
          <button className="search__clear" onClick={() => onChange('')} aria-label="Clear search">
            <IconClose />
          </button>
        ) : (
          wide && <kbd>/</kbd>
        )}
      </div>

      {open && (
        <div className="gsearch__panel" id="gsearch-results" role="listbox">
          {local.length > 0 && (
            <Section label="On New on OTT">
              {local.map((r, i) => (
                <LocalRow
                  key={r.id}
                  release={r}
                  id={`gsearch-row-${i}`}
                  active={cursor === i}
                  onPick={() => pick(rows[i])}
                />
              ))}
            </Section>
          )}

          {people.length > 0 && (
            <Section label="People">
              {people.map((h, i) => (
                <PersonRow
                  key={h.id}
                  hit={h}
                  id={`gsearch-row-${local.length + i}`}
                  active={cursor === local.length + i}
                  onPick={() => pick(rows[local.length + i])}
                />
              ))}
            </Section>
          )}

          {elsewhere.length > 0 && (
            /* Named for what it is. "More results" would imply the site can
               tell you something about these, and it cannot — there is no
               Indian streaming date for them, which is the only thing this
               site exists to say. */
            <Section label="Everywhere else" note="Found on TMDB — not in the India release calendar">
              {elsewhere.map((h) => (
                <TitleRow key={h.id} hit={h} />
              ))}
            </Section>
          )}

          {empty && (
            <p className="gsearch__none">
              {remote.degraded
                ? `Nothing here matches “${query}”, and the wider search didn’t answer just now.`
                : `Nothing matches “${query}”.`}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Section({
  label,
  note,
  children,
}: {
  label: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    /* A group rather than more options: the heading is the whole point of the
       panel, and a listbox whose children are headings and rows in one flat
       run announces the seam as another result. */
    <div className="gsearch__section" role="group" aria-label={note ? `${label} — ${note}` : label}>
      <p className="gsearch__label" aria-hidden="true">
        {label}
        {note && <span>{note}</span>}
      </p>
      {children}
    </div>
  );
}

/**
 * A thumbnail that fails to an empty frame rather than to a broken-image glyph.
 *
 * Roughly one row in eight has no poster at all, and TMDB's image host is the
 * single flakiest dependency this site has. The frame is drawn either way, so
 * a failed load costs nothing and shifts nothing.
 */
function Thumb({ src, round }: { src?: string | null; round?: boolean }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className={`gsearch__art${round ? ' gsearch__art--round' : ''}`}>
      {src && !failed ? (
        <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} />
      ) : null}
    </span>
  );
}

/** Where and when — the one thing a result from this site can say that a
 *  result from anywhere else cannot. */
function whereLine(r: Release): string {
  const where = r.platforms.filter((p) => p !== 'theatres').map((p) => platform(p).name);
  const d = formatDay(r.releaseDate);
  const when = `${d.day} ${d.month}`;
  if (!where.length) return `In cinemas · ${when}`;
  return `${where.slice(0, 2).join(', ')} · ${when}`;
}

function LocalRow({
  release,
  id,
  active,
  onPick,
}: {
  release: Release;
  id: string;
  active: boolean;
  onPick: () => void;
}) {
  return (
    <button
      className="gsearch__row"
      id={id}
      role="option"
      aria-selected={active}
      data-active={active || undefined}
      onClick={onPick}
    >
      <Thumb src={release.posterUrl} />
      <span className="gsearch__text">
        <strong>{release.title}</strong>
        <small>{whereLine(release)}</small>
      </span>
    </button>
  );
}

function PersonRow({
  hit,
  id,
  active,
  onPick,
}: {
  hit: RemoteHit;
  id: string;
  active: boolean;
  onPick: () => void;
}) {
  return (
    <button
      className="gsearch__row"
      id={id}
      role="option"
      aria-selected={active}
      data-active={active || undefined}
      onClick={onPick}
    >
      <Thumb src={hit.image} round />
      <span className="gsearch__text">
        <strong>{hit.name}</strong>
        <small>{[hit.role, hit.knownFor?.join(', ')].filter(Boolean).join(' · ')}</small>
      </span>
    </button>
  );
}

/* Not a button. There is nowhere to send somebody: the site has no page for a
   title it has no Indian release date for, and a row that looks clickable and
   lands on an empty board is worse than a row that plainly answers "yes, that
   film exists, we don't have a date for it". */
function TitleRow({ hit }: { hit: RemoteHit }) {
  return (
    <div className="gsearch__row gsearch__row--flat">
      <Thumb src={hit.image} />
      <span className="gsearch__text">
        <strong>{hit.title}</strong>
        <small>
          {[hit.kind === 'series' ? 'Series' : 'Film', hit.year].filter(Boolean).join(' · ')}
        </small>
      </span>
    </div>
  );
}
