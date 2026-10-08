"use client";

import { useEffect, useRef, useState } from "react";
import type { NavItem, OrgBrandingInfo } from "./app-shell";
import { SidebarNav } from "./sidebar-nav";
import { useSidebarMobile } from "./sidebar-mobile-context";
import { Tx } from "@/components/domain/tx";
import { useTranslate } from "@/lib/i18n/locale-context";

const STORAGE_KEY = "jags-sidebar-collapsed";

/**
 * Owns the sidebar's collapse/expand state (persisted per-browser via localStorage — a per-viewer
 * UI preference, not data, so this is the right place for it per the app's own conventions) and its
 * sticky positioning. Split out from AppShell (a server component) because this needs client-side
 * state; AppShell still owns the header/breadcrumb/search and passes the sign-out form in as a
 * server action reference, which Next.js allows across the server/client boundary.
 */
export function SidebarShell({
  navItems,
  userName,
  userRole,
  signOutAction,
  orgBranding = null,
}: {
  navItems: NavItem[];
  userName: string;
  userRole: string;
  signOutAction: (formData: FormData) => void | Promise<void>;
  orgBranding?: OrgBrandingInfo | null;
}) {
  const tl = useTranslate();
  // Reqs R113-R118: engagement_mode drives visual branding the same way it already drives document
  // numbering (lib/numbering/generate.ts's internalReference) — jags_led (or no logo uploaded)
  // renders exactly as before; co_branded shows the org's logo alongside JAGS's own mark; white_label
  // replaces JAGS's mark with the org's logo and adds the "Powered by JAGS Assurance" small print
  // this session's requirement literally asks for.
  const engagementMode = orgBranding?.engagementMode ?? "jags_led";
  const logoUrl = orgBranding?.logoUrl ?? null;
  const isWhiteLabel = engagementMode === "white_label" && Boolean(logoUrl);
  const isCoBranded = engagementMode === "co_branded" && Boolean(logoUrl);
  // Optional 4-color combo (Microsoft/Google-style multi-color mark), set on Organisation ->
  // Branding — renders the badge as a conic-gradient ring instead of its plain single-accent
  // border. Only relevant for a non-staff login whose own org opted in (JAGS staff always see the
  // plain default mark, same as the logo/co-branding above never applying to them either).
  const brandCombo = orgBranding?.brandCombo ?? null;
  // Starts expanded on the server and on first client paint (matches SSR markup, no hydration
  // mismatch — the same discipline as offline-banner.tsx elsewhere in this app), then reads the
  // real stored preference in an effect once mounted.
  const [collapsed, setCollapsed] = useState(false);
  const [mounted, setMounted] = useState(false);
  // The desktop collapse preference is meaningless on a mobile drawer meant to be opened
  // deliberately (an icon-only rail there defeats the point) — tracked separately from `collapsed`
  // so the drawer always renders fully expanded below 901px regardless of what was last toggled
  // on a wider viewport.
  const [isDesktop, setIsDesktop] = useState(true);
  const { open: mobileOpen, setOpen: setMobileOpen } = useSidebarMobile();

  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- post-mount / external-event sync (hydration-safe default, then real value); not derivable during render
      setCollapsed(localStorage.getItem(STORAGE_KEY) === "1");
    } catch {
      // Private browsing / storage blocked — just stays expanded.
    }
    setMounted(true);

    const mql = window.matchMedia("(min-width: 901px)");
    setIsDesktop(mql.matches);
    const onChange = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  const effectiveCollapsed = isDesktop && collapsed;
  const asideRef = useRef<HTMLElement>(null);
  const drawerHidden = !isDesktop && !mobileOpen;

  // Drawer behaviour below 901px: Esc closes it, focus moves into it on open and back to the opener
  // on close, and the page behind it is inert (keyboard and screen-reader users can't wander out
  // of a modal drawer). When closed, the aside itself is inert + hidden so its ~25 links are not in
  // the tab order or the accessibility tree.
  useEffect(() => {
    const main = document.querySelector("main");
    if (isDesktop || !mobileOpen) {
      main?.removeAttribute("inert");
      return;
    }
    const opener = document.activeElement as HTMLElement | null;
    main?.setAttribute("inert", "");
    asideRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      main?.removeAttribute("inert");
      (document.querySelector("[data-sidebar-toggle]") as HTMLElement | null ?? opener)?.focus?.();
    };
  }, [isDesktop, mobileOpen, setMobileOpen]);

  function toggle() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        // Nothing to persist to — the toggle still works for this page view.
      }
      return next;
    });
  }

  const initials = userName
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <>
      {/* Backdrop, mobile-only (<=900px), closes the drawer on tap outside it. */}
      {mobileOpen && (
        <button
          type="button"
          tabIndex={-1}
          aria-label={tl("Close menu")}
          className="fixed inset-0 z-20 cursor-default bg-black/40 min-[901px]:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}
      <aside
        id="app-sidebar"
        ref={asideRef}
        tabIndex={-1}
        inert={drawerHidden}
        aria-hidden={drawerHidden ? true : undefined}
        aria-label={tl("Sidebar")}
        className={
          "flex h-screen flex-col overflow-y-auto bg-burgundy text-white outline-none transition-all duration-150 " +
          // Desktop (>900px): permanent, sticky column, collapsible width.
          "min-[901px]:sticky min-[901px]:top-0 min-[901px]:z-auto min-[901px]:self-start min-[901px]:shrink-0 min-[901px]:translate-x-0 " +
          (collapsed ? "min-[901px]:w-16" : "min-[901px]:w-60") +
          // Mobile (<=900px): fixed off-canvas drawer, closed by default, full nav width regardless
          // of the desktop collapse preference (a collapsed icon-only rail defeats the point of a
          // drawer meant to be opened deliberately).
          " fixed inset-y-0 start-0 z-30 w-64 max-[900px]:shadow-xl " +
          (mobileOpen ? "translate-x-0" : "-translate-x-full rtl:translate-x-full min-[901px]:translate-x-0 min-[901px]:rtl:translate-x-0") +
          // Avoids a flash of the wrong width on first paint while the effect above hasn't run yet.
          (mounted ? "" : " duration-0")
        }
      >
      <div className={"flex items-center gap-2 px-4 py-5 " + (effectiveCollapsed ? "justify-center px-2" : "")}>
        {isWhiteLabel ? (
          // eslint-disable-next-line @next/next/no-img-element -- signed Storage URL, not a static asset
          <img
            src={logoUrl!}
            alt="Organisation logo"
            className={effectiveCollapsed ? "h-9 max-w-9 object-contain" : "h-9 max-w-[9.5rem] object-contain"}
          />
        ) : (
          <>
            <div
              className={
                "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold" +
                (brandCombo ? " p-[3px]" : " border-2 border-gold")
              }
              style={brandCombo ? { background: `conic-gradient(${brandCombo.join(", ")}, ${brandCombo[0]})` } : undefined}
            >
              <span className={brandCombo ? "flex h-full w-full items-center justify-center rounded-full bg-burgundy" : "contents"}>
                <Tx>JA</Tx>
              </span>
            </div>
            {!effectiveCollapsed && <span className="truncate font-semibold tracking-wide"><Tx>JAGS Assurance</Tx></span>}
          </>
        )}
        {isCoBranded && !effectiveCollapsed && (
          // eslint-disable-next-line @next/next/no-img-element -- signed Storage URL, not a static asset
          <img src={logoUrl!} alt="Organisation logo" className="ms-2 h-8 max-w-[6.5rem] border-s border-white/25 ps-2 object-contain" />
        )}
      </div>

      <SidebarNav items={navItems} collapsed={effectiveCollapsed} />

      <div className="px-3 pb-2 max-[900px]:hidden">
        <button
          type="button"
          onClick={toggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className={
            "flex w-full items-center gap-2 rounded-md px-3 py-2 text-xs font-medium text-white/70 transition-colors hover:bg-white/10 hover:text-white " +
            (collapsed ? "justify-center px-0" : "")
          }
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={"h-4 w-4 shrink-0 transition-transform rtl:-scale-x-100 " + (collapsed ? "rotate-180" : "")}
          >
            <path d="M12.5 4.5L7 10l5.5 5.5" />
          </svg>
          {!collapsed && <span><Tx>Collapse</Tx></span>}
        </button>
      </div>

      <div className={"border-t border-white/15 px-4 py-4 " + (effectiveCollapsed ? "px-2 text-center" : "")}>
        {effectiveCollapsed ? (
          <div
            title={`${userName} · ${userRole}`}
            className="mx-auto flex h-8 w-8 items-center justify-center rounded-full bg-white/15 text-xs font-semibold"
          >
            {initials}
          </div>
        ) : (
          <>
            <div className="text-sm font-medium">{userName}</div>
            <div className="text-xs text-white/70">{userRole}</div>
          </>
        )}
        <form action={signOutAction} className={effectiveCollapsed ? "mt-2 flex justify-center" : ""}>
          <button
            type="submit"
            title={tl("Sign out")}
            className={
              effectiveCollapsed
                ? "flex h-7 w-7 items-center justify-center rounded-md text-white/70 hover:bg-white/10 hover:text-white"
                : "mt-2 text-xs text-white/70 hover:text-white hover:underline"
            }
          >
            {effectiveCollapsed ? (
              <svg
                aria-hidden="true"
                viewBox="0 0 20 20"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-4 w-4"
              >
                <path d="M8 3.5H5a1.5 1.5 0 00-1.5 1.5v10A1.5 1.5 0 005 16.5h3" />
                <path d="M13 13.5l3.5-3.5L13 6.5" />
                <path d="M16.5 10h-9" />
              </svg>
            ) : (
              "Sign out"
            )}
          </button>
        </form>
        {isWhiteLabel && !effectiveCollapsed && (
          <div className="mt-3 text-xs text-white/50"><Tx>Powered by JAGS Assurance</Tx></div>
        )}
      </div>
      </aside>
    </>
  );
}
