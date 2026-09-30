// Zeno Brain v0.11 service worker — Milestone A: fully-offline reopen.
// Lives at the site root so its scope ("/") covers index.html. (A worker
// under assets/ would only control assets/* and never the page itself.)
// Pattern proven in v0.1.2: cache the app shell AND the WebLLM runtime from
// esm.run after the first online load. Model weights are cached by WebLLM's
// own Cache-API backend; same-origin + esm.run traffic is handled here,
// everything else (e.g. model CDN fetches) passes through untouched.
// v0.11.1: SHELL cache name bumped again, and navigations ("/",
// "/index.html") are now NETWORK-FIRST with cache fallback, so an app
// update always lands instead of the old cache-first shell serving stale
// HTML/JS over a new deploy (the "version flashes 0.11 then reverts to
// 0.10" failure). Static assets stay cache-first. Activate still only
// deletes OUR old zeno-* caches — WebLLM's model cache (different name)
// is preserved, so the downloaded brain survives the update.
// v0.11: SHELL cache name bumped for the Phase 1 agent build. RUNTIME cache
// name is UNCHANGED on purpose — the old esm.run runtime cache is reused
// and the activate step keeps it, so an update never forces a re-cache.
// v0.10.1: cache names bumped for auto-wake + offline-honesty. Activate only
// deletes OUR old zeno-* caches — WebLLM's model cache (different name) is
// preserved across updates so the brain is never force-redownloaded.
// v0.10: cache names bumped for the iterative image fix loop.
const SHELL_CACHE = "zeno-shell-v0111";
const RUNTIME_CACHE = "zeno-runtime-v0101-storage1";

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(c => c.addAll(["./", "./index.html", "./assets/webllm-0.2.82.iife.js", "./assets/emotion-engine.js", "./assets/changelog.js", "./assets/manifest.json", "./assets/zeno-icon-192.png", "./assets/zeno-icon-512.png"]))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        // Only our own stale zeno-* shell/runtime caches. Never touch
        // WebLLM's model cache (it doesn't start with "zeno-"), so an
        // app update never forces a brain re-download.
        keys.filter(k => k !== SHELL_CACHE && k !== RUNTIME_CACHE && k.startsWith("zeno-")).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", event => {
  // v0.11.1: the page's update banner asks the waiting worker to take over now.
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", event => {
  const u = new URL(event.request.url);
  if (event.request.method !== "GET") return;

  // WebLLM runtime: serve from cache when offline, populate cache when online.
  if (u.origin === "https://esm.run") {
    event.respondWith(
      caches.open(RUNTIME_CACHE).then(async cache => {
        const hit = await cache.match(event.request);
        if (hit) return hit;
        try {
          const response = await fetch(event.request);
          if (response.ok) cache.put(event.request, response.clone());
          return response;
        } catch (e) {
          return new Response("Offline: Zeno runtime has not been cached yet.", {
            status: 503, headers: { "Content-Type": "text/plain" }
          });
        }
      })
    );
    return;
  }

  // App shell: navigations are NETWORK-FIRST (v0.11.1) so updates always
  // land; other same-origin assets stay cache-first with network refresh.
  // Offline falls back to the cached shell.
  if (u.origin === location.origin) {
    const isNav = event.request.mode === "navigate" ||
      u.pathname === "/" || u.pathname.endsWith("/index.html");
    if (isNav) {
      event.respondWith(
        fetch(event.request)
          .then(response => {
            const copy = response.clone();
            caches.open(SHELL_CACHE).then(c => c.put(event.request, copy));
            return response;
          })
          .catch(() => caches.match(event.request)
            .then(hit => hit || caches.match("./index.html")))
      );
      return;
    }
    event.respondWith(
      caches.match(event.request).then(hit => hit || fetch(event.request)
        .then(response => {
          const copy = response.clone();
          caches.open(SHELL_CACHE).then(c => c.put(event.request, copy));
          return response;
        })
        .catch(() => caches.match("./index.html")))
    );
  }
});
