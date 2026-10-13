"use server";

import { requireSession } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { previewNextDocumentNumber, previewNextIrnNumber } from "@/lib/numbering/preview";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A hint of the next number ("Next number: …") shown in creation forms. Read-only, RLS-scoped; null when unknown. */
export async function previewNextNumberAction(
  kind: "itp" | "ncr" | "irn",
  id: string
): Promise<string | null> {
  if (!UUID.test(id)) return null;
  await requireSession();
  const supabase = await createSupabaseServerClient();
  try {
    return kind === "irn"
      ? await previewNextIrnNumber(supabase, id)
      : await previewNextDocumentNumber(supabase, { projectId: id, docType: kind });
  } catch {
    return null;
  }
}
