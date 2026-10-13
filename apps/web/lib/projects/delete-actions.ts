"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceRoleClient, isServiceRoleConfigured } from "@/lib/supabase/service";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { recordAuditEvent } from "@/lib/audit/log";
import { canDeleteOrganization, canDeleteProject, confirmationMatches } from "@/lib/projects/delete-helpers";

// Delete a project or an organisation (JAGS Admin only). Everything under it goes through the database's
// cascades, the same ones the e2e cleanup script relies on. The audit event is written BEFORE the delete,
// at platform level, because project-scoped audit rows are removed with the project.

export interface DeleteState {
  error: string | null;
}

export interface DeletePreview {
  label: string;
  /** Lines such as "3 NCRs" shown before the admin confirms. */
  contents: string[];
  blockedReason: string | null;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

type Supabase = Awaited<ReturnType<typeof createSupabaseServerClient>>;

async function countRows(supabase: Supabase, table: string, column: string, id: string): Promise<number> {
  const { count } = await supabase.from(table as never).select("id", { count: "exact", head: true }).eq(column as never, id as never);
  return count ?? 0;
}

/** What deleting this project would remove, and whether it is allowed right now. Admin only. */
export async function getProjectDeletePreviewAction(projectId: string): Promise<DeletePreview | null> {
  const session = await requireSession();
  if (!isAdminStaff(session) || !projectId) return null;
  const supabase = await createSupabaseServerClient();
  const { data: project } = await supabase
    .from("projects")
    .select("project_number, name, status")
    .eq("id", projectId)
    .maybeSingle<{ project_number: string; name: string; status: string }>();
  if (!project) return null;
  const [itps, inspections, ncrs, punch, books] = await Promise.all([
    countRows(supabase, "itps", "project_id", projectId),
    countRows(supabase, "inspection_records", "project_id", projectId),
    countRows(supabase, "ncrs", "project_id", projectId),
    countRows(supabase, "punch_list_items", "project_id", projectId),
    countRows(supabase, "data_books", "project_id", projectId),
  ]);
  const verdict = canDeleteProject(project.status);
  return {
    label: `${project.project_number} — ${project.name}`,
    contents: [
      plural(itps, "ITP", "ITPs"),
      plural(inspections, "inspection record", "inspection records"),
      plural(ncrs, "NCR/observation", "NCRs/observations"),
      plural(punch, "punch item", "punch items"),
      plural(books, "Data Book", "Data Books"),
      "all documents, registers, parties and the audit trail of the project",
    ],
    blockedReason: verdict.ok ? null : verdict.reason,
  };
}

/** Every file under `prefix/` in a bucket (folders listed recursively), capped so a huge tree cannot run away. */
async function listAll(service: ReturnType<typeof createSupabaseServiceRoleClient>, bucket: string, prefix: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string, depth: number) => {
    if (depth > 6 || out.length > 5000) return;
    const { data } = await service.storage.from(bucket).list(dir, { limit: 1000 });
    for (const entry of data ?? []) {
      const full = `${dir}/${entry.name}`;
      if (entry.id === null) await walk(full, depth + 1);
      else out.push(full);
    }
  };
  await walk(prefix, 0);
  return out;
}

export async function deleteProjectAction(_prev: DeleteState, formData: FormData): Promise<DeleteState> {
  const projectId = String(formData.get("project_id") ?? "").trim();
  const typed = String(formData.get("confirm") ?? "");
  const session = await requireSession();
  if (!isAdminStaff(session)) return { error: "Only a JAGS Admin can delete a project." };
  if (!projectId) return { error: "Missing project." };
  if (!isServiceRoleConfigured()) return { error: "Deleting is not available: the server has no service-role key configured." };

  const supabase = await createSupabaseServerClient();
  const { data: project } = await supabase
    .from("projects")
    .select("id, project_number, name, status, organization_id")
    .eq("id", projectId)
    .maybeSingle<{ id: string; project_number: string; name: string; status: string; organization_id: string }>();
  if (!project) return { error: "Project not found, or you do not have access to it." };
  const verdict = canDeleteProject(project.status);
  if (!verdict.ok) return { error: verdict.reason };
  if (!confirmationMatches(typed, project.project_number)) {
    return { error: `Type the project number (${project.project_number}) exactly to confirm.` };
  }

  await recordAuditEvent(supabase, {
    organizationId: null,
    entityType: "project",
    entityId: project.id,
    action: "project_deleted",
    actorId: session.userId,
    summary: `Project ${project.project_number} — ${project.name} permanently deleted (status ${project.status})`,
    changes: { project_number: project.project_number, name: project.name, organization_id: project.organization_id },
  });

  const service = createSupabaseServiceRoleClient();
  // Stored files first (best-effort): the rows that point at them disappear with the project.
  try {
    const evidence = await listAll(service, "inspection-evidence", project.id);
    if (evidence.length) await service.storage.from("inspection-evidence").remove(evidence);
    const { data: books } = await service.from("data_books").select("id").eq("project_id", project.id);
    for (const b of (books ?? []) as { id: string }[]) {
      const files = await listAll(service, "generated-documents", `handover/${b.id}`);
      if (files.length) await service.storage.from("generated-documents").remove(files);
    }
  } catch (err) {
    console.error("[project-delete] stored-file cleanup failed (continuing):", err instanceof Error ? err.message : err);
  }

  const { error } = await service.from("projects").delete().eq("id", project.id);
  if (error) {
    console.error("[project-delete] delete failed:", error.code, error.message);
    return { error: "Could not delete the project. Nothing was removed from the database; check the server log." };
  }
  revalidatePath("/inspect/projects");
  redirect("/inspect/projects");
}

/** What deleting this organisation would remove, and whether it is allowed right now. Admin only. */
export async function getOrganizationDeletePreviewAction(organizationId: string): Promise<DeletePreview | null> {
  const session = await requireSession();
  if (!isAdminStaff(session) || !organizationId) return null;
  const supabase = await createSupabaseServerClient();
  const { data: org } = await supabase.from("organizations").select("name").eq("id", organizationId).maybeSingle<{ name: string }>();
  if (!org) return null;
  const projects = await countRows(supabase, "projects", "organization_id", organizationId);
  const verdict = canDeleteOrganization(projects);
  return {
    label: org.name,
    contents: [plural(projects, "project", "projects"), "its branding, numbering, teams, custom roles and client users' access"],
    blockedReason: verdict.ok ? null : verdict.reason,
  };
}

export async function deleteOrganizationAction(_prev: DeleteState, formData: FormData): Promise<DeleteState> {
  const organizationId = String(formData.get("organization_id") ?? "").trim();
  const typed = String(formData.get("confirm") ?? "");
  const session = await requireSession();
  if (!isAdminStaff(session)) return { error: "Only a JAGS Admin can delete an organisation." };
  if (!organizationId) return { error: "Missing organisation." };
  if (!isServiceRoleConfigured()) return { error: "Deleting is not available: the server has no service-role key configured." };

  const supabase = await createSupabaseServerClient();
  const { data: org } = await supabase.from("organizations").select("id, name").eq("id", organizationId).maybeSingle<{ id: string; name: string }>();
  if (!org) return { error: "Organisation not found, or you do not have access to it." };
  const projects = await countRows(supabase, "projects", "organization_id", organizationId);
  const verdict = canDeleteOrganization(projects);
  if (!verdict.ok) return { error: verdict.reason };
  if (!confirmationMatches(typed, org.name)) return { error: `Type the organisation name (${org.name}) exactly to confirm.` };

  await recordAuditEvent(supabase, {
    organizationId: null,
    entityType: "organization",
    entityId: org.id,
    action: "organization_deleted",
    actorId: session.userId,
    summary: `Organisation "${org.name}" permanently deleted`,
    changes: { name: org.name },
  });

  const service = createSupabaseServiceRoleClient();
  const { error } = await service.from("organizations").delete().eq("id", org.id);
  if (error) {
    console.error("[organisation-delete] delete failed:", error.code, error.message);
    return { error: "Could not delete the organisation (something still refers to it). Nothing was removed." };
  }
  revalidatePath("/inspect/organisation/clients");
  return { error: null };
}
