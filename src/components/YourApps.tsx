import { useMemo, useState } from 'react';
import type { Release } from '../types';
import { platform } from '../data/platforms';
import { yourApps } from '../lib/rails';
import { track, isReturning } from '../lib/track';
import { PlatformLogo } from './PlatformLogo';
import { PosterRail, relativeDay } from './PosterRail';

/**
 * "New on your apps" — the homepage's first row, for a reader who has told us
 * which apps they pay for.
 *
 * Why this exists. My apps (components/MyApps.tsx) was a filter: useful once
 * switched on, invisible otherwise, and it narrowed the board to the calendar
 * week, which by Thursday is mostly over. The question a returning reader
 * actually brings is relative to today: what landed on my apps lately, and
 * what is about to. This answers it in the first screen, without a tap.
 *
 * Decisions, and what they rest on (measured on the 13 Nov 2026 feed):
 *   Two sides on the existing rail control, Out now / Coming, rather than two
 *     rows — one row of vertical space on a phone, and a control readers
 *     already know from the rails below.
 *   App chips with counts: "Netflix 18, Prime 5" is the at-a-glance answer,
 *     and a tap narrows the whole site to that one app.
 *   A quiet week is said, not hidden: aha + Sun NXT had nothing in seven days,
 *     so the row shows their latest arrivals and says when.
 *   Hidden while any filter is on — then the rails below are already narrowed
 *     to the reader's choice, and this would repeat them.
 */
export function YourApps({
  all,
  region,
  apps,
  today,
  onOpen,
  onEdit,
  onOnly,
  onAll,
}: {
  all: Release[];
  region: string;
  apps: string[];
  today: Date;
  onOpen: (r: Release) => void;
  onEdit: () => void;
  /** Narrow the site to one app. */
  onOnly: (id: string) => void;
  /** Switch the My apps filter on. */
  onAll: () => void;
}) {
  /* Each card names the reader's own app. A film on Prime and Sun NXT showed
     "Prime" to someone who only has Sun NXT — true, and no use to them. */
  const y = useMemo(() => {
    const r = yourApps(all, region, apps, today);
    const mine = (x: Release) => ({
      ...x,
      platforms: [...x.platforms].sort((a, b) => Number(apps.includes(b)) - Number(apps.includes(a))),
    });
    return { ...r, out: r.out.map(mine), soon: r.soon.map(mine), latest: r.latest.map(mine) };
  }, [all, region, apps, today]);
  const [side, setSide] = useState<'out' | 'soon' | null>(null);
  const active = side ?? (y.out.length ? 'out' : 'soon');
  const names = apps.map((id) => platform(id).name);
  const list = names.length <= 2 ? names.join(' and ') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  const quiet = !y.out.length && !y.soon.length;
  const open = (r: Release) => {
    track('foryou_open');
    onOpen(r);
  };

  return (
    <section className="yourapps" aria-labelledby="yourapps-heading">
      <div className="yourapps__head">
        <h2 className="landedpair__title yourapps__title" id="yourapps-heading">
          <span className="yourapps__star" aria-hidden="true">
            ★
          </span>{' '}
          New on your apps
        </h2>
        <button className="yourapps__link" onClick={onEdit}>
          Edit apps
        </button>
      </div>

      {!quiet && <p className="yourapps__sum">{y.total} out or coming this week · tap an app to see only it</p>}
      <ul className="yourapps__apps" aria-label="Your apps this week">
        {y.perApp.map(({ id, count }) => (
          <li key={id}>
            <button
              className="yourapps__app"
              data-empty={count === 0 || undefined}
              onClick={() => {
                track('foryou_app');
                onOnly(id);
              }}
              aria-label={`${platform(id).name}: ${count} this week. Show only ${platform(id).name}`}
            >
              <PlatformLogo platformId={id} size={22} />
              <span className="yourapps__n">{count}</span>
            </button>
          </li>
        ))}
      </ul>

      {quiet ? (
        <>
          <p className="yourapps__quiet">
            A quiet week — nothing new on {list} in the last 7 days.
            {y.latest.length ? ' The latest to land:' : ' Nothing in the last two months either.'}
          </p>
          {y.latest.length > 0 && (
            <PosterRail
              compact
              title="Latest on your apps"
              subtitle={`${y.latest.length} titles`}
              releases={y.latest}
              onOpen={open}
              caption={(r) => relativeDay(r.releaseDate, today)}
            />
          )}
        </>
      ) : (
        <PosterRail
          compact
          title="This week"
          subtitle=""
          segments={[
            { id: 'out', label: 'Out now', count: y.out.length },
            { id: 'soon', label: 'Coming', count: y.soon.length },
          ]}
          active={active}
          onSegment={(id) => setSide(id as 'out' | 'soon')}
          releases={active === 'out' ? y.out : y.soon}
          onOpen={open}
          caption={(r) => relativeDay(r.releaseDate, today)}
        />
      )}

      {!quiet && (
        <button className="yourapps__all" onClick={onAll}>
          See everything on my apps <span aria-hidden="true">→</span>
        </button>
      )}
    </section>
  );
}

const NUDGE_KEY = 'newonott:appsnudge';
const NUDGE_REST_DAYS = 30;

/**
 * The invitation, for a reader who has not picked apps.
 *
 * Never on a first visit. An onboarding card that asked for a platform lineup
 * before the reader had seen anything was removed for exactly that (see
 * lib/prefs.ts). This appears from the second day someone comes back — the
 * point at which "what's new on my apps" is a question they actually have —
 * as one slim line, and "Not now" rests it for a month.
 */
export function YourAppsNudge({ onPick }: { onPick: () => void }) {
  const [hidden, setHidden] = useState(() => {
    if (!isReturning()) return true;
    try {
      const at = Number(localStorage.getItem(NUDGE_KEY) ?? 0);
      return Date.now() - at < NUDGE_REST_DAYS * 86_400_000;
    } catch {
      return false;
    }
  });
  if (hidden) return null;
  return (
    <aside className="yourapps yourapps--nudge" aria-label="Personalise">
      <span className="yourapps__star" aria-hidden="true">
        ★
      </span>
      <p>
        <strong>What's new on your apps?</strong> <span>Pick them once, see just yours.</span>
      </p>
      <button
        className="btn yourapps__pick"
        onClick={() => {
          track('nudge_open');
          onPick();
        }}
      >
        Pick my apps
      </button>
      <button
        className="yourapps__x"
        aria-label="Not now"
        onClick={() => {
          try {
            localStorage.setItem(NUDGE_KEY, String(Date.now()));
          } catch {
            /* ignore */
          }
          setHidden(true);
        }}
      >
        ×
      </button>
    </aside>
  );
}
