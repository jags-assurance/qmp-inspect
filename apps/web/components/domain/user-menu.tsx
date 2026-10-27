"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { setLocaleAction } from "@/lib/i18n/actions";
import { LOCALE_LABELS, SUPPORTED_LOCALES } from "@/lib/i18n/direction";
import { Tx } from "@/components/domain/tx";
import { TermsMenuSection } from "@/components/domain/terms-menu-section";
import { useTranslate } from "@/lib/i18n/locale-context";
import { PopoverPanel } from "@/components/ui/popover-panel";

/**
 * The top-right profile control. A real menu (not a static badge): shows who is signed in and their
 * role, links to the places a person manages their own context, and signs out. Closes on outside
 * click, Escape, or choosing an item — the standard account-menu behaviour.
 */
export function UserMenu({
  userName,
  userRole,
  userEmail,
  signOutAction,
  links = [],
  needsTerms = false,
}: {
  userName: string;
  userRole: string;
  /** Shown under the name so people with several accounts can see which one is signed in. */
  userEmail?: string;
  signOutAction: () => Promise<void>;
  links?: { label: string; href: string }[];
  /** True until the signed-in user has accepted the current terms (dot on the avatar + accept entry). */
  needsTerms?: boolean;
}) {
  const tl = useTranslate();
  const [open, setOpen] = useState(false);
  const [canInstall, setCanInstall] = useState(false);
  const [termsPending, setTermsPending] = useState(needsTerms);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const closeMenu = useCallback(() => setOpen(false), []);

  // The browser's install prompt is captured by OfflineBanner; offer it here as an account-menu entry.
  useEffect(() => {
    const check = () => setCanInstall(!!(window as unknown as { __qmpInstallPrompt?: unknown }).__qmpInstallPrompt);
    check();
    window.addEventListener("qmp-install-available", check);
    return () => window.removeEventListener("qmp-install-available", check);
  }, []);

  async function installApp() {
    const w = window as unknown as { __qmpInstallPrompt?: { prompt: () => Promise<void>; userChoice: Promise<unknown> } };
    const ev = w.__qmpInstallPrompt;
    setOpen(false);
    if (!ev) return;
    await ev.prompt();
    await ev.userChoice.catch(() => null);
    w.__qmpInstallPrompt = undefined;
    setCanInstall(false);
  }

  const initials = userName
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        title={`${userName}${userEmail ? ` <${userEmail}>` : ""} (${userRole})`}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${userName}${userEmail ? `, ${userEmail}` : ""} (${userRole})`}
        className="flex h-11 items-center gap-2 rounded-full py-1 ps-1 pe-1 hover:bg-surface-subtle lg:pe-3"
      >
        <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-burgundy text-xs font-semibold text-white">
          {initials}
          {termsPending && <span aria-label={tl("Terms of use to accept")} className="absolute -end-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-surface bg-danger" />}
        </span>
        <span className="hidden max-w-[9rem] text-start leading-tight xl:block">
          <span className="block truncate whitespace-nowrap text-sm font-medium text-ink" title={userName}>{userName}</span>
          <span className="block truncate whitespace-nowrap text-xs text-muted" title={userRole}>{userRole}</span>
        </span>
        <span aria-hidden="true" className="hidden text-xs text-muted xl:inline">
          ▾
        </span>
      </button>

      {/* Portalled to <body> (PopoverPanel) so floating notices can never cover the account menu. */}
      <PopoverPanel open={open} onClose={closeMenu} anchorRef={buttonRef} role="menu" className="overflow-hidden overflow-y-auto sm:w-64">
        <div role="none">
          <div role="none" className="border-b border-border px-4 py-3">
            <p className="truncate text-sm font-medium text-ink" title={userName}>{userName}</p>
            {userEmail && <p className="truncate text-xs text-muted" title={userEmail}>{userEmail}</p>}
            <p className="text-xs text-muted">{userRole}</p>
          </div>
          {termsPending && <TermsMenuSection onAccepted={() => setTermsPending(false)} />}
          {canInstall && (
            <div role="none" className="border-b border-border py-1">
              <button type="button" role="menuitem" onClick={installApp} className="block min-h-11 w-full px-4 py-2.5 text-start text-sm text-ink hover:bg-surface-subtle">
                <Tx>Install app on this device</Tx>
              </button>
            </div>
          )}
          {links.length > 0 && (
            <ul role="none" className="py-1">
              {links.map((l) => (
                <li key={l.href} role="none">
                  <Link
                    href={l.href}
                    role="menuitem"
                    onClick={() => setOpen(false)}
                    className="block min-h-11 px-4 py-2.5 text-sm text-ink hover:bg-surface-subtle"
                  >
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {SUPPORTED_LOCALES.length > 1 && (
          <form action={setLocaleAction} role="group" className="flex items-center gap-2 border-t border-border px-4 py-2.5" aria-label={tl("Language")}>
            <span className="text-xs text-muted"><Tx>Language</Tx></span>
            {SUPPORTED_LOCALES.map((code) => (
              <button
                key={code}
                type="submit"
                name="locale"
                value={code}
                role="menuitem"
                lang={code}
                className="min-h-8 rounded-md border border-control-border px-2 text-xs text-ink hover:bg-surface-subtle [@media(pointer:coarse)]:min-h-11"
              >
                {LOCALE_LABELS[code]}
              </button>
            ))}
          </form>
          )}
          <form action={signOutAction} role="none" className="border-t border-border">
            <button type="submit" role="menuitem" className="block min-h-11 w-full px-4 py-2.5 text-start text-sm font-medium text-danger hover:bg-surface-subtle">
              <Tx>Sign out</Tx>
            </button>
          </form>
        </div>
      </PopoverPanel>
    </div>
  );
}
