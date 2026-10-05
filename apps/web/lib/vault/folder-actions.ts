"use server";

import { revalidatePath } from "next/cache";
import { getSelfManagedOrgIdsForUser } from "@/lib/rbac/access";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { VAULT_FOLDERS_TABLE } from "@/lib/vault/types";

export interface CreateCustomVaultFolderState {
  error: string | null;
}

/**
 * Real gap found live: the Vault's 12 categories were a hardcoded DB enum with no way for a
 * project to add its own — every real project inevitably has at least one document type that
 * doesn't fit "Drawings/Specifications/.../Test Reports" cleanly. Same authority as everything
 * else project-scoped: JAGS Admin always, or a self-managed/client-managed org's own admin
 * (20260930150000's widened vault_folders_staff_write policy is what actually allows the insert;
 * this check just gives an honest error before even trying).
 */
export async function createCustomVaultFolderAction(
  _prev: CreateCustomVaultFolderState,
  formData: FormData
): Promise<CreateCustomVaultFolderState> {
  const session = await requireSession();
  const projectId = String(formData.get("project_id") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();

  if (!projectId || !name) {
    return { error: "Missing project or category name." };
  }
  if (name.length > 60) {
    return { error: "Category name must be 60 characters or fewer." };
  }

  const supabase = await createSupabaseServerClient();

  if (!isAdminStaff(session)) {
    const { data: project } = await supabase
      .from("projects")
      .select("organization_id, organizations(engagement_scope)")
      .eq("id", projectId)
      .maybeSingle<{ organization_id: string; organizations: { engagement_scope: string } | null }>();
    const scope = project?.organizations?.engagement_scope;
    if (scope !== "self_managed" && scope !== "client_managed") {
      return { error: "Only a JAGS Admin, or a self-managed/client-managed organisation's own admin, can add a category." };
    }
    // Organisation-wide members only; a project-scoped contractor/TPI cannot add categories.
    if (!project || !(await getSelfManagedOrgIdsForUser(supabase, session.userId)).has(project.organization_id)) {
      return { error: "Only your organisation's own members can add a category." };
    }
  }

  // folder_key just needs to be unique-ish and URL-safe — it's never shown to a user (`name` is),
  // so a slug plus a short random suffix avoids a collision with another custom category that
  // happens to slugify to the same thing without needing a retry loop.
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  const folderKey = `custom_${slug || "category"}_${Math.random().toString(36).slice(2, 8)}`;

  const { error } = await supabase.from(VAULT_FOLDERS_TABLE).insert({
    project_id: projectId,
    folder_key: folderKey,
    name,
    is_custom: true,
  });

  if (error) {
    return { error: "Could not add this category. Check you have permission and try again." };
  }

  revalidatePath("/inspect/vault");
  return { error: null };
}
