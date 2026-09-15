const CACHE = "porar-khata-v16";
const ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./firebase-sync.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Tapping a system notification should focus/open the app AND jump to the
// screen that notification is about (e.g. a message notification -> বার্তা tab),
// instead of just opening to whatever screen happened to be showing before.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetView = (event.notification.data && event.notification.data.view) || "dashboard";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) {
          client.postMessage({ type: "notification-click", view: targetView });
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(`./?view=${targetView}`);
      }
    })
  );
});

// Network-first: always try to get the latest file first (so updates show up
// immediately when online). Only fall back to the cached copy when offline.
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    fetch(e.request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const clone = networkResponse.clone();
          caches.open(CACHE).then((cache) => cache.put(e.request, clone));
        }
        return networkResponse;
      })
      .catch(() => caches.match(e.request))
  );
});
