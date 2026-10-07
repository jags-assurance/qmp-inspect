// QMP Inspect service worker (R59-R60): makes the app installable and keeps previously-opened
// field pages (checklists, inspections, standalone assignments, start-work) usable if signal drops
// mid-inspection or the page is reloaded / relaunched without signal. Hand-rolled rather than
// Workbox: the caching needs are small and specific.
//
// What is cached, and how it is kept safe on shared devices:
//  - Static build assets (_next/static, icons, manifest, offline.html): cache-first.
//  - Field-page HTML (allow-listed paths only): network-first, with the last good copy served when the
//    network fails. These pages carry personal data, so they live in a cache NAMED AFTER THE SIGNED-IN
//    USER (the page registers its user id via postMessage). Registering a different user deletes every
//    other user's page cache, and visiting /login (sign-out lands there) clears them all. A response
//    that was redirected (expired session -> login) is never stored.
//  - Never touched: cross-origin requests (Supabase API/Storage), non-GET requests (Server Actions are
//    POST-only; the app-level outbox in lib/offline/ is what makes writes resilient), /api/*, and RSC
//    data requests.
//
// Updates: a new worker WAITS; the page shows "Update available" and only asks it to take over
// (SKIP_WAITING) when the user clicks Reload and no queued work is mid-flight.

const CACHE_VERSION = "v5";
const APP_SHELL_CACHE = `qmp-inspect-shell-${CACHE_VERSION}`;
const META_CACHE = `qmp-inspect-meta-${CACHE_VERSION}`;
const PAGES_PREFIX = `qmp-inspect-pages-${CACHE_VERSION}-`;
const OFFLINE_URL = "/offline.html";
const USER_KEY = "/__qmp/active-user";
const MAX_PAGES = 40;

const APP_SHELL_URLS = [OFFLINE_URL, "/manifest.webmanifest", "/icon.svg", "/icon-192.png", "/icon-512.png"];

// Pages worth having when signal drops: the field-execution surface only.
const CACHEABLE_PAGE_PREFIXES = ["/inspect/checklists/", "/inspect/inspections/", "/inspect/standalone/", "/inspect/start-work"];

function isCacheablePage(pathname) {
  return CACHEABLE_PAGE_PREFIXES.some((p) => pathname === p || pathname.startsWith(p));
}

self.addEventListener("install", (event) => {
  // No skipWaiting here: an update must not take over a page mid-form. See SKIP_WAITING below.
  event.waitUntil(caches.open(APP_SHELL_CACHE).then((cache) => cache.addAll(APP_SHELL_URLS)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => {
              if (key === APP_SHELL_CACHE || key === META_CACHE) return false;
              if (key.startsWith(PAGES_PREFIX)) return false;
              return true;
            })
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

async function getActiveUser() {
  try {
    const cache = await caches.open(META_CACHE);
    const hit = await cache.match(USER_KEY);
    return hit ? await hit.text() : null;
  } catch {
    return null;
  }
}

function pagesCacheName(userId) {
  return PAGES_PREFIX + userId.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 64);
}

async function deleteAllPageCaches(exceptName) {
  const keys = await caches.keys();
  await Promise.all(keys.filter((k) => k.startsWith(PAGES_PREFIX) && k !== exceptName).map((k) => caches.delete(k)));
}

async function setActiveUser(userId) {
  const meta = await caches.open(META_CACHE);
  await meta.put(USER_KEY, new Response(userId));
  await deleteAllPageCaches(pagesCacheName(userId));
}

async function trimCache(cache) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - MAX_PAGES; i++) await cache.delete(keys[i]);
}

async function storePage(userId, requestUrl, response) {
  const cache = await caches.open(pagesCacheName(userId));
  await cache.put(requestUrl, response);
  await trimCache(cache);
}

self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "SKIP_WAITING") {
    self.skipWaiting();
  } else if (data.type === "REGISTER_USER" && typeof data.userId === "string" && data.userId) {
    event.waitUntil(setActiveUser(data.userId));
  } else if (data.type === "CLEAR_PAGES") {
    event.waitUntil(deleteAllPageCaches(null));
  } else if (data.type === "CACHE_PAGES" && Array.isArray(data.urls)) {
    event.waitUntil(
      (async () => {
        const userId = typeof data.userId === "string" && data.userId ? data.userId : await getActiveUser();
        if (!userId) return;
        for (const raw of data.urls.slice(0, 20)) {
          try {
            const url = new URL(raw, self.location.origin);
            if (url.origin !== self.location.origin || !isCacheablePage(url.pathname)) continue;
            const response = await fetch(url.href, { credentials: "same-origin", headers: { Accept: "text/html" } });
            const type = response.headers.get("content-type") || "";
            if (response.ok && !response.redirected && type.includes("text/html")) {
              await storePage(userId, url.pathname + url.search, response);
            }
          } catch {
            // Best-effort prefetch (offline etc.).
          }
        }
      })()
    );
  }
});

async function handleNavigation(event) {
  const request = event.request;
  const url = new URL(request.url);

  // Sign-out lands on /login: drop every cached personal page on this device.
  if (url.pathname === "/login") event.waitUntil(deleteAllPageCaches(null));

  try {
    const response = await fetch(request);
    if (isCacheablePage(url.pathname) && response.ok && !response.redirected) {
      const type = response.headers.get("content-type") || "";
      if (type.includes("text/html")) {
        const copy = response.clone();
        event.waitUntil(
          (async () => {
            const userId = await getActiveUser();
            if (userId) await storePage(userId, url.pathname + url.search, copy);
          })().catch(() => undefined)
        );
      }
    }
    return response;
  } catch {
    if (isCacheablePage(url.pathname)) {
      const userId = await getActiveUser();
      if (userId) {
        const cache = await caches.open(pagesCacheName(userId));
        const cached = await cache.match(url.pathname + url.search);
        if (cached) return cached;
      }
    }
    return (await caches.match(OFFLINE_URL)) ?? Response.error();
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Never touch cross-origin (Supabase) or non-GET requests — see header comment.
  if (url.origin !== self.location.origin || request.method !== "GET") return;

  if (request.mode === "navigate") {
    event.respondWith(handleNavigation(event));
    return;
  }
  if (url.pathname.startsWith("/api/") || request.headers.get("RSC") || url.searchParams.has("_rsc")) return;

  // Static build assets rarely change per deploy and are safe to cache-first; everything else
  // (images, data) is left to the network.
  if (url.pathname.startsWith("/_next/static/") || APP_SHELL_URLS.includes(url.pathname)) {
    event.respondWith(cacheFirst(request));
  }
});

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
