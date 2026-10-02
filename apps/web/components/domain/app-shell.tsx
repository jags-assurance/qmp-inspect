import type { ReactNode } from "react";
import { signOutAction } from "@/lib/auth/actions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { listRecentNotifications } from "@/lib/notifications/helpers";
import { SidebarShell } from "./sidebar-shell";
import { OfflineBanner } from "./offline-banner";
import { NotificationsBell } from "./notifications-bell";
import { SidebarMobileProvider } from "./sidebar-mobile-context";
import { MobileSidebarToggle } from "./mobile-sidebar-toggle";
import { IdleTimeout } from "./idle-timeout";
import { CommandPalette } from "./command-palette";

export interface NavItem {
  label: string;
  href: string;
  /** When set, this item renders as a collapsible group header (no link of its own) whose children
   *  are shown/hidden together — used to fold the ~17 flat /inspect/organisation/* admin items
   *  (Numbering, Staff Access, Teams, ...) into one "Organisation Settings" section instead of a
   *  single long flat list. A group with no children is never rendered (see SidebarNav). */
  children?: NavItem[];
}

export interface OrgBrandingInfo {
  engagementMode: string;
  /** Signed URL for the current user's own org's uploaded logo, or null when there's none to show
   *  (no logo uploaded, or engagement_mode is jags_led). See sidebar-shell.tsx for how this is
   *  rendered — Reqs R113-R118. */
  logoUrl: string | null;
  /** The org's full color combo, any length >= 3 (see lib/branding/org-brand.ts's
   *  brandComboColors), or null when the org hasn't opted into multi-color mode —
   *  sidebar-shell.tsx renders the "JA" badge as a conic ring built from these colors instead of
   *  its plain single-accent border when this is set. */
  brandCombo?: string[] | null;
}

/**
 * The persistent burgundy sidebar + white top bar shell used across every screen (Platform Home
 * and every QMP Inspect page) — established as the site-wide navigation pattern in the client's
 * UI reference screenshots.
 */
export async function AppShell({
  navItems,
  userId,
  userName,
  userRole,
  breadcrumb,
  orgBranding = null,
  children,
}: {
  navItems: NavItem[];
  userId: string;
  userName: string;
  userRole: string;
  breadcrumb: string;
  orgBranding?: OrgBrandingInfo | null;
  children: ReactNode;
}) {
  const supabase = await createSupabaseServerClient();
  const initialNotifications = await listRecentNotifications(supabase, userId);

  return (
    <SidebarMobileProvider>
      <IdleTimeout />
      <div className="flex min-h-screen">
        <SidebarShell
          navItems={navItems}
          userName={userName}
          userRole={userRole}
          signOutAction={signOutAction}
          orgBranding={orgBranding}
        />
        <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-border bg-surface px-3 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <MobileSidebarToggle />
            <span className="text-sm text-muted">{breadcrumb}</span>
          </div>
          <div className="flex flex-1 items-center justify-end gap-4">
            <CommandPalette navItems={navItems} />
            <NotificationsBell userId={userId} initialNotifications={initialNotifications} />
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
        <OfflineBanner />
        <main className="min-w-0 flex-1 bg-background p-3 sm:p-4 lg:p-6">{children}</main>
        </div>
      </div>
    </SidebarMobileProvider>
  );
}
