import { JourneyReturnBar } from "@/components/domain/journey-return-bar";
import { Suspense, type ReactNode } from "react";
import { cookies } from "next/headers";
import { signOutAction } from "@/lib/auth/actions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { listRecentNotifications, RECENT_NOTIFICATIONS_LIMIT } from "@/lib/notifications/helpers";
import { needsUnreadCountQuery, unreadInList } from "@/lib/notifications/unread";
import { NOTIFICATIONS_TABLE } from "@/lib/notifications/types";
import { SidebarShell } from "./sidebar-shell";
import { SIDEBAR_PREF_KEY } from "@/lib/ui/sidebar-pref";
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
import { SavedToast } from "./saved-toast";
import { SpellcheckDefaults } from "./spellcheck-defaults";
import { AccessDeniedNotice } from "./access-denied-notice";
import { RelatedPages } from "./related-pages";
import { HeaderContext, HeaderContextSkeleton } from "./header-context";
import type { ProjectSelectorOption } from "./global-project-selector";
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
  /** Optional count / flag shown at the end of the row (gold pill; a dot on the collapsed icon rail). */
  badge?: number | string;
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
  userEmail,
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
  userEmail?: string;
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
  // Sidebar rail preference lives in a cookie so the first paint already matches (no expand-then-snap on laptops).
  const railCookie = (await cookies()).get(SIDEBAR_PREF_KEY)?.value;
  const initialRailPref = railCookie === "0" || railCookie === "1" ? railCookie : null;
  return (
    <BreadcrumbProvider>
    <SidebarMobileProvider>
      <IdleTimeout />
      <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:start-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:shadow-lg"><Tx>Skip to main content</Tx></a>
      <BackNavigation />
      <div className="flex min-h-dvh">
        <SidebarShell
          navItems={navItems}
          userName={userName}
          userRole={userRole}
          signOutAction={signOutAction}
          orgBranding={orgBranding}
          initialRailPref={initialRailPref}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          {/* ONE compact 56px row: menu (< lg) - breadcrumb - context - search - bell - avatar. The only sticky element. */}
          <header className="no-print sticky top-0 z-20 border-b border-border bg-surface pt-[env(safe-area-inset-top)] ps-[env(safe-area-inset-left)] pe-[env(safe-area-inset-right)] lg:ps-0 lg:pe-0">
            <div className="flex h-14 items-center gap-2 px-3 sm:gap-3 sm:px-6 lg:px-8">
              <MobileSidebarToggle />
              <div className="min-w-0 flex-1 lg:min-w-[9rem]">
                <HeaderBreadcrumb root={breadcrumb} navItems={navItems} />
              </div>
              <div className="flex shrink-0 items-center gap-1 sm:gap-2">
                <Suspense fallback={<HeaderContextSkeleton />}>
                  <HeaderContext
                    orgSwitcher={orgSwitcher}
                    projectSelector={projectSelector}
                    setActiveOrganisationAction={setActiveOrganisationAction}
                    setActiveProjectAction={setActiveProjectAction}
                  />
                </Suspense>
                <CommandPalette navItems={navItems} />
                {/* Streamed: the bell used to be fetched before ANYTHING rendered, adding a round-trip to every
                    page first byte. The page now paints immediately and the bell fills in. */}
                <Suspense fallback={<NotificationsBell userId={userId} initialNotifications={[]} />}>
                  <NotificationsBellLoader userId={userId} />
                </Suspense>
                <UserMenu userName={userName} userRole={userRole} userEmail={userEmail} signOutAction={signOutAction} links={userMenuLinks} needsTerms={showTermsBanner} />
              </div>
            </div>
          </header>
          <OfflineBanner />
          <JourneyReturnBar />
          {/* Page container: padding steps 12 / 24 / 32 px by breakpoint; content never wider than --content-max (1440px). */}
          <main
            id="main-content"
            tabIndex={-1}
            className="min-w-0 flex-1 bg-background px-3 py-4 pb-[calc(1rem+var(--notice-h,0px))] outline-none sm:px-6 sm:py-6 sm:pb-[calc(1.5rem+var(--notice-h,0px))] lg:px-8 lg:py-8 lg:pb-[calc(2rem+var(--notice-h,0px))]"
          >
            <div className="mx-auto w-full max-w-[var(--content-max)]">
              <Suspense fallback={null}>
                <AccessDeniedNotice />
              </Suspense>
              <RelatedPages navItems={navItems} />
              {children}
            </div>
          </main>
          <NoticeStack />
          <SavedToast />
          <SpellcheckDefaults />
          <footer className="no-print border-t border-border bg-surface px-3 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6 lg:px-8">
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
