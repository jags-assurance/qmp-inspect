import { redirect } from "next/navigation";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { createSupabaseServiceRoleClient, isServiceRoleConfigured } from "@/lib/supabase/service";
import { untypedFrom } from "@/lib/supabase/untyped";
import { Badge } from "@/components/ui/badge";
import { T } from "@/components/domain/t";
import { computeConfigHealth, workerHeartbeat } from "@/lib/system-health/config";

/**
 * Staff-admin-only, read-only "System health": ON/OFF per feature (never the values), worker heartbeat,
 * email queue counts and failed background jobs. DB counts use the service role because worker_leases and
 * email_outbox are not readable by signed-in users; access is gated by isAdminStaff first.
 */
export async function SystemHealthView({ embedded = false }: { embedded?: boolean }) {
  const session = await requireSession();
  if (!isAdminStaff(session)) redirect("/inspect");

  const features = computeConfigHealth(process.env);

  let db: { heartbeat: ReturnType<typeof workerHeartbeat>; email: Record<string, number>; failedJobs: number } | null = null;
  if (isServiceRoleConfigured()) {
    try {
      const admin = createSupabaseServiceRoleClient();
      const count = async (table: string, status: string) => {
        const res = await untypedFrom(admin, table).select("id", { count: "exact", head: true }).eq("status", status);
        return res.count ?? 0;
      };
      const [lease, job, pending, sent, failed, skipped, failedJobs] = await Promise.all([
        untypedFrom(admin, "worker_leases").select("updated_at").order("updated_at", { ascending: false }).limit(1),
        untypedFrom(admin, "background_jobs").select("updated_at").order("updated_at", { ascending: false }).limit(1),
        count("email_outbox", "pending"),
        count("email_outbox", "sent"),
        count("email_outbox", "failed"),
        count("email_outbox", "skipped"),
        count("background_jobs", "failed"),
      ]);
      const first = (r: unknown) => ((r as { data: { updated_at: string }[] | null }).data ?? [])[0]?.updated_at;
      db = {
        heartbeat: workerHeartbeat([first(lease), first(job)], Date.now()),
        email: { pending, sent, failed, skipped },
        failedJobs,
      };
    } catch {
      db = null;
    }
  }

  const age = (s: number | null) => (s === null ? "no activity recorded" : s < 120 ? `${s}s ago` : s < 7200 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`);

  return (
    <div>
      {!embedded && <h1 className="text-2xl font-semibold tracking-tight text-text-strong sm:text-[1.75rem]"><T>System health</T></h1>}
      <p className="mt-1 text-sm text-muted"><T>Which features are configured. Values are never shown.</T></p>
      <ul className="mt-4 divide-y divide-border rounded-lg border border-border bg-surface">
        {features.map((f) => (
          <li key={f.key} className="flex items-start justify-between gap-4 p-3 text-sm">
            <div>
              <div className="font-medium text-ink">{f.label}</div>
              <div className="text-xs text-muted">{f.note}</div>
              {f.warning && <div className="mt-1 text-xs text-warning">{f.warning}</div>}
            </div>
            <Badge tone={f.on ? "success" : "warning"}>{f.on ? "ON" : "OFF"}</Badge>
          </li>
        ))}
        <li className="flex items-start justify-between gap-4 p-3 text-sm">
          <div>
            <div className="font-medium text-ink"><T>Background worker</T></div>
            <div className="text-xs text-muted">
              {db ? `Last activity ${age(db.heartbeat.ageSeconds)}.` : "Could not read worker activity (service role not configured or query failed)."}
            </div>
          </div>
          <Badge tone={db?.heartbeat.status === "ok" ? "success" : "warning"}>
            {db?.heartbeat.status === "ok" ? "ON" : db?.heartbeat.status === "stale" ? "STALE" : "UNKNOWN"}
          </Badge>
        </li>
      </ul>
      {db && (
        <div className="mt-4 grid gap-3 sm:grid-cols-5">
          {[
            ["Emails pending", db.email.pending],
            ["Emails sent", db.email.sent],
            ["Emails failed", db.email.failed],
            ["Emails skipped", db.email.skipped],
            ["Failed background jobs", db.failedJobs],
          ].map(([label, n]) => (
            <div key={label as string} className="rounded-lg border border-border bg-surface p-3">
              <div className="text-xs text-muted">{label}</div>
              <div className="text-xl font-semibold text-ink">{n}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
