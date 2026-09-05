import { useState } from 'react';
import { EMAIL_ENDPOINT } from '../data/config';

/**
 * One line in the footer, for people who would rather be told than remember.
 *
 * The retention problem this exists for is real: a weekly product whose only
 * return mechanism is "hope they come back" gets a launch spike and a flat line
 * after it. But an interstitial or a modal would undo the thing that makes this
 * page worth returning to — we removed an onboarding card for exactly that
 * reason — so this sits at the bottom, asks once, and never asks again.
 *
 * No endpoint configured means no form. Better to show nothing than a field
 * that quietly drops what people type into it.
 */

type State = 'idle' | 'sending' | 'done' | 'error';

export function EmailSignup() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<State>('idle');

  if (!EMAIL_ENDPOINT) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (state === 'sending' || !email.trim()) return;
    setState('sending');
    try {
      const res = await fetch(EMAIL_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setState('done');
      setEmail('');
    } catch {
      setState('error');
    }
  }

  if (state === 'done') {
    return (
      <p className="signup signup--done" role="status">
        Done — you'll get the list on Friday.
      </p>
    );
  }

  return (
    <form className="signup" onSubmit={submit}>
      <label className="sr-only" htmlFor="signup-email">
        Email address
      </label>
      <input
        id="signup-email"
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
        {state === 'sending' ? 'Adding…' : 'Get the Friday list'}
      </button>
      {state === 'error' && (
        <span className="signup__error" role="alert">
          That didn't send. Try again?
        </span>
      )}
    </form>
  );
}
