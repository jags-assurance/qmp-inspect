"use server";

import { requireSession } from "@/lib/auth/session";
import { loadNcrDetail, type NcrDetailData } from "./load-detail";

/** Loads one NCR's full detail for the register side panel. RLS still scopes what is visible. */
export async function getNcrDetailAction(ncrId: string): Promise<NcrDetailData | { error: string }> {
  await requireSession();
  if (!ncrId) return { error: "Missing NCR id." };
  try {
    const data = await loadNcrDetail(ncrId);
    return data ?? { error: "This NCR was not found, or you no longer have access to it." };
  } catch {
    return { error: "Could not load this NCR. Check your connection and try again." };
  }
}
