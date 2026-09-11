import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { Button } from "@/components/ui/button";
import { StatCard } from "@/components/ui/stat-card";
import { NCRS_TABLE } from "@/lib/ncrs/types";
import { NcrsTable, type NcrRegisterRow } from "./ncrs-table";
import { isOverdue } from "./is-overdue";

export default async function NcrsPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>;
}) {
  const session = await requireSession();
  const { project: projectId } = await searchParams;
  const supabase = await createSupabaseServerClient();

  let query = supabase
    .from(NCRS_TABLE)
    .select("id, ncr_number, severity, description, status, due_date, projects(name, project_number)")
    .order("created_at", { ascending: false });
  if (projectId) query = query.eq("project_id", projectId);

  const { data: ncrs } = await query.returns<NcrRegisterRow[]>();

  const rows = ncrs ?? [];
  const total = rows.length;
  const open = rows.filter((r) => r.status !== "closed").length;
  const closed = rows.filter((r) => r.status === "closed").length;
  const overdue = rows.filter(isOverdue).length;

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ink">NCR & Observation Register</h1>
          <p className="mt-1 text-sm text-muted">
            {session.isJagsStaff
              ? "Non-conformances and observations across every project you have access to."
              : "Non-conformances and observations on your organisation's projects."}
          </p>
        </div>
        <Link href="/inspect/ncrs/new">
          <Button>+ Raise NCR</Button>
        </Link>
      </div>

      {projectId && (
        <p className="mt-3 text-sm text-muted">
          Filtered to one project.{" "}
          <Link href="/inspect/ncrs" className="text-burgundy hover:underline">
            Clear filter
          </Link>
        </p>
      )}

      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Total" value={total} />
        <StatCard label="Open" value={open} />
        <StatCard label="Overdue" value={overdue} />
        <StatCard label="Closed" value={closed} />
      </div>

      <div className="mt-6">
        <NcrsTable rows={rows} />
      </div>
    </div>
  );
}
