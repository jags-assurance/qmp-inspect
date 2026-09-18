"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { generateDocumentNumber } from "@/lib/numbering/generate";
import { createNotification } from "@/lib/notifications/helpers";
import { INTERVENTION_LEVEL_TYPES_TABLE } from "@/lib/intervention-levels/types";

// Default section structure from the Requirements doc (R24 examples) — a starting point the user
// can add to, rename, or reorder; sections are explicitly not fixed.
const DEFAULT_SECTIONS = [
  { section_number: 1, title: "Submittals & Materials" },
  { section_number: 2, title: "Installation / Execution" },
  { section_number: 3, title: "Testing & Commissioning" },
  { section_number: 4, title: "Handover" },
];

export interface CreateItpState {
  error: string | null;
}

export async function createItpAction(_prev: CreateItpState, formData: FormData): Promise<CreateItpState> {
  const projectId = String(formData.get("project_id") ?? "").trim();
  const itpNumberOverride = String(formData.get("itp_number") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim();
  const applicableStandard = String(formData.get("applicable_standard") ?? "").trim();

  if (!projectId || !title) {
    return { error: "Project and title are required." };
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: project } = await supabase
    .from("projects")
    .select("project_number, organization_id")
    .eq("id", projectId)
    .maybeSingle<{ project_number: string; organization_id: string }>();

  if (!project) {
    return { error: "Project not found." };
  }

  // Auto-generated via the same numbering engine every other document type uses (client's own
  // numbering format if configured, else a sensible default) — a manual override is still accepted
  // for the rare case a specific number needs to be forced (e.g. matching a legacy/external scheme).
  const itpNumber =
    itpNumberOverride ||
    (
      await generateDocumentNumber(supabase, {
        organizationId: project.organization_id,
        projectId,
        docType: "itp",
        projectNumber: project.project_number,
      })
    ).documentNumber;

  const { data: itp, error } = await supabase
    .from("itps")
    .insert({
      project_id: projectId,
      itp_number: itpNumber,
      title,
      applicable_standard: applicableStandard || null,
      prepared_by: user?.id ?? null,
    })
    .select("id")
    .single();

  if (error || !itp) {
    if (error?.code === "23505") {
      return { error: "An ITP with that number already exists for this project." };
    }
    return { error: "Could not create the ITP. Check you have permission and try again." };
  }

  const { error: sectionsError } = await supabase
    .from("itp_sections")
    .insert(DEFAULT_SECTIONS.map((s, i) => ({ itp_id: itp.id, sort_order: i, ...s })));

  if (sectionsError) {
    return { error: "ITP created, but default sections could not be added." };
  }

  redirect(`/inspect/itps/${itp.id}`);
}

export interface AddItemState {
  error: string | null;
}

export async function addItpItemAction(_prev: AddItemState, formData: FormData): Promise<AddItemState> {
  const sectionId = String(formData.get("section_id") ?? "").trim();
  const itpId = String(formData.get("itp_id") ?? "").trim();
  const itemNumber = String(formData.get("item_number") ?? "").trim();
  const activity = String(formData.get("activity") ?? "").trim();
  const acceptanceCriteria = String(formData.get("acceptance_criteria") ?? "").trim();
  const evidenceType = Number(formData.get("evidence_type") ?? 1);
  const disciplineId = String(formData.get("discipline_id") ?? "").trim();

  if (!sectionId || !itemNumber || !activity) {
    return { error: "Item number and activity are required." };
  }

  const supabase = await createSupabaseServerClient();

  // itp_items.sort_order defaults to 0 in the schema, and this was the only item-creation path that
  // never set it (the AI-draft and master-template-clone paths both assign sort_order: i on insert —
  // see ai-draft-actions.ts and itp-master/actions.ts). Every manually-added item was landing at 0,
  // so once a section had more than one, display order fell back to whatever order Postgrest's
  // embedded-resource query happened to return — not necessarily the item_number sequence the
  // inspector actually typed. Appending after the current highest sort_order in this section keeps
  // manually-added items in the order they were added, matching the other two creation paths.
  const { data: lastItem } = await supabase
    .from("itp_items")
    .select("sort_order")
    .eq("section_id", sectionId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle<{ sort_order: number }>();
  const nextSortOrder = (lastItem?.sort_order ?? -1) + 1;

  const { error } = await supabase.from("itp_items").insert({
    section_id: sectionId,
    item_number: itemNumber,
    activity,
    acceptance_criteria: acceptanceCriteria || null,
    evidence_type: evidenceType === 2 || evidenceType === 3 ? evidenceType : 1,
    discipline_id: disciplineId || null,
    sort_order: nextSortOrder,
  });

  if (error) {
    return { error: "Could not add the activity. Check you have permission and try again." };
  }

  revalidatePath(`/inspect/itps/${itpId}`);
  return { error: null };
}

export async function setInterventionAction(formData: FormData) {
  const itpId = String(formData.get("itp_id") ?? "").trim();
  const itpItemId = String(formData.get("itp_item_id") ?? "").trim();
  const projectPartyId = String(formData.get("project_party_id") ?? "").trim();
  const intervention = String(formData.get("intervention") ?? "").trim();

  const supabase = await createSupabaseServerClient();

  if (!intervention) {
    await supabase
      .from("activity_party_intervention")
      .delete()
      .eq("itp_item_id", itpItemId)
      .eq("project_party_id", projectPartyId);
  } else {
    // Look up the label for the notification below (and, incidentally, resolve the organisation so
    // we know which org's levels to check against) before writing the row — the DB itself is the
    // real source of truth for "is this a valid code" (validate_activity_intervention_code trigger,
    // supabase/migrations/20260917090000_configurable_intervention_levels.sql), this is just so the
    // notification reads e.g. "Client QA Review" for a custom level instead of a bare code.
    const { data: context } = await supabase
      .from("itp_items")
      .select("activity, itp_sections(itps(itp_number, project_id, projects(organization_id)))")
      .eq("id", itpItemId)
      .maybeSingle<{
        activity: string;
        itp_sections: {
          itps: {
            itp_number: string;
            project_id: string;
            projects: { organization_id: string } | null;
          } | null;
        } | null;
      }>();

    const itp = context?.itp_sections?.itps;
    const organizationId = itp?.projects?.organization_id;

    let interventionLabel = intervention;
    if (organizationId) {
      const { data: levelType } = await supabase
        .from(INTERVENTION_LEVEL_TYPES_TABLE)
        .select("label")
        .eq("organization_id", organizationId)
        .eq("code", intervention)
        .maybeSingle<{ label: string }>();
      if (levelType?.label) interventionLabel = levelType.label;
    }

    const { error: upsertError } = await supabase.from("activity_party_intervention").upsert(
      {
        itp_item_id: itpItemId,
        project_party_id: projectPartyId,
        intervention,
      },
      { onConflict: "itp_item_id,project_party_id" }
    );

    if (upsertError) {
      revalidatePath(`/inspect/itps/${itpId}`);
      return;
    }

    // Best-effort: the assigned party otherwise has no signal at all that they're now responsible
    // for a sign-off — the only other notification in this flow is notifyPartyAction, which fires
    // solely when someone manually clicks "Notify" on the resulting activity_signoff_progress row.
    // Without this, a party can go unaware of new intervention work indefinitely. Never blocks the
    // intervention assignment itself, which has already succeeded above.
    try {
      const { data: party } = await supabase
        .from("project_parties")
        .select("user_id")
        .eq("id", projectPartyId)
        .maybeSingle<{ user_id: string | null }>();

      if (party?.user_id && itp && organizationId) {
        await createNotification(supabase, {
          organizationId,
          projectId: itp.project_id,
          recipientUserId: party.user_id,
          title: `${interventionLabel} point assigned to you`,
          body: `${context?.activity} (${itp.itp_number})`,
          link: `/inspect/itps/${itpId}`,
        });
      }
    } catch {
      // Notification delivery is best-effort — see comment above.
    }
  }

  revalidatePath(`/inspect/itps/${itpId}`);
}

const NEXT_STATUS = {
  draft: "under_review",
  under_review: "approved",
} as const;

export async function advanceItpStatusAction(formData: FormData) {
  const itpId = String(formData.get("itp_id") ?? "").trim();
  const fromStatus = String(formData.get("from_status") ?? "").trim() as keyof typeof NEXT_STATUS;
  const nextStatus = NEXT_STATUS[fromStatus];
  if (!nextStatus) return;

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const now = new Date().toISOString();
  const update =
    nextStatus === "under_review"
      ? { status: nextStatus, reviewed_by: user?.id ?? null, reviewed_at: now }
      : { status: nextStatus, approved_by: user?.id ?? null, approved_at: now };

  const { error } = await supabase.from("itps").update(update).eq("id", itpId).eq("status", fromStatus);

  // Best-effort: once Approved, the client's own acceptance is the next real step in the workflow
  // (accept_itp()) — notify their linked user directly rather than relying on them noticing it on
  // their own dashboard. Never blocks the status change itself, which has already succeeded.
  if (!error && nextStatus === "approved") {
    try {
      const { data: itp } = await supabase
        .from("itps")
        .select("itp_number, title, project_id, projects(organization_id)")
        .eq("id", itpId)
        .maybeSingle<{
          itp_number: string;
          title: string;
          project_id: string;
          projects: { organization_id: string } | null;
        }>();

      if (itp?.projects?.organization_id) {
        const { data: clientParty } = await supabase
          .from("project_parties")
          .select("user_id")
          .eq("project_id", itp.project_id)
          .eq("party_type", "client")
          .not("user_id", "is", null)
          .returns<{ user_id: string | null }[]>();

        for (const party of clientParty ?? []) {
          if (!party.user_id) continue;
          await createNotification(supabase, {
            organizationId: itp.projects.organization_id,
            projectId: itp.project_id,
            recipientUserId: party.user_id,
            title: "ITP ready for your acceptance",
            body: `${itp.itp_number} — ${itp.title}`,
            link: `/inspect/itps/${itpId}`,
          });
        }
      }
    } catch {
      // Best-effort — see doc comment above.
    }
  }

  revalidatePath(`/inspect/itps/${itpId}`);
}

export async function acceptItpAction(formData: FormData) {
  const itpId = String(formData.get("itp_id") ?? "").trim();
  const supabase = await createSupabaseServerClient();
  await supabase.rpc("accept_itp", { target_itp_id: itpId });
  revalidatePath(`/inspect/itps/${itpId}`);
}
