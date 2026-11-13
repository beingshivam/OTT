import { useEffect, useState } from 'react';
import { follow, isFollowing, pushSupport, unfollow } from '../lib/push';

/**
 * "Notify me when it streams" — the reason to come back.
 *
 * Shown only where the question is still open: a title with no OTT date. The
 * person who searched "<film> OTT release date" and found "not announced" is
 * the person who wants this, and before this button the page could only tell
 * them to check again later. See worker/push.js for the other half.
 */
export function NotifyButton({ id, title, slug }: { id: string; title: string; slug?: string }) {
  const [state, setState] = useState<'idle' | 'busy' | 'following' | 'denied' | 'failed'>('idle');
  const [support, setSupport] = useState<ReturnType<typeof pushSupport>>('unsupported');

  useEffect(() => {
    setSupport(pushSupport());
    if (isFollowing(id)) setState('following');
  }, [id]);

  if (support === 'unsupported') return null;

  if (support === 'ios-install') {
    return (
      <p className="notify__hint">
        Want a ping when {title} streams? On iPhone, tap Share → <strong>Add to Home Screen</strong>, open
        New on OTT from there, then tap Notify me.
      </p>
    );
  }

  const onClick = async () => {
    if (state === 'following') {
      setState('busy');
      await unfollow(id);
      setState('idle');
      return;
    }
    setState('busy');
    setState(await follow({ id, title, slug }));
  };

  return (
    <>
      <button
        type="button"
        className="btn btn--lg"
        data-active={state === 'following' || undefined}
        aria-pressed={state === 'following'}
        disabled={state === 'busy'}
        onClick={onClick}
      >
        <span aria-hidden="true">🔔</span>
        {state === 'following' ? "We'll notify you" : 'Notify me when it streams'}
      </button>
      {state === 'denied' && (
        <p className="notify__hint">
          Notifications are blocked for this site. Allow them in your browser's site settings, then tap again.
        </p>
      )}
      {state === 'failed' && <p className="notify__hint">That didn't work — please try again in a moment.</p>}
    </>
  );
}
