import { useState } from 'react';
import { IconCalendar, IconClose } from './icons';
import { EMAIL_ENDPOINT } from '../data/config';

/**
 * "Get this every Friday", in two places that do different jobs.
 *
 * The retention problem is real: a weekly product whose only return mechanism
 * is hoping people remember gets a launch spike and then a flat line. A footer
 * form does not fix that — on a board deliberately built to fit one screen,
 * most people never scroll far enough to see one.
 *
 * So the ask moved up, with a constraint. An onboarding card was removed from
 * this exact position for standing between the reader and the week, and a
 * subscribe block would be the same mistake wearing different clothes. This is
 * one line tall, it takes no decision to ignore, and dismissing it is permanent
 * on that device. The footer copy stays as the version that is always there for
 * anyone who waved the banner away and later changed their mind.
 *
 * No endpoint configured means neither renders. A field that quietly drops what
 * people type into it is worse than no field.
 */

type State = 'idle' | 'sending' | 'done' | 'error';

/** Opaque key, matching the others; see the note in lib/prefs.ts on the prefix. */
const KEY = 'dropday.signup';

function readState(): string {
  try {
    return localStorage.getItem(KEY) ?? '';
  } catch {
    // Blocked storage throws on read. Showing the banner again is the right
    // failure: mildly repetitive beats taking the page down.
    return '';
  }
}

function remember(value: string) {
  try {
    localStorage.setItem(KEY, value);
  } catch {
    /* The banner reappearing next visit is an acceptable cost. */
  }
}

export function EmailSignup({ variant = 'footer' }: { variant?: 'footer' | 'banner' }) {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<State>('idle');
  const [closed, setClosed] = useState(() => variant === 'banner' && readState() !== '');

  if (!EMAIL_ENDPOINT || closed) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const address = email.trim();
    if (state === 'sending' || !address) return;
    setState('sending');
    try {
      const res = await fetch(EMAIL_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        /**
         * Two names for one value, because providers disagree and a silently
         * ignored field looks identical to a working form.
         *
         * Kit (ConvertKit) reads `email_address`; Buttondown, Formspree and most
         * others read `email`. Sending both costs nothing — the one a given
         * endpoint does not recognise is discarded — and it means the form works
         * on whichever service gets chosen without a code change on launch day.
         */
        body: JSON.stringify({ email: address, email_address: address }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setState('done');
      setEmail('');
      remember('done');
      // Say thank you, then get out of the way rather than sitting there as a
      // permanent banner about something already done.
      if (variant === 'banner') setTimeout(() => setClosed(true), 2600);
    } catch {
      setState('error');
    }
  }

  const banner = variant === 'banner';

  if (state === 'done') {
    return (
      <p className={banner ? 'signup signup--banner signup--done' : 'signup signup--done'} role="status">
        Done — the week's releases will land in your inbox on Friday.
      </p>
    );
  }

  return (
    <form className={banner ? 'signup signup--banner' : 'signup'} onSubmit={submit}>
      {banner && (
        <span className="signup__pitch">
          <IconCalendar />
          {/* One element, not two. Left as siblings of the icon, the <strong>
              and the text after it become separate flex items and render as two
              columns once the row wraps on a phone. */}
          <span>
            <strong>Every Friday, in your inbox.</strong> The week's releases, one email.
          </span>
        </span>
      )}
      <label className="sr-only" htmlFor={`signup-${variant}`}>
        Email address
      </label>
      <input
        id={`signup-${variant}`}
        type="email"
        required
        placeholder="you@email.com"
        value={email}
        onChange={(e) => {
          setEmail(e.target.value);
          if (state === 'error') setState('idle');
        }}
        autoComplete="email"
      />
      <button className="btn btn--sm" type="submit" disabled={state === 'sending'}>
        {state === 'sending' ? 'Adding…' : banner ? 'Subscribe' : 'Get the Friday list'}
      </button>
      {state === 'error' && (
        <span className="signup__error" role="alert">
          That didn't send. Try again?
        </span>
      )}
      {banner && (
        <button
          type="button"
          className="signup__dismiss"
          aria-label="Dismiss"
          onClick={() => {
            remember('dismissed');
            setClosed(true);
          }}
        >
          <IconClose />
        </button>
      )}
    </form>
  );
}
