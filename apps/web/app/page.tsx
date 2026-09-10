import { redirect } from "next/navigation";
import { requireSession, canSeePlatformHome } from "@/lib/auth/session";

// JAGS staff land on the Platform Home (billing/modules/organisation — their own account);
// everyone else goes straight into the QMP Inspect module, since external parties have no
// business reason to see JAGS's own SaaS account. Matches the rule already shipped in the demo
// prototype's loginAs()/canSeePlatform logic.
export default async function RootPage() {
  const session = await requireSession();
  redirect(canSeePlatformHome(session) ? "/platform" : "/inspect");
}
