"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { recordAuditEvent } from "@/lib/audit/log";
import { createNotification } from "@/lib/notifications/helpers";
import { sectionDeleteBlocker } from "@/lib/itps/guards";
import { exitRequestError, isTerminalItpStatus } from "@/lib/itps/lifecycle";

// S2-08: controlled exits for an ITP. A wrongly created draft can be deleted (only while nothing has been
// done with it); an issued ITP can be marked superseded (replaced by another) or withdrawn, with a reason
// and who/when. Superseded / withdrawn ITPs are read-only and are meant to be excluded from readiness.

export interface ItpExitState {
  error: string | null;
}

const MISSING = new Set(["42703", "PGRST204", "23514"]);

export async function withdrawItpAction(_prev: ItpExitState, formData: FormData): Promise<ItpExitState> {
  const itpId = String(formData.get("itp_id") ?? "").trim();
  const mode = String(formData.get("mode") ?? "withdrawn").trim() === "superseded" ? "superseded" : "withdrawn";
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 1000);
  const replacementId = String(formData.get("superseded_by_itp_id") ?? "").trim();
  if (!itpId) return { error: "Missing ITP." };
  const requestError = exitRequestError({ mode, reason, replacementId, itpId });
  if (requestError) return { error: requestError };

  const session = await requireSession();
  if (!session.isJagsStaff) return { error: "Only JAGS staff can withdraw or supersede an ITP." };

  const supabase = await createSupabaseServerClient();
  const { data: itp } = await supabase
    .from("itps")
    .select("status, itp_number, title, project_id, projects(organization_id)")
    .eq("id", itpId)
    .maybeSingle<{ status: string; itp_number: string; title: string; project_id: string; projects: { organization_id: string } | null }>();
  if (!itp) return { error: "ITP not found." };
  if (isTerminalItpStatus(itp.status)) return { error: `This ITP is already ${itp.status}.` };

  let replacement: { id: string; itp_number: string; status: string } | null = null;
  if (mode === "superseded") {
    const { data: r } = await supabase.from("itps").select("id, itp_number, status").eq("id", replacementId).eq("project_id", itp.project_id).neq("status", "withdrawn").maybeSingle<{ id: string; itp_number: string; status: string }>();
    if (!r) return { error: "The replacement ITP must be on the same project and not withdrawn." };
    replacement = r;
  }

  const { data: updated, error } = await supabase
    .from("itps")
    .update({
      status: mode,
      withdrawn_reason: reason,
      withdrawn_by: session.userId,
      withdrawn_at: new Date().toISOString(),
      superseded_by_itp_id: replacement?.id ?? null,
    } as never)
    .eq("id", itpId)
    .eq("status", itp.status)
    .select("id");
  if (error && (MISSING.has(error.code ?? "") || error.code === "42703")) {
    return { error: "This needs a pending database update (ITP statuses superseded/withdrawn). Ask an administrator to apply the latest migrations." };
  }
  if (error || !updated?.length) return { error: "Could not update the ITP. It may have changed — refresh and try again." };

  try {
    if (itp.projects?.organization_id) {
      await recordAuditEvent(supabase, {
        organizationId: itp.projects.organization_id,
        projectId: itp.project_id,
        entityType: "itp",
        entityId: itpId,
        action: mode,
        actorId: session.userId,
        summary: `ITP ${itp.itp_number} ${mode}${replacement ? ` — replaced by ${replacement.itp_number}` : ""}: ${reason}`,
      });
      const { data: clients } = await supabase
        .from("project_parties")
        .select("user_id")
        .eq("project_id", itp.project_id)
        .in("party_type", ["client", "main_contractor", "subcontractor"])
        .eq("is_active", true)
        .not("user_id", "is", null)
        .returns<{ user_id: string }[]>();
      for (const p of clients ?? []) {
        await createNotification(supabase, {
          organizationId: itp.projects.organization_id,
          projectId: itp.project_id,
          recipientUserId: p.user_id,
          title: `ITP ${itp.itp_number} ${mode}`,
          body: replacement ? `Replaced by ${replacement.itp_number}. ${reason}` : reason,
          link: `/inspect/itps/${itpId}`,
        });
      }
    }
  } catch {
    // Best-effort.
  }

  revalidatePath(`/inspect/itps/${itpId}`);
  revalidatePath("/inspect/itps");
  return { error: null };
}

/** Deletes a draft ITP that was never submitted, never revised and has no activity history. */
export async function deleteDraftItpAction(_prev: ItpExitState, formData: FormData): Promise<ItpExitState> {
  const itpId = String(formData.get("itp_id") ?? "").trim();
  if (!itpId) return { error: "Missing ITP." };
  const session = await requireSession();
  const supabase = await createSupabaseServerClient();

  const { data: itp } = await supabase
    .from("itps")
    .select("status, revision, reviewed_by, itp_number, project_id, projects(organization_id)")
    .eq("id", itpId)
    .maybeSingle<{ status: string; revision: number; reviewed_by: string | null; itp_number: string; project_id: string; projects: { organization_id: string } | null }>();
  if (!itp) return { error: "ITP not found." };
  if (itp.status !== "draft" || itp.reviewed_by || itp.revision !== 0) {
    return { error: "Only a draft that was never submitted for review can be deleted. Withdraw it instead." };
  }

  const { data: sections } = await supabase.from("itp_sections").select("id").eq("itp_id", itpId).returns<{ id: string }[]>();
  for (const s of sections ?? []) {
    const blocker = await sectionDeleteBlocker(supabase, s.id);
    if (blocker) return { error: `This draft already has history. ${blocker}` };
  }
  const { count: revisions } = await supabase.from("itp_revisions" as never).select("id", { count: "exact", head: true }).eq("itp_id" as never, itpId as never);
  if (revisions) return { error: "This ITP has revision history, so it can't be deleted. Withdraw it instead." };

  const { data: deleted, error } = await supabase.from("itps").delete().eq("id", itpId).select("id");
  if (error || !deleted?.length) return { error: "Could not delete the ITP. You may not have permission." };

  try {
    if (itp.projects?.organization_id) {
      await recordAuditEvent(supabase, {
        organizationId: itp.projects.organization_id,
        projectId: itp.project_id,
        entityType: "itp",
        entityId: itpId,
        action: "draft_deleted",
        actorId: session.userId,
        summary: `Draft ITP ${itp.itp_number} deleted`,
      });
    }
  } catch {
    // Best-effort.
  }
  revalidatePath("/inspect/itps");
  redirect("/inspect/itps");
}
