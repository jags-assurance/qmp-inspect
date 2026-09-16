"use client";

import { useEffect, useRef } from "react";
import { signOutAction } from "@/lib/auth/actions";

const IDLE_TIMEOUT_MS = 20 * 60 * 1000; // 20 minutes
const ACTIVITY_THROTTLE_MS = 1000; // ignore activity bursts finer than this

const ACTIVITY_EVENTS = ["mousemove", "keydown", "click", "touchstart"] as const;

/**
 * Signs the user out after 20 minutes of no real user activity — this app runs on shared field
 * tablets that get left logged in on a job site, so an idle session is a real handover risk.
 * Mounted once in AppShell so it's active on every authenticated page. No warning modal; the
 * round-table ask was the timeout itself, not an "are you still there" UX.
 */
export function IdleTimeout() {
  const lastActivityRef = useRef(Date.now());

  useEffect(() => {
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout>;

    const signOutForIdle = () => {
      if (cancelled) return;
      cancelled = true;
      void signOutAction().catch(() => {
        // signOutAction redirects via a thrown Next.js redirect signal; anything else is a
        // best-effort sign-out, so fall back to a hard redirect either way.
      });
      window.location.href = "/login";
    };

    const scheduleTimeout = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(signOutForIdle, IDLE_TIMEOUT_MS);
    };

    const onActivity = () => {
      const now = Date.now();
      if (now - lastActivityRef.current < ACTIVITY_THROTTLE_MS) return;
      lastActivityRef.current = now;
      scheduleTimeout();
    };

    for (const eventName of ACTIVITY_EVENTS) {
      window.addEventListener(eventName, onActivity, { passive: true });
    }
    scheduleTimeout();

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
      for (const eventName of ACTIVITY_EVENTS) {
        window.removeEventListener(eventName, onActivity);
      }
    };
  }, []);

  return null;
}
