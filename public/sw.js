// HealthTrack service worker
// ------------------------------------------------------------------
// Two jobs (plus: hands off /.netlify/ function URLs, see fetch handler):
//   1. Cache a couple of rarely-changing static assets (icons) for
//      offline resilience.
//   2. Exist at all, so that ServiceWorkerRegistration.showNotification()
//      works reliably — on iOS 16.4+, notifications fired from an
//      installed home-screen web app are far more consistent through a
//      service worker registration than the bare `new Notification()`
//      API, which iOS restricts more aggressively for that context.
//
// IMPORTANT — network-first for the app itself:
// An earlier version of this file cached index.html (and everything
// else) CACHE-FIRST. That meant once a browser installed this worker,
// it kept serving that one frozen snapshot of index.html forever,
// completely ignoring every new version deployed to Netlify afterwards
// — no amount of redeploying fixed anything for someone who'd already
// visited once. That was the real cause behind "my fixes never seem to
// show up." This version fetches index.html / manifest.json / sw.js
// itself from the NETWORK FIRST every time, only falling back to a
// cached copy if there's truly no connection. Only the two icon PNGs
// (which never change) are cache-first.
//
// v21: real background push is wired up now. A Netlify Scheduled Function
// (netlify/functions/check-reminders.js) runs hourly, checks each device's synced
// med/appointment schedule, and sends a Web Push message through VAPID when
// something's due — this fires even if the app/browser is fully closed, which the
// old setInterval-based in-app checks never could. The 'push' handler below is no
// longer a stub; it's what actually displays those notifications.

const CACHE_NAME = 'healthtrack-cache-v25b'; // v25b: notification body includes the dose time; header clears the iOS status bar. v25: notification title now leads with the medicine name; backup reminder; server log counts sent/failed. (v24: Three changes. (1) The Web Push (VAPID) public key is no longer hard-coded in index.html: the page fetches it from the new netlify/functions/vapid.js (reads the VAPID_PUBLIC_KEY env var), so each person who deploys their own copy uses their own key pair; the same function has a one-time ?setup=1 helper page that generates a key pair on the person's own site and refuses once VAPID_PRIVATE_KEY is set. (2) The app name is editable in the "ข้อมูล" tab (stored in localStorage, defaults to the neutral "HealthTrack"). (3) The "ข้อมูล" tab was cleaned up: removed the obsolete drag-and-drop deploy card, rewrote outdated notification text that still said no push server exists, merged the two notification boxes into step 1/step 2. check-reminders.js now normalizes VAPID_SUBJECT and warns if it is still the placeholder. (4) the home "ยาที่ต้องทานวันนี้" table now has a column for every medicine time incl. custom times (it only knew the 4 presets), the meds tab no longer prints a custom time twice, push ignores a stale "กินแล้ว" tick from a previous day and the schedule is re-synced to the server on every app open. (5) sw.js itself now bypasses /.netlify/ paths so function responses (including the one-time key helper page) are never cached. Bumped so installed PWAs drop the cached v23 index.html.)
const STATIC_CACHE_FIRST = ['icon-192.png', 'icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_CACHE_FIRST))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return; // don't touch cross-origin (CDN) requests

  // v24: never intercept or cache the Netlify Functions. The one-time key helper page
  // (/.netlify/functions/vapid?setup=1) shows a freshly generated PRIVATE key; the
  // network-first branch below caches every OK same-origin GET, which would leave that page
  // (and the key) sitting in this browser's Cache Storage and could serve it offline later.
  // Function responses are always live data anyway, so let the browser go straight to the network.
  if (url.pathname.startsWith('/.netlify/')) return;

  const isStaticAsset = STATIC_CACHE_FIRST.some((name) => url.pathname.endsWith('/' + name));

  if (isStaticAsset) {
    // Cache-first: these files never change, so prefer the cached copy and skip the network.
    event.respondWith(
      caches.match(event.request).then((cached) => cached || fetch(event.request).then((res) => {
        if (res.ok) { const clone = res.clone(); caches.open(CACHE_NAME).then((c) => c.put(event.request, clone)); }
        return res;
      }))
    );
    return;
  }

  // Network-first for everything else (index.html, manifest.json, sw.js itself):
  // always try to get the latest deployed version; only fall back to whatever
  // was last cached if the network request fails (i.e. actually offline).
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        if (res.ok) { const clone = res.clone(); caches.open(CACHE_NAME).then((c) => c.put(event.request, clone)); }
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});

self.addEventListener('push', (event) => {
  let data = { title: 'HealthTrack', body: 'คุณมีการแจ้งเตือนใหม่' };
  try { data = event.data ? event.data.json() : data; } catch (e) { /* plain text payload */ }
  event.waitUntil(
    self.registration.showNotification(data.title, { body: data.body, icon: 'icon-192.png', badge: 'icon-192.png' })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then((list) => {
      for (const c of list) { if ('focus' in c) return c.focus(); }
      if (clients.openWindow) return clients.openWindow('./index.html');
    })
  );
});
