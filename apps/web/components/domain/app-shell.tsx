import { Suspense, type ReactNode } from "react";
import { signOutAction } from "@/lib/auth/actions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { listRecentNotifications } from "@/lib/notifications/helpers";
import { NOTIFICATIONS_TABLE } from "@/lib/notifications/types";
import { SidebarShell } from "./sidebar-shell";
import { OfflineBanner } from "./offline-banner";
import { NotificationsBell } from "./notifications-bell";
import { SidebarMobileProvider } from "./sidebar-mobile-context";
import { MobileSidebarToggle } from "./mobile-sidebar-toggle";
import { IdleTimeout } from "./idle-timeout";
import { CommandPalette } from "./command-palette";
import { UserMenu } from "./user-menu";
import { BackNavigation } from "./back-navigation";

export interface NavItem {
  label: string;
  href: string;
  /** When set, this item renders as a collapsible group header (no link of its own) whose children
   *  are shown/hidden together — used to fold the ~17 flat /inspect/organisation/* admin items
   *  (Numbering, Staff Access, Teams, ...) into one "Organisation Settings" section instead of a
   *  single long flat list. A group with no children is never rendered (see SidebarNav). */
  children?: NavItem[];
  /** Extra destinations reachable only through the Ctrl+K page search (e.g. the sections of the
   *  Settings workspace) — not shown as sidebar rows. */
  palette?: NavItem[];
  /** Extra path prefixes that also mark this item active — e.g. the standalone Settings pages
   *  (/inspect/organisation/usage, /inspect/itp-master) that live outside /inspect/settings. */
  activePrefixes?: string[];
  /** Sidebar section heading (Plan, Execute, ...). A heading renders when it changes between rows. */
  group?: string;
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
  userMenuLinks = [],
  children,
}: {
  navItems: NavItem[];
  userId: string;
  userName: string;
  userRole: string;
  breadcrumb: string;
  orgBranding?: OrgBrandingInfo | null;
  /** Extra entries for the top-right account menu (Sign out is always last). */
  userMenuLinks?: { label: string; href: string }[];
  children: ReactNode;
}) {
  return (
    <SidebarMobileProvider>
      <IdleTimeout />
      <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:start-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:shadow-lg">Skip to main content</a>
      <BackNavigation />
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
            {/* Streamed: the bell used to be fetched before ANYTHING rendered, adding a round-trip to every
                page's first byte. The page now paints immediately and the bell fills in. */}
            <Suspense fallback={<NotificationsBell userId={userId} initialNotifications={[]} />}>
              <NotificationsBellLoader userId={userId} />
            </Suspense>
            <UserMenu userName={userName} userRole={userRole} signOutAction={signOutAction} links={userMenuLinks} />
          </div>
        </header>
        <OfflineBanner />
        <main id="main-content" tabIndex={-1} className="min-w-0 outline-none flex-1 bg-background p-3 sm:p-4 lg:p-6">{children}</main>
        </div>
      </div>
    </SidebarMobileProvider>
  );
}

async function NotificationsBellLoader({ userId }: { userId: string }) {
  const supabase = await createSupabaseServerClient();
  // The bell only carries the latest 20 rows, so the badge needs a true unread total (head count,
  // no rows transferred), fetched in parallel with the list.
  const [initialNotifications, { count }] = await Promise.all([
    listRecentNotifications(supabase, userId),
    supabase
      .from(NOTIFICATIONS_TABLE)
      .select("id", { count: "exact", head: true })
      .eq("recipient_user_id", userId)
      .eq("is_read", false),
  ]);
  return <NotificationsBell userId={userId} initialNotifications={initialNotifications} initialUnreadCount={count ?? 0} />;
}
