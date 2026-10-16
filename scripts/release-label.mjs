/**
 * How a release is described on a poster, in the right tense.
 *
 * Reported: "Jailer 2 hasn't released yet, it'll release on 15th." The week's
 * post labelled it "In cinemas · Thu 15 Oct" on the 9th, which reads as a film
 * playing now with a date attached. Three of the five titles on that image
 * were still days away and every one of them said "In cinemas".
 *
 * The date was right and the sentence was wrong, which is the same shape as
 * the Prime badge on a film still in cinemas and the "Not announced yet" on a
 * page whose film had just landed: a true field rendered as a claim it does
 * not support. A poster has room for one line per title, so that line has to
 * carry the tense or it will be read as the present.
 *
 * Its own module so it can be tested without a browser — the builder that
 * uses it screenshots a page, and a rule nobody can test cheaply is a rule
 * that gets tested by a reader.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const dateOf = (iso) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`;
export const dayOf = (iso) => DAYS[new Date(`${iso}T00:00:00Z`).getUTCDay()];

/** True when the date has not arrived yet, compared as plain ISO days. */
export const upcoming = (releaseDate, today) => Boolean(releaseDate) && releaseDate > today;

/**
 * The one line under a tile: where, and when, in a tense a reader can trust.
 *
 * `long` adds the weekday, which is worth the space on the hero and not on a
 * thumbnail. "from" rather than "on" because a release date is the start of
 * an availability, not a single day — a reader seeing "from 15 Oct" on the
 * 17th is still being told something true, which matters when a post is
 * forwarded days later.
 */
export function releaseLabel(where, releaseDate, today, { long = false, guessed = false } = {}) {
  const when = long ? `${dayOf(releaseDate)} ${dateOf(releaseDate)}` : dateOf(releaseDate);
  /*
   * "expected", when the service came from a release note rather than a
   * watch provider.
   *
   * DetailSheet has said "Expected on ZEE5" instead of "Watch on ZEE5" since
   * Toxic was badged on the day a contributor's note claimed, with no India
   * provider behind it. The poster builder had no such middle setting — a row
   * was confirmed and shown or unconfirmed and dropped — so the week three
   * Indian titles landed on ZEE5, Prime and Sun NXT, the OTT card showed none
   * of them and led on a French documentary instead.
   *
   * Dropping them was the wrong half of the trade. Walking this repo's own
   * history: of 180 rows ever carrying a guessed platform, 33 later gained a
   * real provider and all 33 agreed with the guess. None contradicted it. The
   * guesses are not noise; they are early. Toxic itself still has no TMDB
   * provider and is the site's best-performing page.
   */
  if (guessed) return `${where} · expected ${when}`;
  return upcoming(releaseDate, today) ? `${where} · from ${when}` : `${where} · ${when}`;
}
