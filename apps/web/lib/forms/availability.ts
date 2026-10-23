"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { INSPECTION_LOCATION_PRESETS_TABLE } from "@/lib/checklists/location-presets";

/**
 * Live "already exists" check for the primary fields of the main forms (project number, ITP
 * number, party name, location name). It runs as the signed-in user, so row security decides
 * what they can see: a value in a project they cannot read is reported as free, and the real
 * unique constraint still catches it on submit. The check is advisory, never the only guard.
 */
export type AvailabilityKind = "project_number" | "itp_number" | "party_name" | "location_name";

export interface AvailabilityScope {
  organizationId?: string;
  projectId?: string;
  partyType?: string;
}

export interface AvailabilityResult {
  taken: boolean;
  message: string | null;
}

const FREE: AvailabilityResult = { taken: false, message: null };

/** ilike treats % _ \ as wildcards; escape them so the match is an exact, case-insensitive one. */
function exactPattern(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export async function checkAvailabilityAction(
  kind: AvailabilityKind,
  rawValue: string,
  scope: AvailabilityScope = {}
): Promise<AvailabilityResult> {
  const value = String(rawValue ?? "").trim();
  if (!value || value.length > 200) return FREE;
  await requireSession();
  const supabase = await createSupabaseServerClient();
  const pattern = exactPattern(value);

  if (kind === "project_number") {
    if (!scope.organizationId) return FREE;
    const { data } = await supabase
      .from("projects")
      .select("id")
      .eq("organization_id", scope.organizationId)
      .ilike("project_number", pattern)
      .limit(1);
    return data && data.length > 0
      ? { taken: true, message: "A project with that number already exists for this organisation." }
      : FREE;
  }

  if (kind === "itp_number") {
    if (!scope.projectId) return FREE;
    const { data } = await supabase
      .from("itps")
      .select("id")
      .eq("project_id", scope.projectId)
      .ilike("itp_number", pattern)
      .limit(1);
    return data && data.length > 0 ? { taken: true, message: "An ITP with that number already exists for this project." } : FREE;
  }

  if (kind === "party_name") {
    if (!scope.projectId || !scope.partyType) return FREE;
    const { data } = await supabase
      .from("project_parties")
      .select("id")
      .eq("project_id", scope.projectId)
      .eq("party_type", scope.partyType)
      .ilike("name", pattern)
      .limit(1);
    return data && data.length > 0
      ? { taken: true, message: `A ${scope.partyType.replace(/_/g, " ")} party named "${value}" is already on this project.` }
      : FREE;
  }

  if (kind === "location_name") {
    if (!scope.projectId) return FREE;
    const { data } = await supabase
      .from(INSPECTION_LOCATION_PRESETS_TABLE)
      .select("id")
      .eq("project_id", scope.projectId)
      .ilike("name", pattern)
      .limit(1);
    return data && data.length > 0 ? { taken: true, message: "That location is already in the list." } : FREE;
  }

  return FREE;
}
