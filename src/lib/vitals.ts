/**
 * Real visitors' Core Web Vitals, reported to our own Worker (worker/stats.js).
 *
 * What is sent, once per metric per visit: its name, its value, the kind of
 * page the visit landed on, and phone or desktop. No identifiers, no URL, no
 * cookie — the Worker keeps only a count per value bucket.
 *
 * Loaded after the page is idle (main.tsx), so it costs nothing at startup;
 * the browser buffers the paint, shift and input entries, so nothing is missed.
 */
import { onCLS, onFCP, onINP, onLCP, onTTFB, type Metric } from 'web-vitals';

export function pageKind(path: string): string {
  if (path === '/' || path === '') return 'home';
  if (/^\/streaming\/?$/.test(path)) return 'streaming';
  if (/^\/upcoming\/?$/.test(path)) return 'upcoming';
  if (path.startsWith('/ott-release-date/')) return 'title';
  return 'other';
}

export function startVitals(): void {
  try {
    if (navigator.webdriver || !/^https:/.test(location.protocol)) return;
    /* The page the visit landed on: tabs switch in place, but every one of
       these measures the load (or, for INP, the whole visit from it). */
    const p = pageKind(location.pathname);
    const d = window.matchMedia('(pointer: coarse)').matches ? 'mobile' : 'desktop';
    const send = (m: Metric) => {
      const body = JSON.stringify({ m: m.name, v: m.value, p, d });
      if (!navigator.sendBeacon?.('/api/v', new Blob([body], { type: 'application/json' }))) {
        void fetch('/api/v', { method: 'POST', body, keepalive: true }).catch(() => {});
      }
    };
    onLCP(send);
    onINP(send);
    onCLS(send);
    onFCP(send);
    onTTFB(send);
  } catch {
    /* Measurement never breaks the page. */
  }
}
