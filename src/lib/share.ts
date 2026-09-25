import { platform as platformById } from '../data/platforms';
import type { Release } from '../types';

/**
 * One sentence about a title, true whatever state it is in, and the link to it.
 *
 * Sharing on this site was two half-implementations. The sheet's native share
 * built its own line — `title — Platform, Fri 18 Sep` — from `platforms[0]`,
 * which says "In cinemas" for a cinema row and names a service for a streaming
 * one, but never notices whether the thing is actually out. A film three weeks
 * away was forwarded as though it were on tonight. And it attached
 * `window.location.href`, so a title shared from the board sent the reader to
 * the homepage rather than to the film — the one link in the message that had
 * a job to do, pointing at the wrong page.
 *
 * Both of those are the same mistake the "OTT release date" button made: a
 * string written once for the state the author happened to be looking at. So
 * the sentence is built here, from the same four states the title page asks in
 * the same order, and everything that shares a title uses it.
 *
 * Why it matters more than it looks: a forwarded message is this site's only
 * organic distribution. In India film news travels on WhatsApp, not in feeds,
 * and the message is the whole advert — if it is wrong, vague, or points
 * somewhere useless, the forward is worse than nothing because it spends
 * somebody's credibility.
 */

const DAY = 86_400_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "25 Sep", and "25 Sep 2027" once the year stops being obvious. A message
 *  read on a phone wants the short form; a date eighteen months out wants the
 *  year or it reads as this year. */
function shortDate(iso: string, today: Date): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const sameYear = d.getUTCFullYear() === today.getUTCFullYear();
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}${sameYear ? '' : ` ${d.getUTCFullYear()}`}`;
}

/** Names, joined the way a person would say them. */
const names = (ids: string[]) => {
  const list = ids.map((id) => platformById(id).name);
  if (list.length <= 1) return list[0] ?? '';
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
};

export interface ShareContext {
  /** The film's own streaming date, when the caller knows it — the `~ott` row
   *  that the title page finds and the sheet does not. Given rather than looked
   *  up so this module needs no feed. */
  streamsOn?: { date: string; platforms: string[] } | null;
  /** Injected for tests, and so a message and the page it describes cannot
   *  disagree about what "today" is. */
  today?: Date;
}

/**
 * The sentence. No emoji, no exclamation, no "Check out".
 *
 * A forward competes with everything else in a chat thread, and the thing that
 * wins there is information: which film, where, and when. Decoration reads as
 * marketing, and marketing is what people scroll past.
 */
export function shareLine(release: Release, ctx: ShareContext = {}): string {
  const today = ctx.today ?? new Date();
  const streaming = release.platforms.filter((p) => p !== 'theatres');
  const daysOut = Math.floor(
    (today.getTime() - Date.parse(`${release.releaseDate}T00:00:00Z`)) / DAY,
  );
  const upcoming = daysOut < 0;
  const when = shortDate(release.releaseDate, today);

  if (streaming.length) {
    return upcoming
      ? `${release.title} lands on ${names(streaming)} on ${when}`
      : `${release.title} is streaming now on ${names(streaming)}`;
  }

  /* A cinema listing whose digital date is already known. The most useful
     message this site can send, and the one the sheet could never build
     because the date lives on a different row. */
  const dated = ctx.streamsOn;
  if (dated?.platforms.length && dated.date >= new Date(today.getTime()).toISOString().slice(0, 10)) {
    return `${release.title} is on ${names(dated.platforms)} from ${shortDate(dated.date, today)}`;
  }

  return upcoming
    ? `${release.title} opens in cinemas on ${when}`
    : `${release.title} is in cinemas now — no OTT date yet`;
}

/**
 * The same sentence for a title this site has no row for.
 *
 * Search reaches past the calendar into TMDB's million, and those titles open
 * a sheet rather than a page. They were the one place on the site you could
 * not forward anything from, which is backwards: the sheet knows which Indian
 * service carries the film, and that is exactly the message worth sending.
 *
 * Same rules as above — no emoji, no "Check out", the information is the
 * point. The tense is simpler because there is nothing to be upcoming about:
 * these are catalogue titles, either streaming somewhere in India or not.
 *
 * The year earns its place here and not in shareLine: a 2006 film shared with
 * no date reads as a new release, which is the one thing a message from this
 * site must never accidentally say.
 */
export function catalogueShareLine(
  title: string,
  year: string | null,
  platformIds: string[],
): string {
  const named = year ? `${title} (${year})` : title;
  return platformIds.length
    ? `${named} is streaming on ${names(platformIds)} in India`
    : `${named} is not streaming in India right now`;
}

/**
 * Where a forward should land: the film's own page, never the page you shared
 * from.
 *
 * `slug` means the title has a page and it is published — see build-seo, which
 * clears the field when it does not. Without one there is nothing better than
 * the current address, which is at least a page that exists.
 */
export function shareUrl(release: Release, here: string, origin: string): string {
  return release.slug ? `${origin}/ott-release-date/${release.slug}` : here;
}

/**
 * The WhatsApp hand-off.
 *
 * `wa.me` rather than `api.whatsapp.com`: it is the address WhatsApp documents,
 * it opens the installed app on a phone through a universal link, and it falls
 * through to WhatsApp Web on a desktop rather than dead-ending. No phone number
 * in the path, which is what makes it a share sheet rather than a message to
 * one contact.
 *
 * The URL goes on its own line. WhatsApp only draws a link preview — the card
 * with the poster and the title, which is most of what makes a forward worth
 * opening — when it can find a bare URL, and a line of its own is the reliable
 * way to give it one.
 */
export function whatsappHref(text: string, url: string): string {
  return `https://wa.me/?text=${encodeURIComponent(`${text}\n${url}`)}`;
}
