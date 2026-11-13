/*
 * Push only. This worker shows "your film is on OTT" notifications and opens
 * the page when one is tapped — nothing else.
 *
 * Deliberately no `fetch` handler: a service worker that intercepts requests
 * can serve a stale page or a stale bundle long after a deploy, and this site
 * has been bitten by stale caches before (see public/_headers). With no fetch
 * listener the browser never routes a single request through here.
 *
 * Pushes arrive empty (see worker/push.js for why); on each one this asks the
 * server what changed for this device and shows it.
 */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  event.waitUntil(
    (async () => {
      const sub = await self.registration.pushManager.getSubscription();
      let items = [];
      try {
        const res = await fetch('/api/push/pending', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ endpoint: sub?.endpoint }),
        });
        if (res.ok) items = (await res.json()).notifications ?? [];
      } catch {
        /* Fall through to the generic notice below. */
      }
      /* A push must show something — browsers penalise a silent one — so if
         the lookup failed there is still a notice that leads somewhere. */
      if (!items.length) {
        items = [{ title: 'New on OTT', body: 'A title you follow has an update.', url: '/', tag: 'newonott' }];
      }
      await Promise.all(
        items.map((n) =>
          self.registration.showNotification(n.title, {
            body: n.body,
            tag: n.tag,
            icon: '/icon-192.png',
            badge: '/icon-192.png',
            data: { url: n.url },
          }),
        ),
      );
    })(),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url ?? '/', self.location.origin).href;
  event.waitUntil(
    (async () => {
      const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const same = open.find((c) => c.url === url);
      if (same) return same.focus();
      return self.clients.openWindow(url);
    })(),
  );
});
