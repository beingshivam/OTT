import { useState } from 'react';
import { IconWhatsApp, IconShare, IconCheck } from './icons';
import { whatsappHref } from '../lib/share';

/**
 * The two ways out of a title, wherever a title is shown.
 *
 * They were in one place and a half. The detail sheet had both; the title page
 * had WhatsApp and no native share, so a reader on the page most likely to be
 * arrived at from Google had one fewer way to pass it on than a reader who
 * opened the same film from the board. The sheet a search result opens had
 * neither, which made the one surface that can reach a million titles the only
 * one you could not forward anything from.
 *
 * Worth more than it looks. A forwarded message is this site's only organic
 * distribution: in India film news travels on WhatsApp, not in feeds, and the
 * message is the whole advert. Every surface that names a film should be able
 * to send it.
 *
 * WhatsApp is a link rather than a button on purpose — the hand-off is a
 * navigation, so it gets middle-click, long-press and "open in new tab" for
 * free, and it works while JavaScript is still loading. Share is a button
 * because there is nowhere to navigate to: it is the OS sheet, and a clipboard
 * copy when there is not one.
 *
 * The sentence is built by the caller, from lib/share.ts, because only the
 * caller knows which of the four states the title is in.
 */
export function ShareButtons({
  title,
  line,
  url,
}: {
  /** What the OS share sheet puts in its header. */
  title: string;
  /** The sentence, from shareLine(). */
  line: string;
  /** Where the message points. */
  url: string;
}) {
  const [copied, setCopied] = useState(false);

  async function share() {
    if (navigator.share) {
      try {
        await navigator.share({ title, text: line, url });
        return;
      } catch {
        /* Dismissed — fall through to copying rather than doing nothing. */
      }
    }
    try {
      await navigator.clipboard.writeText(`${line}\n${url}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* Clipboard blocked; nothing useful left to do. */
    }
  }

  return (
    <>
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
    </>
  );
}
