"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { getSelfManagedOrgIdsForUser } from "@/lib/rbac/access";
import { INSPECTION_LOCATION_PRESETS_TABLE } from "./location-presets";

async function canManagePresets(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  session: Awaited<ReturnType<typeof requireSession>>,
  organizationId: string
): Promise<boolean> {
  if (isAdminStaff(session)) return true;
  const { data: org } = await supabase
    .from("organizations")
    .select("engagement_scope")
    .eq("id", organizationId)
    .maybeSingle<{ engagement_scope: string }>();
  if (org?.engagement_scope !== "self_managed" && org?.engagement_scope !== "client_managed") return false;
  // Organisation-wide members only — not a project-scoped contractor/TPI.
  return (await getSelfManagedOrgIdsForUser(supabase, session.userId)).has(organizationId);
}

export interface AddLocationPresetState {
  error: string | null;
}

/**
 * Adds one named preset location, scoped to a project (or org-wide default when project_id is
 * omitted). Same authority bar as numbering_configs: JAGS Admin always, or a self_managed/
 * client_managed org managing its own list — never a full_service client, since this is JAGS's own
 * project configuration in that tier.
 */
export async function addLocationPresetAction(_prev: AddLocationPresetState, formData: FormData): Promise<AddLocationPresetState> {
  const organizationId = String(formData.get("organization_id") ?? "").trim();
  const projectId = String(formData.get("project_id") ?? "").trim() || null;
  const name = String(formData.get("name") ?? "").trim();

  if (!organizationId || !name) return { error: "Missing organisation or location name." };

  const session = await requireSession();
  const supabase = await createSupabaseServerClient();

  if (!(await canManagePresets(supabase, session, organizationId))) {
    return { error: "Only a JAGS Admin, or a self-managed/client-managed organisation's own admin, can manage preset locations." };
  }

  const { error } = await supabase.from(INSPECTION_LOCATION_PRESETS_TABLE).insert({
    organization_id: organizationId,
    project_id: projectId,
    name,
  });

  if (error) {
    return { error: error.code === "23505" ? "That location is already in the list." : "Could not add this location." };
  }

  if (projectId) revalidatePath(`/inspect/projects/${projectId}`);
  return { error: null };
}

export interface RemoveLocationPresetState {
  error: string | null;
}

export async function removeLocationPresetAction(
  _prev: RemoveLocationPresetState,
  formData: FormData
): Promise<RemoveLocationPresetState> {
  const presetId = String(formData.get("preset_id") ?? "").trim();
  const organizationId = String(formData.get("organization_id") ?? "").trim();
  const projectId = String(formData.get("project_id") ?? "").trim() || null;
  if (!presetId || !organizationId) return { error: "Missing preset." };

  const session = await requireSession();
  const supabase = await createSupabaseServerClient();

  if (!(await canManagePresets(supabase, session, organizationId))) {
    return { error: "Only a JAGS Admin, or a self-managed/client-managed organisation's own admin, can manage preset locations." };
  }

  const { error } = await supabase.from(INSPECTION_LOCATION_PRESETS_TABLE).delete().eq("id", presetId);
  if (error) return { error: "Could not remove this location." };

  if (projectId) revalidatePath(`/inspect/projects/${projectId}`);
  return { error: null };
}
