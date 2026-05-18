/* eslint-disable no-restricted-globals */
const STATIC_CACHE = "senda-static-v1";

// Pre-cache the app shell at install time.
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(["/", "/index.html"]))
      .then(() => self.skipWaiting())
  );
});

// Remove old cache versions on activate.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== STATIC_CACHE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Only intercept same-origin requests; let API calls (different origin) pass through.
  if (url.origin !== self.location.origin) return;

  // Navigation requests (page loads): network-first, fall back to index.html so
  // the React SPA handles routing while offline.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const clone = response.clone();
          caches.open(STATIC_CACHE).then((cache) => cache.put(request, clone));
          return response;
        })
        .catch(() =>
          caches
            .match("/index.html")
            .then((r) => r ?? new Response("Offline", { status: 503 }))
        )
    );
    return;
  }

  // Hashed static assets (/static/js, /static/css, etc.): cache-first.
  // These never change content once their hash is baked into the filename.
  if (url.pathname.startsWith("/static/")) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ??
          fetch(request).then((response) => {
            if (response.ok) {
              const clone = response.clone();
              caches.open(STATIC_CACHE).then((cache) => cache.put(request, clone));
            }
            return response;
          })
      )
    );
  }
});
