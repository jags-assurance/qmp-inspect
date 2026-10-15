import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PageGuide } from "@/components/domain/page-guide";
import { SettingsBackLink } from "@/app/inspect/settings/settings-back-link";
import { Badge } from "@/components/ui/badge";
import { T } from "@/components/domain/t";
import { getTranslator } from "@/lib/i18n/server";
import { isAnonymisedEmail } from "@/lib/data-requests/anonymise";
import { AnonymiseControl } from "./anonymise-control";
import { Button, buttonVariants } from "@/components/ui/button";

export const metadata: Metadata = { title: "Data requests" };

interface UserRow {
  id: string;
  full_name: string;
  email: string;
  is_active: boolean | null;
  is_jags_staff: boolean | null;
  staff_role: "admin" | "inspector" | null;
}

/**
 * U6: JAGS Admin tooling for data subject requests (docs/DATA_SUBJECT_REQUESTS.md): find an account by
 * email, download everything held about it as JSON, or anonymise it. Admin only.
 */
export default async function DataRequestsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const tl = await getTranslator();
  const session = await requireSession();
  if (!isAdminStaff(session)) redirect("/inspect");

  const q = ((await searchParams).q ?? "").trim().slice(0, 254);
  let matches: UserRow[] = [];
  if (q) {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase
      .from("users")
      .select("id, full_name, email, is_active, is_jags_staff, staff_role")
      .ilike("email", `%${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`)
      .order("email")
      .limit(10)
      .returns<UserRow[]>();
    matches = data ?? [];
  }

  return (
    <div className="max-w-3xl">
      <SettingsBackLink />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-text-strong sm:text-[1.75rem]"><T>Data requests</T></h1>
        <PageGuide
          title={tl("Data requests — how this works")}
          points={[
            "Admin-only. Use it to answer a person's request for a copy of their data, or for deletion. Verify who is asking first, and log the request (see docs/DATA_SUBJECT_REQUESTS.md).",
            "Export downloads one JSON file with everything held about the account: profile, access, memberships, audit events they performed, notifications, signing and photo metadata, comments and AI usage. Every export is written to the audit log.",
            "Anonymise replaces the name and email with placeholders and deactivates the account. No record is deleted: signed inspections, the audit trail and quality records stay, attributed to 'Former user'.",
            "The last active JAGS Admin and your own account cannot be anonymised.",
          ]}
        />
      </div>
      <p className="mt-1 text-sm text-muted">
        <T>Download everything the system holds about one person, or anonymise their account. Both are recorded in the audit log.</T>
      </p>

      <form method="get" className="mt-6 flex flex-wrap items-end gap-2">
        <label className="text-xs font-medium text-ink">
          <T>Email</T>
          <input
            name="q"
            type="search"
            defaultValue={q}
            required
            placeholder={tl("name@company.com")}
            className="mt-1 block min-h-11 w-72 rounded-md border border-border bg-surface px-3 py-2 text-sm"
          />
        </label>
        <Button type="submit" variant="outline">
          <T>Look up</T>
        </Button>
      </form>

      {q && matches.length === 0 && <p className="mt-6 text-sm text-muted"><T>No matching account found.</T></p>}

      <ul className="mt-6 space-y-4">
        {matches.map((u) => {
          const anonymised = isAnonymisedEmail(u.email);
          return (
            <li key={u.id} className="rounded-lg border border-border bg-surface p-4 shadow-xs sm:p-5">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold text-ink">{u.full_name}</p>
                {u.is_jags_staff && <Badge tone="info">{tl(u.staff_role === "inspector" ? "Inspector" : "Admin")}</Badge>}
                {u.is_active === false && <Badge tone="neutral">{tl("Deactivated")}</Badge>}
                {anonymised && <Badge tone="neutral">{tl("Anonymised")}</Badge>}
              </div>
              <p className="mt-0.5 break-all text-xs text-muted">{u.email}</p>
              <div className="mt-4 flex flex-wrap items-start gap-6">
                <div className="flex flex-col gap-1">
                  <a
                    href={`/inspect/organisation/data-requests/export?user_id=${u.id}`}
                    className={buttonVariants({ variant: "outline" })}
                  >
                    <T>Download data export (JSON)</T>
                  </a>
                  <p className="max-w-xs text-xs text-muted"><T>Contains personal data: send it only by the approved secure channel.</T></p>
                </div>
                {anonymised ? (
                  <p className="text-xs text-muted"><T>This account is already anonymised.</T></p>
                ) : u.id === session.userId ? (
                  <p className="text-xs text-muted"><T>You can&apos;t anonymise your own account.</T></p>
                ) : (
                  <AnonymiseControl userId={u.id} name={u.full_name} />
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
