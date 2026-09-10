import type { ReactNode } from "react";
import { signOutAction } from "@/lib/auth/actions";
import { SidebarNav } from "./sidebar-nav";

export interface NavItem {
  label: string;
  href: string;
}

/**
 * The persistent burgundy sidebar + white top bar shell used across every screen (Platform Home
 * and every QMP Inspect page) — established as the site-wide navigation pattern in the client's
 * UI reference screenshots.
 */
export function AppShell({
  navItems,
  userName,
  userRole,
  breadcrumb,
  children,
}: {
  navItems: NavItem[];
  userName: string;
  userRole: string;
  breadcrumb: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-screen">
      <aside className="flex w-60 flex-col bg-burgundy text-white">
        <div className="flex items-center gap-2 px-5 py-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-gold text-sm font-semibold">
            JA
          </div>
          <span className="font-semibold tracking-wide">JAGS Assurance</span>
        </div>
        <SidebarNav items={navItems} />
        <div className="border-t border-white/15 px-4 py-4">
          <div className="text-sm font-medium">{userName}</div>
          <div className="text-xs text-white/70">{userRole}</div>
          <form action={signOutAction}>
            <button type="submit" className="mt-2 text-xs text-white/70 hover:text-white hover:underline">
              Sign out
            </button>
          </form>
        </div>
      </aside>
      <div className="flex flex-1 flex-col">
        <header className="flex items-center justify-between gap-4 border-b border-border bg-surface px-6 py-3">
          <span className="text-sm text-muted">{breadcrumb}</span>
          <div className="flex flex-1 items-center justify-end gap-4">
            <div className="relative hidden w-full max-w-xs sm:block">
              <svg
                aria-hidden="true"
                viewBox="0 0 20 20"
                fill="none"
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
              >
                <circle cx="9" cy="9" r="6" stroke="currentColor" strokeWidth="1.5" />
                <path d="M17 17L13.5 13.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              <input
                type="search"
                placeholder="Search..."
                className="w-full rounded-md border border-border bg-off-white py-1.5 pl-9 pr-3 text-sm text-ink placeholder:text-muted focus:border-burgundy focus:outline-none"
              />
            </div>
            <button
              type="button"
              aria-label="Notifications"
              className="relative flex h-9 w-9 items-center justify-center rounded-full border border-border text-muted hover:bg-off-white hover:text-ink"
            >
              <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="h-4 w-4">
                <path
                  d="M10 2.5c-2.2 0-4 1.8-4 4v2.4c0 .5-.2 1-.5 1.4l-1 1.2c-.6.7-.1 1.8.8 1.8h9.4c.9 0 1.4-1.1.8-1.8l-1-1.2c-.3-.4-.5-.9-.5-1.4V6.5c0-2.2-1.8-4-4-4z"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                />
                <path d="M8.2 15.5a1.8 1.8 0 0 0 3.6 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              <span className="absolute -right-0.5 -top-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-burgundy text-[9px] font-semibold text-white">
                •
              </span>
            </button>
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-burgundy text-xs font-semibold text-white">
                {userName
                  .split(" ")
                  .map((part) => part[0])
                  .slice(0, 2)
                  .join("")
                  .toUpperCase()}
              </div>
              <div className="hidden leading-tight sm:block">
                <div className="text-sm font-medium text-ink">{userName}</div>
                <div className="text-xs text-muted">{userRole}</div>
              </div>
            </div>
          </div>
        </header>
        <main className="flex-1 bg-background p-6">{children}</main>
      </div>
    </div>
  );
}
