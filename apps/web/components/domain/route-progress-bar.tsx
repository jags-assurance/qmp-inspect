"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * Thin, top-of-viewport progress bar shown during App Router route transitions
 * (nav links, redirects, programmatic router.push). Without it, a click on a slow
 * connection gives no feedback until the new route's UI actually paints.
 *
 * App Router doesn't expose router "start" events, so we approximate: a click on any
 * same-document link starts the bar immediately (optimistic — it's cheap to cancel),
 * and a change in the committed pathname/search params — the point at which React has
 * already rendered the destination route — completes and hides it.
 */
function ProgressBarInner() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [visible, setVisible] = useState(false);
  const [width, setWidth] = useState(0);
  const growTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const routeKey = useRef(`${pathname}?${searchParams.toString()}`);

  useEffect(() => {
    function clearTimers() {
      if (growTimer.current) clearInterval(growTimer.current);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    }

    function start() {
      clearTimers();
      setVisible(true);
      setWidth(12);
      growTimer.current = setInterval(() => {
        setWidth((w) => (w < 80 ? w + (80 - w) * 0.1 + 1 : w));
      }, 200);
    }

    function findAnchor(target: EventTarget | null): HTMLAnchorElement | null {
      if (!(target instanceof Element)) return null;
      return target.closest("a");
    }

    function onClick(e: MouseEvent) {
      if (e.defaultPrevented || e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const anchor = findAnchor(e.target);
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#")) return;
      if (anchor.target && anchor.target !== "_self") return;
      if (anchor.hasAttribute("download")) return;

      let url: URL;
      try {
        url = new URL(href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return;
      const destinationKey = `${url.pathname}?${url.searchParams.toString()}`;
      if (destinationKey === routeKey.current) return;

      start();
    }

    document.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("click", onClick);
      clearTimers();
    };
  }, []);

  useEffect(() => {
    const nextKey = `${pathname}?${searchParams.toString()}`;
    if (nextKey === routeKey.current) return;
    routeKey.current = nextKey;

    if (growTimer.current) clearInterval(growTimer.current);
    setWidth(100);
    hideTimer.current = setTimeout(() => {
      setVisible(false);
      setWidth(0);
    }, 200);

    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, searchParams]);

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-x-0 top-0 z-50 h-[3px] bg-transparent"
    >
      <div
        className="h-full bg-gold transition-[width,opacity] duration-200 ease-out"
        style={{
          width: `${width}%`,
          opacity: visible ? 1 : 0,
        }}
      />
    </div>
  );
}

export function RouteProgressBar() {
  return (
    <Suspense fallback={null}>
      <ProgressBarInner />
    </Suspense>
  );
}
