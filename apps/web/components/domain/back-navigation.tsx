"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";

/**
 * Makes every "← Back to …" link behave like a real back button. Those links point at one fixed
 * parent page, so arriving from a different place (dashboard → project, or an ITP opened from the
 * dashboard's hold list) used to send people somewhere they had not been. When the person has
 * navigated inside the app during this tab session, the link now goes back along the route they
 * actually took; when the page was opened directly (a bookmark, a shared URL), it keeps its fixed
 * parent as the fallback. Nothing else on the page needs to change — the check is on the link's own
 * leading arrow.
 */
export function BackNavigation() {
  const router = useRouter();
  const pathname = usePathname();
  const navCount = useRef(0);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    navCount.current += 1;
  }, [pathname]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const anchor = (e.target as HTMLElement | null)?.closest("a");
      if (!anchor) return;
      const text = (anchor.textContent ?? "").trim();
      if (!/^←\s*(Back|Library)/.test(text) || !anchor.closest("main")) return;
      if (navCount.current < 1) return;
      e.preventDefault();
      router.back();
    }
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [router]);

  return null;
}
