import type { createSupabaseServerClient } from "@/lib/supabase/server";

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export interface RegisterAccess {
  /** May add entries: JAGS staff, or the project's own contractor / subcontractor / TPI-lab party. */
  canAdd: boolean;
  /** May edit, release and delete entries: JAGS staff only. */
  canManage: boolean;
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
  if (session.isJagsStaff) return { canAdd: true, canManage: true };
  // The database function covers the party's primary contact AND its other members.
  const { data } = await supabase.rpc("is_register_contributor" as never, { target_project_id: projectId } as never);
  return { canAdd: data === true, canManage: false };
}
