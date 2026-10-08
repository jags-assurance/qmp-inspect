"use client";

import { useEffect, useRef } from "react";
import { idleSignOutAction } from "@/lib/auth/actions";
import { IDLE_LOGIN_PATH } from "@/lib/auth/login-notices";

const IDLE_TIMEOUT_MS = 12 * 60 * 60 * 1000; // 12 hours
const ACTIVITY_THROTTLE_MS = 1000; // ignore activity bursts finer than this

const ACTIVITY_EVENTS = ["mousemove", "keydown", "click", "touchstart"] as const;

/**
 * Signs the user out after 12 hours of no real user activity. Originally 20 minutes — this app runs
 * on shared field tablets that get left logged in on a job site, so an idle session is a real
 * handover risk — raised to 12h on explicit request, trading that protection for not interrupting a
 * long field shift. Mounted once in AppShell so it's active on every authenticated page. No warning
 * modal; the round-table ask was the timeout itself, not an "are you still there" UX.
 */
export function IdleTimeout() {
  const lastActivityRef = useRef(0);

  useEffect(() => {
    lastActivityRef.current = Date.now();
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout>;

    const signOutForIdle = () => {
      if (cancelled) return;
      cancelled = true;
      // idleSignOutAction signs out server-side and redirects to /login with the "signed out after
      // inactivity" notice (the redirect arrives as a thrown Next.js signal). Wait for it so the hard
      // redirect below cannot cancel the request, and fall back to the same URL if it fails.
      void idleSignOutAction()
        .catch(() => {})
        .finally(() => {
          window.location.href = IDLE_LOGIN_PATH;
        });
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
