"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { ITP_MASTER_TEMPLATES_TABLE } from "@/lib/itp-master/types";

export interface MasterAdminState {
  error: string | null;
  ok?: boolean;
}

async function logAudit(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  row: { template_id: string; action: string; actor_id: string; summary: string; changes?: Record<string, unknown> }
) {
  try {
    await supabase.from("itp_master_audit" as never).insert({ ...row, changes: row.changes ?? {} } as never);
  } catch {
    // Best-effort, like lib/audit/log.ts.
  }
}

function revalidate(id: string) {
  revalidatePath(`/inspect/itp-master/${id}`);
  revalidatePath("/inspect/itp-master");
}

/** Admin edit of a master template's title / industry / discipline / applicable standard. Content is untouched; version is not bumped. */
export async function updateMasterTemplateMetaAction(_prev: MasterAdminState, formData: FormData): Promise<MasterAdminState> {
  const session = await requireSession();
  if (!isAdminStaff(session)) return { error: "Only a JAGS Admin can edit a master template." };

  const id = String(formData.get("template_id") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim();
  const industry = String(formData.get("industry") ?? "").trim();
  const standard = String(formData.get("applicable_standard") ?? "").trim();
  const disciplineId = String(formData.get("discipline_id") ?? "").trim();
  if (!id) return { error: "Missing template." };
  if (!title) return { error: "Title is required." };
  if (title.length > 200) return { error: "Title is too long (200 characters max)." };
  if (!industry) return { error: "Industry is required." };

  const supabase = await createSupabaseServerClient();
  const { data: before } = await supabase
    .from(ITP_MASTER_TEMPLATES_TABLE)
    .select("title, industry, applicable_standard, discipline_id")
    .eq("id", id)
    .maybeSingle<{ title: string; industry: string; applicable_standard: string | null; discipline_id: string | null }>();
  const { error } = await supabase
    .from(ITP_MASTER_TEMPLATES_TABLE)
    .update({
      title,
      industry,
      applicable_standard: standard || null,
      discipline_id: disciplineId || null,
    })
    .eq("id", id);
  if (error) return { error: "Could not save the template. Check you have permission and try again." };
  const next = { title, industry, applicable_standard: standard || null, discipline_id: disciplineId || null };
  const changed = Object.entries(next).filter(([k, v]) => (before as Record<string, unknown> | null)?.[k] !== v);
  if (changed.length > 0) {
    await logAudit(supabase, {
      template_id: id,
      action: "metadata_edited",
      actor_id: session.userId,
      summary: `Edited ${changed.map(([k]) => k.replace("_", " ")).join(", ")}`,
      changes: Object.fromEntries(changed.map(([k, v]) => [k, { from: (before as Record<string, unknown> | null)?.[k] ?? null, to: v }])),
    });
  }

  revalidate(id);
  return { error: null, ok: true };
}

/** Retire or reactivate a master template. A reason is required to retire. */
export async function setMasterTemplateActiveAction(_prev: MasterAdminState, formData: FormData): Promise<MasterAdminState> {
  const session = await requireSession();
  if (!isAdminStaff(session)) return { error: "Only a JAGS Admin can retire or reactivate a master template." };

  const id = String(formData.get("template_id") ?? "").trim();
  const active = String(formData.get("active") ?? "") === "true";
  const reason = String(formData.get("reason") ?? "").trim();
  if (!id) return { error: "Missing template." };
  if (!active && !reason) return { error: "Give a reason for retiring this template." };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from(ITP_MASTER_TEMPLATES_TABLE).update({ is_active: active }).eq("id", id);
  if (error) return { error: "Could not update the template status." };
  await logAudit(supabase, {
    template_id: id,
    action: active ? "reactivated" : "retired",
    actor_id: session.userId,
    summary: active ? "Template reactivated" : `Template retired: ${reason}`,
  });

  revalidate(id);
  return { error: null, ok: true };
}
