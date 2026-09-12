// QMP Inspect service worker (R59-R60): makes the app installable and keeps a previously-opened
// page usable if signal drops mid-inspection — the realistic field scenario (an inspector opens a
// checklist with good signal, then loses it walking into a switchroom), not "works from a cold
// start with zero connectivity ever". Hand-rolled rather than Workbox: the app has exactly two
// caching needs (app shell + same-origin navigations), which don't justify a new dependency.
//
// Deliberately does NOT intercept: cross-origin requests (Supabase API/Storage — always go to the
// network, since caching those could serve stale or wrong-tenant data) or POST requests (Server
// Actions are POST-only and can never be meaningfully cached; the app-level offline queue in
// lib/offline/ is what makes those resilient to being offline, not this service worker).

const CACHE_VERSION = "v2";
const APP_SHELL_CACHE = `qmp-inspect-shell-${CACHE_VERSION}`;
const RUNTIME_CACHE = `qmp-inspect-runtime-${CACHE_VERSION}`;
const OFFLINE_URL = "/offline.html";

const APP_SHELL_URLS = [OFFLINE_URL, "/manifest.webmanifest", "/icon.svg", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(APP_SHELL_CACHE).then((cache) => cache.addAll(APP_SHELL_URLS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== APP_SHELL_CACHE && key !== RUNTIME_CACHE)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Never touch cross-origin (Supabase) or non-GET requests — see header comment.
  if (url.origin !== self.location.origin || request.method !== "GET") return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  // Static build assets (_next/static, icons, etc.) rarely change per-deploy and are safe to
  // cache-first; everything else same-origin (RSC data fetches, images) gets network-first so a
  // stale cache never silently outlives a real update once connectivity is back.
  if (url.pathname.startsWith("/_next/static/") || APP_SHELL_URLS.includes(url.pathname)) {
    event.respondWith(cacheFirst(request));
  } else {
    event.respondWith(networkFirstRuntime(request));
  }
});

async function networkFirstNavigation(request) {
  try {
    const response = await fetch(request);
    const cache = await caches.open(RUNTIME_CACHE);
    cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    const offline = await caches.match(OFFLINE_URL);
    return offline ?? Response.error();
  }
}

async function networkFirstRuntime(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    throw new Error("Offline and no cached response available.");
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(APP_SHELL_CACHE);
    cache.put(request, response.clone());
  }
  return response;
}
