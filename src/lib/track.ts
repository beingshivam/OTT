/**
 * Counts, sent to our own Worker (worker/stats.js). No cookies and no ids:
 * the body is just the event's name. A device counts one "visit" a day, and
 * one "return" on a day when it had been here on an earlier day.
 */
export type TrackEvent =
  | 'visit'
  | 'return'
  | 'subscribe'
  | 'follow_push'
  | 'follow_email'
  | 'myapps_set'
  | 'myapps_on'
  | 'outbound'
  | 'share';

export function track(n: TrackEvent): void {
  try {
    if (navigator.webdriver || !/^https:/.test(location.protocol)) return;
    const body = JSON.stringify({ n });
    if (!navigator.sendBeacon?.('/api/e', new Blob([body], { type: 'application/json' }))) {
      void fetch('/api/e', { method: 'POST', body, keepalive: true }).catch(() => {});
    }
  } catch {
    /* Measurement never breaks the page. */
  }
}

const KEY = 'newonott:seen';

/** Once per page load: the day's visit, a return, and outbound clicks. */
export function startTracking(): void {
  try {
    const today = new Date().toISOString().slice(0, 10);
    let last: string | null = null;
    try {
      last = localStorage.getItem(KEY);
      localStorage.setItem(KEY, today);
    } catch {
      /* Private mode: count the visit, not the return. */
    }
    if (last !== today) {
      track('visit');
      if (last) track('return');
    }
    document.addEventListener(
      'click',
      (e) => {
        const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
        if (a && a.host && a.host !== location.host && !/\/\/(www\.)?(instagram|x|twitter|facebook|wa\.me|whatsapp)/.test(a.href)) {
          track('outbound');
        }
      },
      { capture: true },
    );
  } catch {
    /* ignore */
  }
}
