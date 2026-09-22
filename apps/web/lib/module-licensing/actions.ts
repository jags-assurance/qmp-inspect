"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { ORGANIZATION_MODULE_LICENSES_TABLE, MODULE_KEYS, type ModuleKey } from "./types";

export interface ModuleLicenseState {
  error: string | null;
}

const SETTINGS_PATH = "/inspect/organisation/module-licensing";

/**
 * Upserts a single (organization_id, module_key) license row — the settings-page toggle. RLS
 * (organization_module_licenses_admin_write) already restricts writes to is_admin_staff(); this
 * mirrors that at the action layer too, same pattern as lib/intervention-levels/actions.ts.
 *
 * Unchecking the toggle writes an explicit `is_licensed: false` row; checking it again writes
 * `is_licensed: true` rather than deleting the row — simpler to reason about than "delete to
 * re-license", and the row's updated_at then also tells you when it was last flipped.
 */
export async function setModuleLicenseAction(
  _prev: ModuleLicenseState,
  formData: FormData
): Promise<ModuleLicenseState> {
  const session = await requireSession();
  if (!isAdminStaff(session)) {
    return { error: "Only a JAGS Admin can manage module licensing." };
  }

  const organizationId = String(formData.get("organization_id") ?? "").trim();
  const moduleKey = String(formData.get("module_key") ?? "").trim() as ModuleKey;
  const isLicensed = formData.get("is_licensed") === "on";

  if (!organizationId || !MODULE_KEYS.includes(moduleKey)) {
    return { error: "Missing organisation or module." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from(ORGANIZATION_MODULE_LICENSES_TABLE)
    .upsert(
      { organization_id: organizationId, module_key: moduleKey, is_licensed: isLicensed },
      { onConflict: "organization_id,module_key" }
    );

  if (error) {
    return { error: "Could not update module licensing. Check you have permission and try again." };
  }

  revalidatePath(SETTINGS_PATH);
  return { error: null };
}
