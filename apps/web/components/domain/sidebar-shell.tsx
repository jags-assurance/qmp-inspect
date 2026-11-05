"use client";

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import type { NavItem, OrgBrandingInfo } from "./app-shell";
import { SidebarNav } from "./sidebar-nav";
import { useSidebarMobile } from "./sidebar-mobile-context";
import { Tx } from "@/components/domain/tx";
import { useTranslate } from "@/lib/i18n/locale-context";
import { useMediaQuery } from "@/lib/hooks/use-media-query";
import { useFocusTrap } from "@/lib/hooks/use-focus-trap";
import { SIDEBAR_PREF_KEY } from "@/lib/ui/sidebar-pref";
import { lockBodyScroll } from "@/lib/hooks/use-scroll-lock";

const STORAGE_KEY = SIDEBAR_PREF_KEY;
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
const PREF_EVENT = "jags-sidebar-pref";

// In-memory mirror so the toggle still works when storage is blocked (it just will not persist).
let memoryPref: string | null = null;

function readCookiePref(): string | null {
  try {
    const m = document.cookie.match(new RegExp("(?:^|; )" + STORAGE_KEY + "=([01])"));
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

// Cookie first (the server rendered from it), then localStorage, then the in-memory mirror.
function readPref(): string | null {
  const fromCookie = readCookiePref();
  if (fromCookie) return fromCookie;
  try {
    return localStorage.getItem(STORAGE_KEY) ?? memoryPref;
  } catch {
    return memoryPref;
  }
}

function writePref(value: "0" | "1") {
  memoryPref = value;
  try {
    document.cookie = `${STORAGE_KEY}=${value}; path=/; max-age=${COOKIE_MAX_AGE}; samesite=lax`;
  } catch {
    // Cookies blocked: localStorage / memory below still apply.
  }
  try {
    localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // Storage blocked: the in-memory mirror keeps this page view consistent.
  }
  window.dispatchEvent(new Event(PREF_EVENT));
}

function subscribePref(onChange: () => void) {
  window.addEventListener(PREF_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(PREF_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/**
 * The app sidebar. Three behaviours by viewport (see docs/UI_DESIGN_SYSTEM.md):
 *  - desktop (>= 1440px): fixed 256px column with group headings, always expanded.
 *  - laptop (1024-1439px): sticky column that collapses to a 72px icon rail with tooltips. The choice is
 *    remembered in a cookie (read on the server so the first paint is right) with localStorage as a fallback;
 *    no stored choice = rail, to give content the width. Rail visuals are CSS-only (`lg:max-desk:`).
 *  - tablet / phone (< 1024px): off-canvas drawer with overlay, focus trap, Esc to close, inert page
 *    behind it, safe-area insets. Always full width regardless of the rail preference.
 * The server renders the expanded markup; the client adjusts after hydration (stored preference via
 * useSyncExternalStore, so there is no hydration mismatch).
 */
export function SidebarShell({
  navItems,
  userName,
  userRole,
  signOutAction,
  orgBranding = null,
  initialRailPref = null,
}: {
  navItems: NavItem[];
  userName: string;
  userRole: string;
  signOutAction: (formData: FormData) => void | Promise<void>;
  orgBranding?: OrgBrandingInfo | null;
  /** The collapsed/expanded cookie read on the server ("1" rail, "0" expanded, null = never chosen) so the first paint is right. */
  initialRailPref?: "0" | "1" | null;
}) {
  const tl = useTranslate();
  // Reqs R113-R118: engagement_mode drives visual branding the same way it already drives document
  // numbering — jags_led (or no logo uploaded) renders the JAGS mark; co_branded shows the org's logo
  // alongside it; white_label replaces it with the org's logo plus "Powered by JAGS Assurance".
  const engagementMode = orgBranding?.engagementMode ?? "jags_led";
  const logoUrl = orgBranding?.logoUrl ?? null;
  const isWhiteLabel = engagementMode === "white_label" && Boolean(logoUrl);
  const isCoBranded = engagementMode === "co_branded" && Boolean(logoUrl);
  // Optional multi-colour ring for the "JA" badge (Organisation -> Branding).
  const brandCombo = orgBranding?.brandCombo ?? null;

  const isLg = useMediaQuery("(min-width: 64rem)", true);
  const isDesk = useMediaQuery("(min-width: 90rem)", true);
  const pref = useSyncExternalStore(subscribePref, readPref, () => initialRailPref);
  // Rail PREFERENCE (default rail). Visuals are pure CSS: `lg:max-desk:` utilities only apply on laptops
  // (1024-1439px), so desktop and the drawer are always full and there is no first-paint jump.
  const railPref = pref !== "0";
  // Effective rail (JS, used only for labels / toggle state): laptop range and preferred.
  const rail = railPref && isLg && !isDesk;
  const rp = (cls: string) => (railPref ? cls : "");
  const { open: mobileOpen, setOpen: setMobileOpen } = useSidebarMobile();

  const asideRef = useRef<HTMLElement>(null);
  const drawerActive = !isLg && mobileOpen;
  const drawerHidden = !isLg && !mobileOpen;
  const closeDrawer = useCallback(() => setMobileOpen(false), [setMobileOpen]);
  useFocusTrap(asideRef, drawerActive, closeDrawer, { restoreFocus: false });

  // Page behind the open drawer is inert; closing returns focus to the hamburger. Growing to laptop closes it.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- external viewport change closes the drawer
    if (isLg && mobileOpen) setMobileOpen(false);
  }, [isLg, mobileOpen, setMobileOpen]);
  // Any route change (a nav link, browser Back / Forward, a programmatic push) closes the drawer; its
  // effect cleanup below then releases the scroll lock, un-inerts the page and returns focus.
  const pathname = usePathname();
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- external navigation closes the drawer
    setMobileOpen(false);
  }, [pathname, setMobileOpen]);
  useEffect(() => {
    if (!drawerActive) return;
    const opener = document.activeElement as HTMLElement | null;
    const targets = Array.from(document.querySelectorAll<HTMLElement>("main, footer"));
    targets.forEach((el) => el.setAttribute("inert", ""));
    const unlockScroll = lockBodyScroll();
    return () => {
      targets.forEach((el) => el.removeAttribute("inert"));
      unlockScroll();
      ((document.querySelector("[data-sidebar-toggle]") as HTMLElement | null) ?? opener)?.focus?.();
    };
  }, [drawerActive]);

  function toggleRail() {
    writePref(rail ? "0" : "1");
  }

  const initials = userName
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <>
      {mobileOpen && !isLg && (
        <button
          type="button"
          tabIndex={-1}
          aria-label={tl("Close menu")}
          className="fixed inset-0 z-40 cursor-default bg-overlay lg:hidden"
          onClick={closeDrawer}
        />
      )}
      <aside
        id="app-sidebar"
        ref={asideRef}
        tabIndex={-1}
        inert={drawerHidden}
        aria-hidden={drawerHidden ? true : undefined}
        aria-label={tl("Sidebar")}
        data-surface="dark"
        role={drawerActive ? "dialog" : undefined}
        aria-modal={drawerActive ? true : undefined}
        className={
          "flex flex-col overflow-y-auto overscroll-contain bg-burgundy text-white outline-none " +
          // Drawer (< 1024): fixed off-canvas panel, never wider than the screen, safe-area padded.
          "fixed inset-y-0 start-0 z-40 w-[min(var(--sidebar-w),88vw)] pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] ps-[env(safe-area-inset-left)] " +
          "transition-transform duration-200 motion-reduce:transition-none " +
          (mobileOpen ? "translate-x-0 shadow-xl " : "-translate-x-full rtl:translate-x-full ") +
          // Laptop and up: sticky column in the page flow.
          "lg:sticky lg:top-0 lg:z-auto lg:h-dvh lg:shrink-0 lg:translate-x-0 lg:self-start lg:pt-0 lg:pb-0 lg:ps-0 lg:shadow-none lg:rtl:translate-x-0 lg:transition-[width] " +
          (railPref ? "lg:w-[var(--sidebar-rail-w)] desk:w-[var(--sidebar-w)]" : "lg:w-[var(--sidebar-w)]")
        }
      >
        <div className={"flex h-14 shrink-0 items-center gap-2.5 border-b border-white/10 px-4 " + rp("lg:max-desk:justify-center lg:max-desk:px-2")}>
          {isWhiteLabel ? (
            // eslint-disable-next-line @next/next/no-img-element -- signed Storage URL, not a static asset
            <img
              src={logoUrl!}
              alt="Organisation logo"
              className={"h-9 max-w-[9.5rem] object-contain " + rp("lg:max-desk:max-w-9")}
            />
          ) : (
            <>
              {/* The JAGS logo sits on a white chip so its burgundy shield stays visible on the burgundy sidebar. A
                  brand-colour ring (Organisation -> Branding) is drawn around the chip when the organisation set one. */}
              <div
                className={"flex shrink-0 items-center rounded-md bg-white " + (brandCombo ? "p-[2px]" : "px-1.5 py-1")}
                style={brandCombo ? { background: `conic-gradient(${brandCombo.join(", ")}, ${brandCombo[0]})` } : undefined}
              >
                <span className={brandCombo ? "flex items-center rounded-[4px] bg-white px-1.5 py-1" : "contents"}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- small static brand asset */}
                  <img src="/jags-logo.png" alt={tl("JAGS Assurance")} className={"h-8 w-auto object-contain " + rp("lg:max-desk:hidden")} />
                  {railPref && (
                    // eslint-disable-next-line @next/next/no-img-element -- small static brand asset
                    <img src="/jags-mark.png" alt={tl("JAGS Assurance")} className="hidden h-8 w-8 object-contain lg:max-desk:block" />
                  )}
                </span>
              </div>
            </>
          )}
          {isCoBranded && (
            // eslint-disable-next-line @next/next/no-img-element -- signed Storage URL, not a static asset
            <img src={logoUrl!} alt="Organisation logo" className={"ms-2 h-8 max-w-[6.5rem] border-s border-white/25 ps-2 object-contain " + rp("lg:max-desk:hidden")} />
          )}
        </div>

        <SidebarNav items={navItems} collapsed={railPref} railActive={rail} />

        {/* Rail toggle: laptop only. Desktop is always expanded and the drawer is always full. */}
        <div className="hidden px-3 pb-2 lg:block desk:hidden">
          <button
            type="button"
            onClick={toggleRail}
            aria-label={rail ? tl("Expand sidebar") : tl("Collapse sidebar")}
            aria-expanded={!rail}
            title={rail ? tl("Expand sidebar") : tl("Collapse sidebar")}
            className={
              "flex min-h-10 w-full items-center gap-2 rounded-md px-3 text-xs font-medium text-white/80 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-gold " +
              rp("lg:max-desk:justify-center lg:max-desk:px-0")
            }
          >
            {/* The universal "sidebar" symbol: a panel with a divider. The side the divider sits on flips when collapsed. */}
            <svg
              aria-hidden="true"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-[18px] w-[18px] shrink-0 rtl:-scale-x-100"
            >
              <rect x="3" y="4" width="14" height="12" rx="2" />
              <path d="M8 4v12" />
              {rail && <path d="M5.5 8.5l1 1.5-1 1.5" strokeWidth="1.2" />}
            </svg>
            <span className={rp("lg:max-desk:hidden")}>{rail ? <Tx>Expand</Tx> : <Tx>Collapse</Tx>}</span>
          </button>
        </div>

        <div className={"border-t border-white/10 px-4 py-3 " + rp("lg:max-desk:px-2 lg:max-desk:text-center")}>
          {railPref ? (
            <div className="hidden flex-col items-center gap-2 lg:max-desk:flex">
              <div
                title={`${userName} · ${userRole}`}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-white/15 text-xs font-semibold"
              >
                {initials}
              </div>
              <form action={signOutAction}>
                <button
                  type="submit"
                  title={tl("Sign out")}
                  aria-label={tl("Sign out")}
                  className="flex h-9 w-9 items-center justify-center rounded-md text-white/80 hover:bg-white/10 hover:text-white focus-visible:outline-gold"
                >
                  <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                    <path d="M8 3.5H5a1.5 1.5 0 00-1.5 1.5v10A1.5 1.5 0 005 16.5h3" />
                    <path d="M13 13.5l3.5-3.5L13 6.5" />
                    <path d="M16.5 10h-9" />
                  </svg>
                </button>
              </form>
            </div>
          ) : null}
          {/* Full footer: always on the drawer (below lg) and whenever the sidebar is expanded. */}
          <div className={rp("lg:max-desk:hidden")}>
            <div className="truncate text-sm font-medium" title={userName}>{userName}</div>
            <div className="text-xs text-white/75">{userRole}</div>
            <form action={signOutAction}>
              <button type="submit" className="mt-2 inline-flex min-h-9 items-center text-xs text-white/80 hover:text-white hover:underline focus-visible:outline-gold [@media(pointer:coarse)]:min-h-11">
                <Tx>Sign out</Tx>
              </button>
            </form>
            {isWhiteLabel && <div className="mt-2 text-xs text-white/60"><Tx>Powered by JAGS Assurance</Tx></div>}
          </div>
        </div>
      </aside>
    </>
  );
}
