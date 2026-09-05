/**
 * A recurring Friday reminder, as a calendar file.
 *
 * This lives or dies on weekly return, which normally means push — and push
 * means a service worker plus a server holding subscriptions and VAPID keys.
 * That's a backend, and this site is deliberately a static file.
 *
 * A calendar event gets the same job done with none of it: it fires on the
 * user's own devices, needs no account, no permission prompt, no infrastructure,
 * and survives them never opening the site again. It is also trivially
 * cancellable, which a push subscription is not.
 */

import { BRAND } from '../data/brand';

const WEEKDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

function stamp(d: Date): string {
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(
    d.getUTCDate(),
  ).padStart(2, '0')}T${String(d.getUTCHours()).padStart(2, '0')}${String(
    d.getUTCMinutes(),
  ).padStart(2, '0')}00Z`;
}

/** Folds long lines at 75 octets, as iCalendar requires. */
function fold(line: string): string {
  const out: string[] = [];
  let rest = line;
  while (rest.length > 74) {
    out.push(rest.slice(0, 74));
    rest = ' ' + rest.slice(74);
  }
  out.push(rest);
  return out.join('\r\n');
}

export function weeklyReminder(siteUrl: string): Blob {
  // Next Friday at 09:00 local time, expressed in UTC so it needs no VTIMEZONE.
  const now = new Date();
  const start = new Date(now);
  start.setHours(9, 0, 0, 0);
  const daysUntilFriday = (5 - start.getDay() + 7) % 7 || 7;
  start.setDate(start.getDate() + daysUntilFriday);
  const end = new Date(start.getTime() + 15 * 60 * 1000);

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//${BRAND}//weekly release reminder//EN`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${BRAND}-weekly-${start.getTime()}@${BRAND}`,
    `DTSTAMP:${stamp(now)}`,
    `DTSTART:${stamp(start)}`,
    `DTEND:${stamp(end)}`,
    `RRULE:FREQ=WEEKLY;BYDAY=${WEEKDAY[5]}`,
    'SUMMARY:What dropped this week',
    fold(`DESCRIPTION:Everything new across every streaming platform and theatres. ${siteUrl}`),
    fold(`URL:${siteUrl}`),
    'BEGIN:VALARM',
    'TRIGGER:PT0M',
    'ACTION:DISPLAY',
    'DESCRIPTION:What dropped this week',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];

  return new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
}
