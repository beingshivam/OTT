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
  | 'share'
  | 'return_apps'
  | 'foryou_open'
  | 'foryou_app'
  | 'nudge_open';

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
let returning = false;

/** True when this device had been here on an earlier day. */
export const isReturning = () => returning;

/**
 * Once per page load: the day's visit, a return, and outbound clicks.
 *
 * A page the browser prepared in the background (index.html, speculation
 * rules) is not a visit until someone opens it, so it waits until then.
 */
export function startTracking(): void {
  const doc = document as Document & { prerendering?: boolean };
  if (doc.prerendering) {
    document.addEventListener('prerenderingchange', () => begin(), { once: true });
    return;
  }
  begin();
}

function begin(): void {
  try {
    const today = new Date().toISOString().slice(0, 10);
    let last: string | null = null;
    try {
      last = localStorage.getItem(KEY);
      localStorage.setItem(KEY, today);
      /* The first day this device came, kept so "returning" stays true for
         every load on a later day, not only the first one of it. */
      const first = localStorage.getItem(`${KEY}:first`) ?? last ?? today;
      localStorage.setItem(`${KEY}:first`, first);
      returning = first < today;
    } catch {
      /* Private mode: count the visit, not the return. */
    }
    if (last !== today) {
      track('visit');
      if (last) {
        track('return');
        /* The retention number for "My apps": returns by devices that set them. */
        try {
          if ((JSON.parse(localStorage.getItem('dropday.prefs.v1') ?? '{}').apps ?? []).length) track('return_apps');
        } catch {
          /* ignore */
        }
      }
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
