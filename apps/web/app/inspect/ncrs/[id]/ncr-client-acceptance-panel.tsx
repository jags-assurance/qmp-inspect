import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { PROJECT_PARTY_MEMBERS_TABLE } from "@/lib/projects/party-access-types";
import { NCRS_TABLE } from "@/lib/ncrs/types";
import { dispositionSuggestsClientAcceptance } from "@/lib/ncrs/acceptance";
import { formatSiteDateTime } from "@/lib/ncrs/site-date";
import { ClientAcceptanceForm, ClientAcceptanceRequiredToggle } from "./ncr-client-acceptance";
import { AUDIT_LOG_TABLE } from "@/lib/audit/types";
import { T } from "@/components/domain/t";

interface AcceptanceRow {
  client_acceptance_required: boolean | null;
  client_accepted_at: string | null;
  client_acceptance_decision: string | null;
  client_acceptance_comment: string | null;
  client_accepted_by_user: { full_name: string } | null;
}

/**
 * Client acceptance step (S5-22). Reads its own columns, so the page still works when migration
 * 20261110000400 is not applied: a failed read renders nothing.
 */
export async function NcrClientAcceptancePanel({
  ncrId,
  projectId,
  status,
  disposition,
  withdrawn,
}: {
  ncrId: string;
  projectId: string;
  status: string;
  disposition: string | null;
  withdrawn: boolean;
}) {
  if (withdrawn) return null;
  const session = await requireSession();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from(NCRS_TABLE)
    .select(
      "client_acceptance_required, client_accepted_at, client_acceptance_decision, client_acceptance_comment, client_accepted_by_user:users!ncrs_client_accepted_by_fkey(full_name)"
    )
    .eq("id", ncrId)
    .maybeSingle<AcceptanceRow>();
  let row: AcceptanceRow | null = data ?? null;
  if (error) {
    // The embed name may differ; retry without the name join before giving up.
    const retry = await supabase
      .from(NCRS_TABLE)
      .select("client_acceptance_required, client_accepted_at, client_acceptance_decision, client_acceptance_comment")
      .eq("id", ncrId)
      .maybeSingle<Omit<AcceptanceRow, "client_accepted_by_user">>();
    if (retry.error || !retry.data) return null;
    row = { ...retry.data, client_accepted_by_user: null };
  }
  if (!row) return null;

  const required = row.client_acceptance_required === true;
  const staff = session.isJagsStaff;
  const isClosed = status === "closed";
  // Staff see the toggle (until closed); everyone else only sees the panel when it applies.
  if (!required && !(staff && !isClosed)) return null;

  let isClientUser = false;
  if (required && !isClosed && !staff) {
    const { data: parties } = await supabase
      .from("project_parties")
      .select("id, user_id")
      .eq("project_id", projectId)
      .eq("party_type", "client")
      .eq("is_active", true)
      .returns<{ id: string; user_id: string | null }[]>();
    const list = parties ?? [];
    isClientUser = list.some((p) => p.user_id === session.userId);
    if (!isClientUser && list.length > 0) {
      const { data: members } = await supabase
        .from(PROJECT_PARTY_MEMBERS_TABLE)
        .select("id")
        .in("project_party_id", list.map((p) => p.id))
        .eq("user_id", session.userId)
        .limit(1)
        .returns<{ id: string }[]>();
      isClientUser = (members ?? []).length > 0;
    }
  }
  const canDecide = required && !isClosed && status !== "open" && !!disposition && (isAdminStaff(session) || isClientUser);
  const decided = row.client_acceptance_decision;
  // When the client was last asked (latest "required" audit event); best-effort, the line is omitted if unreadable.
  let askedAt: string | null = null;
  if (required && !decided && !isClosed) {
    try {
      // Preferred: the stored date (ncrs.client_acceptance_requested_at); falls back to the audit event.
      const { data: stored, error: storedError } = await supabase
        .from(NCRS_TABLE)
        .select("client_acceptance_requested_at" as never)
        .eq("id", ncrId)
        .maybeSingle<{ client_acceptance_requested_at: string | null }>();
      if (!storedError && stored?.client_acceptance_requested_at) askedAt = stored.client_acceptance_requested_at;
    } catch {
      askedAt = null;
    }
    try {
      if (askedAt) throw new Error("have it");
      const { data: ev } = await supabase
        .from(AUDIT_LOG_TABLE)
        .select("created_at")
        .eq("entity_type", "ncr")
        .eq("entity_id", ncrId)
        .eq("action", "client_acceptance_required")
        .order("created_at", { ascending: false })
        .limit(1)
        .returns<{ created_at: string }[]>();
      askedAt = ev?.[0]?.created_at ?? null;
    } catch {
      // Keep whatever was found (stored date), or none.
    }
  }

  return (
    <div className="mt-4 rounded-lg border border-border bg-surface p-4">
      <h2 className="font-medium text-ink"><T>Client acceptance</T></h2>
      {staff && !isClosed && <ClientAcceptanceRequiredToggle ncrId={ncrId} required={required} />}
      {staff && !isClosed && !required && dispositionSuggestsClientAcceptance(disposition) && (
        <p className="mt-1 text-xs text-muted"><T>This disposition leaves the work not simply put right to specification; consider asking the client to accept it.</T></p>
      )}
      {required && (
        <div className="mt-2 text-sm">
          {decided ? (
            <p className={decided === "accepted" ? "text-success" : "text-danger"}>
              {decided === "accepted" ? "Accepted" : "Rejected"} <T>by</T> {row.client_accepted_by_user?.full_name ?? "the client"}
              {row.client_accepted_at ? ` on ${formatSiteDateTime(row.client_accepted_at)}` : ""}
              {row.client_acceptance_comment ? `: ${row.client_acceptance_comment}` : "."}
            </p>
          ) : (
            <p className="text-muted">
              {disposition ? "Waiting for the client to accept the disposition. The NCR cannot be closed until they do." : "Record the disposition so the client can accept it."}
              {disposition && askedAt ? ` Waiting for client acceptance since ${formatSiteDateTime(askedAt)}.` : ""}
            </p>
          )}
          {canDecide && <ClientAcceptanceForm ncrId={ncrId} />}
        </div>
      )}
    </div>
  );
}
