import type { createSupabaseServerClient } from "@/lib/supabase/server";
import type { RegisterKind } from "./manage-actions";

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/** What a save did to an entry's certificate file (S3-11). Pure. */
export function certificateChange(oldPath: string | null | undefined, newPath: string | null | undefined): "none" | "attached" | "replaced" {
  if (!newPath || newPath === oldPath) return "none";
  return oldPath ? "replaced" : "attached";
}

/**
 * Remembers the file an entry used before it was replaced (the object stays in storage). Best-effort:
 * returns false when the history table is not migrated yet or the insert is refused, never throws.
 */
export async function recordCertificateReplacement(
  supabase: SupabaseServerClient,
  args: { projectId: string; kind: RegisterKind; entryId: string; oldPath: string; newPath: string; reason: string | null; userId: string }
): Promise<boolean> {
  try {
    const { error } = await supabase.from("register_certificate_history" as never).insert({
      project_id: args.projectId,
      register_kind: args.kind,
      entry_id: args.entryId,
      old_path: args.oldPath,
      new_path: args.newPath,
      reason: args.reason ? args.reason.slice(0, 500) : null,
      replaced_by: args.userId,
    } as never);
    return !error;
  } catch {
    return false;
  }
}
