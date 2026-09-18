"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession, isAdminStaff } from "@/lib/auth/session";

export interface CreateOrganizationState {
  error: string | null;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Client onboarding: creates a new tenant (organizations row). This was previously only possible by
 * hand-writing into the database (the seed data's three demo organisations) — there was no in-app
 * way to onboard a real new client at all. Admin-only, same boundary as project creation, numbering
 * settings and staff access (organizations_staff_insert in
 * supabase/migrations/20260910100000_phase3_fix_organizations_write_select_leak.sql enforces this at
 * the RLS layer too, so this check is a clean error message, not the only guard).
 *
 * Nothing else is created alongside the organization here (no default project, no numbering config
 * row, no access grant) — those already have their own dedicated flows (New project, Numbering
 * settings' org picker, Staff Access) that work against any existing organization, this one included,
 * the moment it exists.
 */
export async function createOrganizationAction(
  _prev: CreateOrganizationState,
  formData: FormData
): Promise<CreateOrganizationState> {
  const session = await requireSession();
  if (!isAdminStaff(session)) return { error: "Only a JAGS Admin can create a new client organisation." };

  const name = String(formData.get("name") ?? "").trim();
  const slugOverride = String(formData.get("slug") ?? "").trim();
  const engagementMode = String(formData.get("engagement_mode") ?? "jags_led").trim();
  const engagementScope = String(formData.get("engagement_scope") ?? "full_service").trim();

  if (!name) return { error: "Organisation name is required." };
  if (!["jags_led", "co_branded", "white_label"].includes(engagementMode)) {
    return { error: "Invalid engagement mode." };
  }
  if (!["full_service", "self_managed"].includes(engagementScope)) {
    return { error: "Invalid engagement scope." };
  }

  const slug = slugify(slugOverride || name);
  if (!slug) return { error: "Could not derive a URL-safe slug from that name — try a different name or set one explicitly." };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("organizations").insert({
    name,
    slug,
    engagement_mode: engagementMode as "jags_led" | "co_branded" | "white_label",
    engagement_scope: engagementScope as "full_service" | "self_managed",
  });

  if (error) {
    if (error.code === "23505") {
      return { error: `An organisation with the slug "${slug}" already exists — choose a different name or set a custom slug.` };
    }
    return { error: "Could not create the organisation. Check you have permission and try again." };
  }

  revalidatePath("/inspect/organisation/clients");
  revalidatePath("/inspect/projects/new");
  revalidatePath("/inspect/organisation/numbering");
  revalidatePath("/inspect/organisation/staff-access");
  return { error: null };
}
