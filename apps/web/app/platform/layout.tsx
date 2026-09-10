import { redirect } from "next/navigation";
import { requireSession, canSeePlatformHome } from "@/lib/auth/session";
import { AppShell, type NavItem } from "@/components/domain/app-shell";

const NAV_ITEMS: NavItem[] = [{ label: "Orbit Home", href: "/platform" }];

export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  if (!canSeePlatformHome(session)) redirect("/inspect");

  return (
    <AppShell
      navItems={NAV_ITEMS}
      userName={session.fullName}
      userRole="JAGS Admin"
      breadcrumb="JAGS Assurance"
    >
      {children}
    </AppShell>
  );
}
