// Deliberately NOT "use server": takes a live Supabase client, called from server actions only.
import type { createSupabaseServerClient } from "@/lib/supabase/server";
import { createNotification } from "@/lib/notifications/helpers";
import { NOTIFICATIONS_TABLE } from "@/lib/notifications/types";
import { directoryClient } from "@/lib/ncrs/recipients";
import { ITP_ITEMS_UNTYPED_TABLE } from "./db-types";
import { inspectionPassRecipients, inspectionStartRecipients } from "./inspection-notify-logic";

type Supabase = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/** Sends a notification unless the same recipient already has one with this title and link. */
export async function notifyOnce(
  supabase: Supabase,
  params: { organizationId: string; projectId: string; recipientUserId: string; title: string; body: string; link: string }
): Promise<void> {
  try {
    const { data: existing } = await directoryClient(supabase)
      .from(NOTIFICATIONS_TABLE)
      .select("id")
      .eq("recipient_user_id", params.recipientUserId)
      .eq("title", params.title)
      .eq("link", params.link)
      .limit(1);
    if (existing && existing.length > 0) return;
  } catch {
    // If the dedupe lookup fails, still notify: a duplicate is better than silence.
  }
  await createNotification(supabase, params);
}

/** JAGS staff working on the project: members of the teams assigned to it. */
async function projectStaffIds(supabase: Supabase, projectId: string): Promise<string[]> {
  const db = directoryClient(supabase);
  const { data: assignments } = await db.from("team_project_assignments").select("team_id").eq("project_id", projectId);
  const teamIds = (assignments ?? []).map((a: { team_id: string }) => a.team_id);
  if (teamIds.length === 0) return [];
  const { data: members } = await db.from("team_members").select("user_id").in("team_id", teamIds);
  return (members ?? []).map((m: { user_id: string }) => m.user_id);
}

/** In-app notice when an inspection STARTS: the project's responsible person and JAGS staff on it. Best-effort. */
export async function notifyInspectionStarted(
  supabase: Supabase,
  p: { organizationId?: string | null; projectId: string; recordId: string; recordNumber: string; activity: string; actorId: string | null }
): Promise<void> {
  try {
    const { data: project } = await supabase
      .from("projects")
      .select("responsible_person_id, organization_id")
      .eq("id", p.projectId)
      .maybeSingle<{ responsible_person_id: string | null; organization_id: string }>();
    const organizationId = p.organizationId ?? project?.organization_id;
    if (!organizationId) return;
    const recipients = inspectionStartRecipients({
      responsiblePersonId: project?.responsible_person_id ?? null,
      projectStaffIds: await projectStaffIds(supabase, p.projectId),
      actorId: p.actorId,
    });
    await Promise.all(
      recipients.map((recipientUserId) =>
        notifyOnce(supabase, {
          organizationId,
          projectId: p.projectId,
          recipientUserId,
          title: "Inspection started",
          body: `${p.activity} (${p.recordNumber})`,
          link: `/inspect/inspections/${p.recordId}`,
        })
      )
    );
  } catch {
    // Best-effort: never blocks starting the inspection.
  }
}

/** In-app notice when an inspection PASSES: the assigned person, else the activity's responsible people. Best-effort. */
export async function notifyInspectionPassed(
  supabase: Supabase,
  p: { organizationId?: string | null; projectId: string; recordId: string; recordNumber: string; activity: string; itpItemId: string; actorId: string | null }
): Promise<void> {
  try {
    const organizationId =
      p.organizationId ??
      (await supabase.from("projects").select("organization_id").eq("id", p.projectId).maybeSingle<{ organization_id: string }>()).data?.organization_id;
    if (!organizationId) return;
    const { data: item } = await supabase
      .from(ITP_ITEMS_UNTYPED_TABLE)
      .select("assigned_to_user_id, itp_sections(itps(prepared_by))")
      .eq("id", p.itpItemId)
      .maybeSingle<{ assigned_to_user_id: string | null; itp_sections: { itps: { prepared_by: string | null } | null } | null }>();
    const responsible: (string | null)[] = [item?.itp_sections?.itps?.prepared_by ?? null];
    const { data: parties } = await supabase
      .from("activity_party_intervention")
      .select("project_parties(user_id)")
      .eq("itp_item_id", p.itpItemId)
      .returns<{ project_parties: { user_id: string | null } | null }[]>();
    for (const row of parties ?? []) responsible.push(row.project_parties?.user_id ?? null);
    const recipients = inspectionPassRecipients({
      assignedToUserId: item?.assigned_to_user_id ?? null,
      responsibleUserIds: responsible.filter((v): v is string => !!v),
      actorId: p.actorId,
    });
    await Promise.all(
      recipients.map((recipientUserId) =>
        notifyOnce(supabase, {
          organizationId,
          projectId: p.projectId,
          recipientUserId,
          title: "Inspection passed",
          body: `${p.activity} (${p.recordNumber})`,
          link: `/inspect/inspections/${p.recordId}`,
        })
      )
    );
  } catch {
    // Best-effort: completion has already succeeded.
  }
}
