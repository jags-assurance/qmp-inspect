"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { generateDocumentNumber } from "@/lib/numbering/generate";
import { createNotification } from "@/lib/notifications/helpers";

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
  const { error } = await supabase.from("itp_items").insert({
    section_id: sectionId,
    item_number: itemNumber,
    activity,
    acceptance_criteria: acceptanceCriteria || null,
    evidence_type: evidenceType === 2 || evidenceType === 3 ? evidenceType : 1,
    discipline_id: disciplineId || null,
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
    await supabase.from("activity_party_intervention").upsert(
      {
        itp_item_id: itpItemId,
        project_party_id: projectPartyId,
        intervention: intervention as "H" | "W" | "R" | "S",
      },
      { onConflict: "itp_item_id,project_party_id" }
    );
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

  const update =
    nextStatus === "under_review"
      ? { status: nextStatus, reviewed_by: user?.id ?? null }
      : { status: nextStatus, approved_by: user?.id ?? null };

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
