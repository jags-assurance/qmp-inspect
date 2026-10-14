"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { recordAuditEvent } from "@/lib/audit/log";
import { createNotification } from "@/lib/notifications/helpers";
import { isMissingSchemaError } from "@/lib/offline/missing-schema";
import { PROJECT_PARTY_MEMBERS_TABLE } from "@/lib/projects/party-access-types";
import { NCRS_TABLE } from "@/lib/ncrs/types";
import { partyUserIds, permissionHolderIds } from "@/lib/ncrs/recipients";
import { projectTeamLeadIds } from "@/lib/ncrs/unowned";
import { canRecordClientAcceptance, validateAcceptanceInput } from "@/lib/ncrs/acceptance";

type Supabase = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/** True when this user's login is linked to an active client-type party of the project (directly or as a team member). */
async function isClientPartyUserForProject(supabase: Supabase, projectId: string, userId: string): Promise<boolean> {
  const { data: parties } = await supabase
    .from("project_parties")
    .select("id, user_id")
    .eq("project_id", projectId)
    .eq("party_type", "client")
    .eq("is_active", true)
    .returns<{ id: string; user_id: string | null }[]>();
  const list = parties ?? [];
  if (list.some((p) => p.user_id === userId)) return true;
  if (list.length === 0) return false;
  const { data: members } = await supabase
    .from(PROJECT_PARTY_MEMBERS_TABLE)
    .select("id")
    .in("project_party_id", list.map((p) => p.id))
    .eq("user_id", userId)
    .limit(1)
    .returns<{ id: string }[]>();
  return (members ?? []).length > 0;
}

/** Logins of every active client-type party of the project (primary login plus team members). */
async function clientPartyUserIds(supabase: Supabase, projectId: string): Promise<string[]> {
  const { data: parties } = await supabase
    .from("project_parties")
    .select("id")
    .eq("project_id", projectId)
    .eq("party_type", "client")
    .eq("is_active", true)
    .returns<{ id: string }[]>();
  const out = new Set<string>();
  for (const p of parties ?? []) for (const id of await partyUserIds(supabase, p.id)) out.add(id);
  return [...out];
}

export interface ClientAcceptanceState {
  error: string | null;
  done?: boolean;
}

/** JAGS staff mark an NCR as needing the client's acceptance of its disposition (or clear it). */
export async function setClientAcceptanceRequiredAction(_prev: ClientAcceptanceState, formData: FormData): Promise<ClientAcceptanceState> {
  const ncrId = String(formData.get("ncr_id") ?? "").trim();
  const required = formData.get("required") === "on";
  if (!ncrId) return { error: "Missing NCR." };
  const session = await requireSession();
  if (!session.isJagsStaff) return { error: "Only JAGS staff can change whether client acceptance is required." };

  const supabase = await createSupabaseServerClient();
  const { data: cur } = await supabase
    .from(NCRS_TABLE)
    .select("status, project_id, ncr_number, client_acceptance_decision, projects(organization_id)")
    .eq("id", ncrId)
    .maybeSingle<{ status: string; project_id: string; ncr_number: string; client_acceptance_decision: string | null; projects: { organization_id: string } | null }>();
  if (!cur) return { error: "NCR not found, or you don't have access to it." };
  if (cur.status === "closed") return { error: "This NCR is already closed." };

  // Turning it off, or on again, clears an earlier decision so a stale acceptance never carries over.
  const { error } = await supabase
    .from(NCRS_TABLE)
    .update({
      client_acceptance_required: required,
      client_accepted_at: null,
      client_accepted_by: null,
      client_acceptance_decision: null,
      client_acceptance_comment: null,
    })
    .eq("id", ncrId);
  if (error) {
    if (isMissingSchemaError(error)) return { error: "Client acceptance needs a database update that has not been applied yet." };
    return { error: "Could not save. Check you have permission and try again." };
  }
  if (cur.projects?.organization_id) {
    try {
      await recordAuditEvent(supabase, {
        organizationId: cur.projects.organization_id,
        projectId: cur.project_id,
        entityType: "ncr",
        entityId: ncrId,
        action: required ? "client_acceptance_required" : "client_acceptance_not_required",
        actorId: session.userId,
        summary: `NCR ${cur.ncr_number}: client acceptance ${required ? "required" : "no longer required"}`,
      });
    } catch {
      // Best-effort audit.
    }
  }
  // Asking (or asking again) tells the client party that their acceptance is the thing holding this NCR.
  if (required && cur.projects?.organization_id) {
    try {
      for (const recipientUserId of new Set(await clientPartyUserIds(supabase, cur.project_id))) {
        if (recipientUserId === session.userId) continue;
        await createNotification(supabase, {
          organizationId: cur.projects.organization_id,
          projectId: cur.project_id,
          recipientUserId,
          title: "Client acceptance required",
          body: `${cur.ncr_number}: please review the disposition and accept or reject it.`,
          link: `/inspect/ncrs/${ncrId}`,
        });
      }
    } catch {
      // Best-effort notifications.
    }
  }
  revalidatePath(`/inspect/ncrs/${ncrId}`);
  return { error: null, done: true };
}

/** The client (or an admin on their behalf) accepts or rejects the recorded disposition. */
export async function recordClientAcceptanceAction(_prev: ClientAcceptanceState, formData: FormData): Promise<ClientAcceptanceState> {
  const ncrId = String(formData.get("ncr_id") ?? "").trim();
  if (!ncrId) return { error: "Missing NCR." };
  const parsed = validateAcceptanceInput(String(formData.get("decision") ?? ""), String(formData.get("comment") ?? ""));
  if ("error" in parsed) return { error: parsed.error };

  const session = await requireSession();
  const supabase = await createSupabaseServerClient();
  const { data: cur } = await supabase
    .from(NCRS_TABLE)
    .select("status, project_id, ncr_number, raised_by, assigned_to, responsible_party_id, disposition, withdrawn_at, client_acceptance_required, projects(organization_id)")
    .eq("id", ncrId)
    .maybeSingle<{
      status: string;
      project_id: string;
      ncr_number: string;
      raised_by: string | null;
      assigned_to: string | null;
      responsible_party_id: string | null;
      disposition: string | null;
      withdrawn_at: string | null;
      client_acceptance_required: boolean | null;
      projects: { organization_id: string } | null;
    }>();
  if (!cur) return { error: "NCR not found, or you don't have access to it." };
  if (cur.status === "closed") return { error: "This NCR is already closed." };

  const admin = isAdminStaff(session);
  const verdict = canRecordClientAcceptance({
    isAdminStaff: admin,
    isClientPartyUser: admin ? false : await isClientPartyUserForProject(supabase, cur.project_id, session.userId),
    required: cur.client_acceptance_required === true,
    status: cur.status,
    withdrawn: !!cur.withdrawn_at,
    disposition: cur.disposition,
  });
  if (!verdict.ok) return { error: verdict.error };

  const { data: updated, error } = await supabase
    .from(NCRS_TABLE)
    .update({
      client_accepted_at: new Date().toISOString(),
      client_accepted_by: session.userId,
      client_acceptance_decision: parsed.decision,
      client_acceptance_comment: parsed.comment,
    })
    .eq("id", ncrId)
    .neq("status", "closed")
    .select("id")
    .maybeSingle<{ id: string }>();
  if (error) {
    if (isMissingSchemaError(error)) return { error: "Client acceptance needs a database update that has not been applied yet." };
    return { error: "Could not save the decision. Check you have permission and try again." };
  }
  if (!updated) return { error: "This NCR changed meanwhile. Refresh and try again." };

  const orgId = cur.projects?.organization_id;
  if (orgId) {
    try {
      await recordAuditEvent(supabase, {
        organizationId: orgId,
        projectId: cur.project_id,
        entityType: "ncr",
        entityId: ncrId,
        action: parsed.decision === "accepted" ? "client_accepted" : "client_rejected",
        actorId: session.userId,
        summary: `NCR ${cur.ncr_number}: client ${parsed.decision} the disposition${admin ? " (recorded by a JAGS admin)" : ""}${parsed.comment ? ` - ${parsed.comment}` : ""}`,
        changes: { decision: parsed.decision, comment: parsed.comment, on_behalf: admin },
      });
      // A rejection must reach whoever owns the NCR: raiser, assignee, responsible party members, team leads and closers.
      const owners =
        parsed.decision === "rejected"
          ? [
              ...(await partyUserIds(supabase, cur.responsible_party_id)),
              ...(await projectTeamLeadIds(supabase, cur.project_id)),
              ...(await permissionHolderIds(supabase, "close_ncr", cur.project_id)),
            ]
          : [];
      for (const recipientUserId of new Set([cur.raised_by, cur.assigned_to, ...owners].filter((v): v is string => !!v && v !== session.userId))) {
        await createNotification(supabase, {
          organizationId: orgId,
          projectId: cur.project_id,
          recipientUserId,
          title: `Client ${parsed.decision} the disposition`,
          body: `${cur.ncr_number}${parsed.comment ? `: ${parsed.comment}` : ""}`,
          link: `/inspect/ncrs/${ncrId}`,
        });
      }
    } catch {
      // Best-effort audit + notifications.
    }
  }
  revalidatePath(`/inspect/ncrs/${ncrId}`);
  return { error: null, done: true };
}
