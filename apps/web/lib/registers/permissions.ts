import type { createSupabaseServerClient } from "@/lib/supabase/server";

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export interface RegisterAccess {
  /** May add entries: JAGS staff, or the project's own contractor / subcontractor / TPI-lab party. */
  canAdd: boolean;
  /** May edit, release and delete entries: JAGS staff only. */
  canManage: boolean;
  /**
   * A contributor (not staff) may edit and replace the certificate of entries THEY created while those
   * entries are not yet verified. Verified entries and everyone else's entries stay staff-only.
   */
  canEditOwnUnverified: boolean;
}

/** Whether this viewer may edit/replace this row (staff always; contributors only own + unverified). Pure. */
export function canEditRegisterRow(
  access: { canManage: boolean; canEditOwnUnverified: boolean },
  viewerId: string | null | undefined,
  row: { created_by?: string | null; verified_at?: string | null }
): boolean {
  if (access.canManage) return true;
  return access.canEditOwnUnverified && !!viewerId && !!row.created_by && row.created_by === viewerId && !row.verified_at;
}

/**
 * Who can do what on a project's registers. The database enforces the same split (see
 * 20261007090000_registers_roles_traceability_and_certificates.sql); this makes the same decision in
 * the app so the screens hide what a person can't do and the actions refuse with a clear message.
 */
export async function getRegisterAccess(
  supabase: SupabaseServerClient,
  session: { userId: string; isJagsStaff: boolean },
  projectId: string
): Promise<RegisterAccess> {
  if (session.isJagsStaff) return { canAdd: true, canManage: true, canEditOwnUnverified: true };
  // The database function covers the party's primary contact AND its other members.
  const { data } = await supabase.rpc("is_register_contributor" as never, { target_project_id: projectId } as never);
  return { canAdd: data === true, canManage: false, canEditOwnUnverified: data === true };
}
