import { useEffect, useState, type FormEvent } from 'react';
import { emailFollow, follow, isFollowing, mailAvailable, pushSupport, unfollow } from '../lib/push';

/**
 * "Notify me when it streams" — the reason to come back.
 *
 * Shown only where the question is still open: a title with no OTT date. The
 * person who searched "<film> OTT release date" and found "not announced" is
 * the person who wants this. See worker/push.js for the other half.
 *
 * Two channels. Browser push where the browser can take it; email where it
 * cannot (an iPhone outside a home-screen app, mostly) or where the reader has
 * blocked notifications or simply prefers it. The email form appears only once
 * the site has a sender configured, so it never collects an address it has no
 * way to write to.
 */
type Push = 'idle' | 'busy' | 'following' | 'denied' | 'failed';
type Mail = 'closed' | 'open' | 'busy' | 'done' | 'failed';

export function NotifyButton({ id, title, slug, poster }: { id: string; title: string; slug?: string; poster?: string }) {
  const [push, setPush] = useState<Push>('idle');
  const [support, setSupport] = useState<ReturnType<typeof pushSupport>>('unsupported');
  const [canMail, setCanMail] = useState(false);
  const [mail, setMail] = useState<Mail>('closed');
  const [address, setAddress] = useState('');

  useEffect(() => {
    setSupport(pushSupport());
    if (isFollowing(id)) setPush('following');
    let live = true;
    mailAvailable().then((ok) => live && setCanMail(ok));
    return () => {
      live = false;
    };
  }, [id]);

  const pushOk = support === 'ok' && push !== 'denied';
  /* Without push the form is the offer itself, so it starts open. */
  const mailShown = canMail && (mail !== 'closed' || !pushOk);

  const onPush = async () => {
    if (push === 'following') {
      setPush('busy');
      await unfollow(id);
      setPush('idle');
      return;
    }
    setPush('busy');
    setPush(await follow({ id, title, slug }));
  };

  const onMail = async (e: FormEvent) => {
    e.preventDefault();
    setMail('busy');
    setMail((await emailFollow({ id, title, slug, poster, email: address })) ? 'done' : 'failed');
  };

  if (!pushOk && !canMail && support !== 'ios-install') return null;

  return (
    <>
      {pushOk && (
        <button
          type="button"
          className="btn btn--lg"
          data-active={push === 'following' || undefined}
          aria-pressed={push === 'following'}
          disabled={push === 'busy'}
          onClick={onPush}
        >
          <span aria-hidden="true">🔔</span>
          {push === 'following' ? "We'll notify you" : 'Notify me when it streams'}
        </button>
      )}

      {mailShown &&
        (mail === 'done' ? (
          <p className="notify__hint">
            ✓ We'll email you once when {title} gets an OTT date. Check your inbox for the confirmation.
          </p>
        ) : (
          <form className="notify__mail" onSubmit={onMail}>
            <label htmlFor={`notify-mail-${id}`}>Email me when {title} streams</label>
            <div>
              <input
                id={`notify-mail-${id}`}
                type="email"
                inputMode="email"
                autoComplete="email"
                required
                placeholder="you@email.com"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
              />
              <button type="submit" className="btn" disabled={mail === 'busy'}>
                {mail === 'busy' ? 'Saving…' : 'Email me'}
              </button>
            </div>
            {mail === 'failed' && <p className="notify__hint">That didn't work — check the address and try again.</p>}
          </form>
        ))}

      {pushOk && canMail && mail === 'closed' && push !== 'following' && (
        <button type="button" className="notify__alt" onClick={() => setMail('open')}>
          or get an email instead
        </button>
      )}

      {support === 'ios-install' && (
        <p className="notify__hint">
          {canMail ? 'Prefer a phone notification? ' : `Want a ping when ${title} streams? `}On iPhone, tap Share →{' '}
          <strong>Add to Home Screen</strong>, open New on OTT from there, then tap Notify me.
        </p>
      )}
      {push === 'denied' && !canMail && (
        <p className="notify__hint">
          Notifications are blocked for this site. Allow them in your browser's site settings, then tap again.
        </p>
      )}
      {push === 'failed' && <p className="notify__hint">That didn't work — please try again in a moment.</p>}
    </>
  );
}
