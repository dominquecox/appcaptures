// AppCaptures service worker — tiny app-shell cache, zero deps.
// Bump V to force clients onto fresh assets after a deploy.
// API + JSON data stay network-first so waitlist/news never go stale.
const V = "appcaptures-v3-spacing";
const CORE = ["/", "/manifest.json", "/icons/icon-192.png", "/news/", "/changelog/"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(V).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== V).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;
  if (u.pathname.startsWith("/api/") || u.pathname.startsWith("/data/")) {
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
    return;
  }
  e.respondWith(
    caches.match(e.request).then(
      (hit) =>
        hit ||
        fetch(e.request)
          .then((r) => {
            const copy = r.clone();
            caches.open(V).then((c) => c.put(e.request, copy));
            return r;
          })
          .catch(() => caches.match("/"))
    )
  );
});
