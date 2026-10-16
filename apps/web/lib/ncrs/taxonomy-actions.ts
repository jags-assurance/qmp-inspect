"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { recordAuditEvent } from "@/lib/audit/log";
import { parseSortOrder, slugifyCode, usableCode, validateLabel } from "./taxonomy";

export interface TaxonomyState {
  error: string | null;
  success?: string | null;
}

const TABLE = "ncr_root_cause_categories" as never;

/** Admin-only: adds an organisation-specific root-cause category (RLS repeats the admin and org checks). */
export async function addRootCauseCategoryAction(_prev: TaxonomyState, formData: FormData): Promise<TaxonomyState> {
  const session = await requireSession();
  if (!isAdminStaff(session)) return { error: "Only a JAGS Admin can change the root-cause list." };
  const organizationId = String(formData.get("organization_id") ?? "").trim();
  if (!organizationId) return { error: "Missing organisation." };
  const parsed = validateLabel(String(formData.get("label") ?? ""));
  if ("error" in parsed) return { error: parsed.error };
  const code = slugifyCode(parsed.label);
  if (!usableCode(code)) return { error: "Use a name with at least two letters or numbers." };
  const sort = parseSortOrder(String(formData.get("sort_order") ?? "")) ?? 200;

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from(TABLE).insert({ organization_id: organizationId, code, label: parsed.label, sort_order: sort, is_active: true } as never);
  if (error) {
    if (error.code === "23505") return { error: "A category with that name already exists for this organisation." };
    return { error: "Could not add the category. Check you have permission and try again." };
  }
  await recordAuditEvent(supabase, {
    organizationId,
    entityType: "organization",
    entityId: organizationId,
    action: "ncr_root_cause_added",
    actorId: session.userId,
    summary: `NCR root-cause category added: ${parsed.label}`,
    changes: { code, label: parsed.label },
  });
  revalidatePath("/inspect/organisation/root-causes");
  revalidatePath("/inspect/settings");
  return { error: null, success: `"${parsed.label}" added.` };
}

/** Admin-only: renames, re-orders or switches off one organisation category. Existing NCRs keep their stored code. */
export async function updateRootCauseCategoryAction(_prev: TaxonomyState, formData: FormData): Promise<TaxonomyState> {
  const session = await requireSession();
  if (!isAdminStaff(session)) return { error: "Only a JAGS Admin can change the root-cause list." };
  const id = String(formData.get("id") ?? "").trim();
  const organizationId = String(formData.get("organization_id") ?? "").trim();
  if (!id || !organizationId) return { error: "Missing category." };
  const parsed = validateLabel(String(formData.get("label") ?? ""));
  if ("error" in parsed) return { error: parsed.error };
  const sort = parseSortOrder(String(formData.get("sort_order") ?? ""));
  if (sort === null) return { error: "Order must be a whole number from 0 to 9999." };
  const isActive = formData.get("is_active") === "on";

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from(TABLE)
    .update({ label: parsed.label, sort_order: sort, is_active: isActive } as never)
    .eq("id" as never, id as never)
    .eq("organization_id" as never, organizationId as never)
    .select("id" as never)
    .maybeSingle();
  if (error || !data) return { error: "Could not save the change. Check you have permission and try again." };
  await recordAuditEvent(supabase, {
    organizationId,
    entityType: "organization",
    entityId: organizationId,
    action: "ncr_root_cause_updated",
    actorId: session.userId,
    summary: `NCR root-cause category updated: ${parsed.label}${isActive ? "" : " (switched off)"}`,
    changes: { label: parsed.label, sort_order: sort, is_active: isActive },
  });
  revalidatePath("/inspect/organisation/root-causes");
  revalidatePath("/inspect/settings");
  return { error: null, success: "Saved." };
}
