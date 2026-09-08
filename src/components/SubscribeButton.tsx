import { useEffect, useRef, useState } from 'react';
import { IconMail } from './icons';
import { EmailSignup } from './EmailSignup';
import { EMAIL_ENDPOINT } from '../data/config';

/**
 * The subscribe ask that is always there.
 *
 * The banner above the board already asks once, well: one line, impossible to
 * miss, and dismissing it is permanent on that device. What it cannot do is
 * ask twice. Someone who waves it away in their first week and decides in
 * their third that they would like the email has one route left — scrolling to
 * the footer, which is the exact behaviour the banner exists because readers
 * do not have.
 *
 * So this is the other half, and deliberately a different shape. The banner is
 * the ask you did not have to look for; this is the one that is there when you
 * go looking. It costs no vertical space at all, which is what makes keeping
 * both honest — the header work this site has already done was about not
 * spending the fold on chrome, and an icon in a row that exists spends none.
 *
 * Hidden entirely when no endpoint is configured, matching EmailSignup: a
 * control that opens a form which cannot store anything is worse than no
 * control.
 */
export function SubscribeButton() {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  // Same dismissal rules as the share menu, so the header's two popovers
  // behave identically rather than each having their own idea.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!EMAIL_ENDPOINT) return null;

  return (
    <div className="subscribe" ref={wrap}>
      <button
        className="iconbtn"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Get the weekly email"
        title="Get the weekly email"
      >
        <IconMail />
      </button>

      {open && (
        <div className="subscribe__menu" role="dialog" aria-label="Get the weekly email">
          <p className="subscribe__pitch">
            <strong>Every Friday, in your inbox.</strong> The week's releases, one email —
            starting with this one, now.
          </p>
          {/* The footer variant rather than the banner: this popover is already
              the reader's own decision to open, so it must not be dismissible
              from inside, and it should still render for somebody who waved
              the banner away. */}
          <EmailSignup />
        </div>
      )}
    </div>
  );
}
