import type { createSupabaseServerClient } from "@/lib/supabase/server";
import { normaliseCertificatePath } from "./paths";

/**
 * Validates a certificate file path posted with a register form: it must be a clean path under THIS
 * project's registers folder AND the object must exist in storage (a made-up or traversal path is refused).
 * Empty input is fine (the certificate is optional).
 */
export async function checkCertificateInput(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  projectId: string,
  raw: string
): Promise<{ path: string | null; error: string | null }> {
  const trimmed = raw.trim();
  if (!trimmed) return { path: null, error: null };
  const path = normaliseCertificatePath(projectId, trimmed);
  if (!path) return { path: null, error: "The attached certificate file path isn't valid — remove it and upload the file again." };
  const slash = path.lastIndexOf("/");
  const name = path.slice(slash + 1);
  const { data: found, error } = await supabase.storage.from("inspection-evidence").list(path.slice(0, slash), { search: name, limit: 5 });
  if (error || !found?.some((f) => f.name === name)) {
    return { path: null, error: "The attached certificate file could not be found in storage — upload it again." };
  }
  return { path, error: null };
}
