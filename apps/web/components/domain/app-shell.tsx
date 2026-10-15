import { Suspense, type ReactNode } from "react";
import { signOutAction } from "@/lib/auth/actions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { listRecentNotifications, RECENT_NOTIFICATIONS_LIMIT } from "@/lib/notifications/helpers";
import { needsUnreadCountQuery, unreadInList } from "@/lib/notifications/unread";
import { NOTIFICATIONS_TABLE } from "@/lib/notifications/types";
import { SidebarShell } from "./sidebar-shell";
import { OfflineBanner } from "./offline-banner";
import { NotificationsBell } from "./notifications-bell";
import { SidebarMobileProvider } from "./sidebar-mobile-context";
import { MobileSidebarToggle } from "./mobile-sidebar-toggle";
import { IdleTimeout } from "./idle-timeout";
import { CommandPalette } from "./command-palette";
import { UserMenu } from "./user-menu";
import { HeaderBreadcrumb } from "./header-breadcrumb";
import { BreadcrumbProvider } from "./breadcrumb-context";
import { BackNavigation } from "./back-navigation";
import { SiteLinks } from "./site-links";
import { NoticeStack } from "./notice-stack";
import { OrgSwitcher } from "./org-switcher";
import { GlobalProjectSelector, type ProjectSelectorOption } from "./global-project-selector";
import { setActiveProjectAction } from "@/lib/projects/active-project-actions";
import { setActiveOrganisationAction } from "@/lib/organizations/active-org-actions";
import { Tx } from "@/components/domain/tx";

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
  /** Translated text shown instead of `label` / `group` (the English strings stay the keys for icons and storage). */
  displayLabel?: string;
  displayGroup?: string;
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
  showTermsBanner = false,
  orgSwitcher = null,
  projectSelector = null,
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
  /** One-time, dismissible "please accept the terms" notice (U7). Never blocks anything. */
  showTermsBanner?: boolean;
  /** Only set for a user with grants in more than one organisation. */
  orgSwitcher?: { options: { id: string; name: string }[]; activeId: string | null } | null;
  /** The projects this login can see, for the header organisation/project picker. */
  projectSelector?: { options: ProjectSelectorOption[]; activeId: string | null } | null;
  children: ReactNode;
}) {
  return (
    <BreadcrumbProvider>
    <SidebarMobileProvider>
      <IdleTimeout />
      <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:start-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:shadow-lg"><Tx>Skip to main content</Tx></a>
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
            <HeaderBreadcrumb root={breadcrumb} navItems={navItems} />
          </div>
          <div className="flex flex-1 items-center justify-end gap-4">
            {orgSwitcher && orgSwitcher.options.length > 1 && (
              <OrgSwitcher options={orgSwitcher.options} activeId={orgSwitcher.activeId} action={setActiveOrganisationAction} />
            )}
            {projectSelector && (
              <Suspense fallback={null}>
                <GlobalProjectSelector options={projectSelector.options} activeId={projectSelector.activeId} action={setActiveProjectAction} />
              </Suspense>
            )}
            <CommandPalette navItems={navItems} />
            {/* Streamed: the bell used to be fetched before ANYTHING rendered, adding a round-trip to every
                page's first byte. The page now paints immediately and the bell fills in. */}
            <Suspense fallback={<NotificationsBell userId={userId} initialNotifications={[]} />}>
              <NotificationsBellLoader userId={userId} />
            </Suspense>
            <UserMenu userName={userName} userRole={userRole} signOutAction={signOutAction} links={userMenuLinks} needsTerms={showTermsBanner} />
          </div>
        </header>
        <OfflineBanner />
        <main id="main-content" tabIndex={-1} className="min-w-0 outline-none flex-1 bg-background p-3 pb-[calc(0.75rem+var(--notice-h,0px))] sm:p-4 sm:pb-[calc(1rem+var(--notice-h,0px))] lg:p-6 lg:pb-[calc(1.5rem+var(--notice-h,0px))]">{children}</main>
        <NoticeStack />
        <footer className="border-t border-border bg-surface px-3 py-3 sm:px-6">
          <SiteLinks signedIn />
        </footer>
        </div>
      </div>
    </SidebarMobileProvider>
    </BreadcrumbProvider>
  );
}

async function NotificationsBellLoader({ userId }: { userId: string }) {
  const supabase = await createSupabaseServerClient();
  // The bell only carries the latest 20 rows, so the badge needs a true unread total. When fewer than 20
  // came back that list is the whole inbox and the total is counted from it; only a full list needs the
  // head-count query (no rows transferred).
  const initialNotifications = await listRecentNotifications(supabase, userId);
  let count = unreadInList(initialNotifications);
  if (needsUnreadCountQuery(initialNotifications, RECENT_NOTIFICATIONS_LIMIT)) {
    const res = await supabase
      .from(NOTIFICATIONS_TABLE)
      .select("id", { count: "exact", head: true })
      .eq("recipient_user_id", userId)
      .eq("is_read", false);
    count = res.count ?? 0;
  }
  return <NotificationsBell userId={userId} initialNotifications={initialNotifications} initialUnreadCount={count} />;
}
