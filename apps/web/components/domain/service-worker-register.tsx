"use client";

import { useEffect } from "react";

/**
 * Registers public/sw.js once the page is interactive (R59: installable PWA). No UI of its own.
 *
 * Production only. sw.js caches /_next/static/* cache-first, which is correct there (Next.js
 * content-hashes production build output, so a given URL's bytes truly never change) but actively
 * harmful under `next dev`: Turbopack can serve different chunk content under the same dev-mode URL
 * across restarts/HMR, so a dev-registered service worker ends up pairing a fresh HTML shell with a
 * stale cached JS chunk — a real, reproducible "blank page after editing a component" bug, not a
 * flaw in whatever component was being edited. Every other PWA-with-a-dev-server setup skips
 * registration in development for the same reason.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") return;
    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.error("Service worker registration failed:", err);
    });
  }, []);

  return null;
}
