import { cookies } from "next/headers";
import { ACTIVE_PROJECT_COOKIE, isProjectId } from "./active-project";

/** The header-selected project id (unvalidated shape check only — queries stay RLS-scoped), or null. */
export async function getActiveProjectId(): Promise<string | null> {
  const value = (await cookies()).get(ACTIVE_PROJECT_COOKIE)?.value;
  return value && isProjectId(value) ? value : null;
}
