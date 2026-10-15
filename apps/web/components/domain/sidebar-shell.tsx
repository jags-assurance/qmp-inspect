"use client";

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import type { NavItem, OrgBrandingInfo } from "./app-shell";
import { SidebarNav } from "./sidebar-nav";
import { useSidebarMobile } from "./sidebar-mobile-context";
import { Tx } from "@/components/domain/tx";
import { useTranslate } from "@/lib/i18n/locale-context";
import { useMediaQuery } from "@/lib/hooks/use-media-query";
import { useFocusTrap } from "@/lib/hooks/use-focus-trap";

const STORAGE_KEY = "jags-sidebar-collapsed";
const PREF_EVENT = "jags-sidebar-pref";

// In-memory mirror so the toggle still works when storage is blocked (it just will not persist).
let memoryPref: string | null = null;

function readPref(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? memoryPref;
  } catch {
    return memoryPref;
  }
}

function writePref(value: "0" | "1") {
  memoryPref = value;
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
 *    remembered in localStorage (safe wrapper; no stored choice = rail, to give content the width).
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
}: {
  navItems: NavItem[];
  userName: string;
  userRole: string;
  signOutAction: (formData: FormData) => void | Promise<void>;
  orgBranding?: OrgBrandingInfo | null;
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
  const pref = useSyncExternalStore(subscribePref, readPref, () => null);
  // Rail only on laptop; desktop is always full; the drawer is always full.
  const railAllowed = isLg && !isDesk;
  const rail = railAllowed && pref !== "0";
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
  useEffect(() => {
    if (!drawerActive) return;
    const opener = document.activeElement as HTMLElement | null;
    const targets = Array.from(document.querySelectorAll<HTMLElement>("main, footer"));
    targets.forEach((el) => el.setAttribute("inert", ""));
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      targets.forEach((el) => el.removeAttribute("inert"));
      document.body.style.overflow = prevOverflow;
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
          (rail ? "lg:w-[var(--sidebar-rail-w)]" : "lg:w-[var(--sidebar-w)]")
        }
      >
        <div className={"flex h-14 shrink-0 items-center gap-2.5 border-b border-white/10 px-4 " + (rail ? "lg:justify-center lg:px-2" : "")}>
          {isWhiteLabel ? (
            // eslint-disable-next-line @next/next/no-img-element -- signed Storage URL, not a static asset
            <img
              src={logoUrl!}
              alt="Organisation logo"
              className={rail ? "h-9 max-w-9 object-contain" : "h-9 max-w-[9.5rem] object-contain"}
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
              {!rail && <span className="truncate text-[0.95rem] font-semibold tracking-wide"><Tx>JAGS Assurance</Tx></span>}
            </>
          )}
          {isCoBranded && !rail && (
            // eslint-disable-next-line @next/next/no-img-element -- signed Storage URL, not a static asset
            <img src={logoUrl!} alt="Organisation logo" className="ms-2 h-8 max-w-[6.5rem] border-s border-white/25 ps-2 object-contain" />
          )}
        </div>

        <SidebarNav items={navItems} collapsed={rail} />

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
              (rail ? "justify-center px-0" : "")
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
              className={"h-4 w-4 shrink-0 transition-transform rtl:-scale-x-100 " + (rail ? "rotate-180" : "")}
            >
              <path d="M12.5 4.5L7 10l5.5 5.5" />
            </svg>
            {!rail && <span><Tx>Collapse</Tx></span>}
          </button>
        </div>

        <div className={"border-t border-white/10 px-4 py-3 " + (rail ? "lg:px-2 lg:text-center" : "")}>
          {rail ? (
            <div className="hidden flex-col items-center gap-2 lg:flex">
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
          <div className={rail ? "lg:hidden" : ""}>
            <div className="truncate text-sm font-medium">{userName}</div>
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
