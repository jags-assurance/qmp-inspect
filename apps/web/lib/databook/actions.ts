"use server";

import { revalidatePath } from "next/cache";
import { invalidateDataBookReadiness } from "@/lib/databook/readiness-cached";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { recordAuditEvent } from "@/lib/audit/log";
import { DATA_BOOKS_TABLE, type ConditionalOpenItem } from "@/lib/databook/types";
import { computeDataBookReadiness, type DataBookReadiness } from "@/lib/databook/readiness";
import { validateBookFields } from "@/lib/databook/helpers";
import { buildOverrideItems } from "@/lib/databook/override-items";
import { bookTransitionErrorMessage, isMissingDbObject } from "@/lib/databook/db-errors";

export interface CreateDataBookState {
  error: string | null;
}

/** Starts a new draft Data Book for a project. Staff-only, enforced by data_books_staff_write RLS. */
export async function createDataBookAction(
  _prev: CreateDataBookState,
  formData: FormData
): Promise<CreateDataBookState> {
  const projectId = String(formData.get("project_id") ?? "").trim();
  const bookNumber = String(formData.get("book_number") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim();
  const revisionReason = String(formData.get("revision_reason") ?? "").trim();

  const createSession = await requireSession();
  if (!createSession.isJagsStaff) {
    return { error: "Only JAGS staff can create a Data Book." };
  }

  if (!projectId) return { error: "Missing project." };
  const fieldError = validateBookFields(bookNumber, title);
  if (fieldError) return { error: fieldError };
  if (revisionReason.length > 1000) return { error: "The revision reason must be 1000 characters or fewer." };

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Only one in-progress book at a time: a new book is only allowed once every existing one is issued.
  const { data: openBooks } = await supabase
    .from(DATA_BOOKS_TABLE)
    .select("id, book_number, status")
    .eq("project_id", projectId)
    .in("status", ["draft", "compiled"])
    .limit(1)
    .returns<{ id: string; book_number: string; status: string }[]>();
  if (openBooks && openBooks.length > 0) {
    return {
      error: `Data Book ${openBooks[0].book_number} is still ${openBooks[0].status === "draft" ? "a draft" : "compiled and awaiting issue"}. Issue or finish it before starting another.`,
    };
  }

  // A revision of an already issued book records why it exists and which book it replaces (S7-19).
  const { data: lastIssued } = await supabase
    .from(DATA_BOOKS_TABLE)
    .select("id, book_number")
    .eq("project_id", projectId)
    .eq("status", "issued")
    .order("created_at", { ascending: false })
    .limit(1)
    .returns<{ id: string; book_number: string }[]>();
  const previous = lastIssued?.[0] ?? null;
  if (previous && revisionReason.length < 10) {
    return { error: `This is a revision of Data Book ${previous.book_number}. Say why it is being revised (at least 10 characters).` };
  }

  const baseInsert: Record<string, unknown> = { project_id: projectId, book_number: bookNumber, title };
  let inserted = await supabase
    .from(DATA_BOOKS_TABLE)
    .insert(previous ? { ...baseInsert, revision_reason: revisionReason, supersedes_data_book_id: previous.id } : baseInsert)
    .select("id")
    .single<{ id: string }>();
  // The revision columns arrive with a migration; keep working (without the link) until it is applied.
  if (inserted.error && previous && isMissingDbObject(inserted.error)) {
    inserted = await supabase.from(DATA_BOOKS_TABLE).insert(baseInsert).select("id").single<{ id: string }>();
  }
  const { data: dataBook, error } = inserted;

  if (error || !dataBook) {
    if (error?.code === "23505") {
      return { error: "A Data Book with that number already exists for this project." };
    }
    return { error: "Could not create the Data Book. Check you have permission and try again." };
  }

  try {
    const { data: project } = await supabase
      .from("projects")
      .select("organization_id")
      .eq("id", projectId)
      .single();
    if (project?.organization_id) {
      await recordAuditEvent(supabase, {
        organizationId: project.organization_id,
        projectId,
        entityType: "data_book",
        entityId: dataBook.id,
        action: "created",
        actorId: user?.id ?? null,
        summary: previous ? `Data Book ${bookNumber} created as a revision of ${previous.book_number} — ${revisionReason}` : `Data Book ${bookNumber} created`,
      });
    }
  } catch {
    // Best-effort — see lib/audit/log.ts's doc comment.
  }

  invalidateDataBookReadiness(projectId);
  revalidatePath(`/inspect/projects/${projectId}/data-book`);
  return { error: null };
}

export interface CompileDataBookState {
  error: string | null;
}

/**
 * Compiles a draft Data Book (R86-R87). Blocked unless every readiness category is at 100% and the
 * project's punch list has zero open items, UNLESS override is set — which requires a JAGS Admin and
 * a documented reason, both of which are recorded on the row as a deliberate, visible, logged
 * exception rather than a silent bypass. The transition itself goes through the compile_data_book()
 * RPC, which re-checks the staff / override / gate rules in the database (so a direct API call cannot
 * skip them); until that migration is applied the previous direct update is used.
 */
export async function compileDataBookAction(
  _prev: CompileDataBookState,
  formData: FormData
): Promise<CompileDataBookState> {
  const dataBookId = String(formData.get("data_book_id") ?? "").trim();
  const projectId = String(formData.get("project_id") ?? "").trim();
  const override = formData.get("override") === "true";
  const overrideReason = String(formData.get("override_reason") ?? "").trim();

  if (!dataBookId || !projectId) {
    return { error: "Missing Data Book." };
  }

  const session = await requireSession();
  if (!session.isJagsStaff) {
    return { error: "Only JAGS staff can compile a Data Book." };
  }

  const supabase = await createSupabaseServerClient();
  const { data: bookCheck } = await supabase
    .from(DATA_BOOKS_TABLE)
    .select("id, project_id, status")
    .eq("id", dataBookId)
    .maybeSingle<{ id: string; project_id: string; status: string }>();
  if (!bookCheck || bookCheck.project_id !== projectId) {
    return { error: "Data Book not found on this project." };
  }
  if (bookCheck.status !== "draft") {
    return { error: "This Data Book has already been compiled or issued. Issued books are immutable; create a new Data Book for a revision." };
  }

  // Fail closed: a readiness query that errors must never read as "ready".
  let readiness: DataBookReadiness;
  try {
    readiness = await computeDataBookReadiness(projectId);
  } catch (err) {
    console.error("[data-book] readiness failed during compile", err);
    return { error: "Could not verify the Data Book readiness right now (a data query failed). Nothing was changed — try again." };
  }
  // An override is only meaningful (and only recorded) when the gates genuinely fail; a ready
  // project compiles cleanly and is never mislabelled as a conditional handover.
  // The project must be Completed for a clean (non-conditional) final book. Not completed is treated
  // as one more failing gate that needs the same documented override.
  const { data: projectRow } = await supabase
    .from("projects")
    .select("status")
    .eq("id", projectId)
    .maybeSingle<{ status: string }>();
  const projectNotCompleted = projectRow?.status !== "completed";
  const needsOverride = !readiness.isReady || projectNotCompleted;
  if (needsOverride && !override) {
    return {
      error: projectNotCompleted && readiness.isReady
        ? "The project is not marked Completed. Mark it Completed first, or compile with a documented override reason."
        : "This project isn't ready to compile: every category must be 100% and the punch list must have zero open items. Use the override option to compile anyway with a documented reason.",
    };
  }
  const conditional = override && needsOverride;

  // Segregation of duties (S7-11): an override creates a Conditional Handover, so it needs an admin.
  if (conditional && !isAdminStaff(session)) {
    return { error: "Only a JAGS Admin can compile a Data Book with an override (Conditional Handover)." };
  }
  if (conditional && overrideReason.length < 10) {
    return { error: "An override reason of at least 10 characters is required to compile with open items outstanding." };
  }
  if (overrideReason.length > 2000) {
    return { error: "Override reason must be 2000 characters or fewer." };
  }
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // A Conditional Handover is only meaningful with a real record of WHICH items were left open and
  // their agreed due dates — snapshotted now, at override time, not left as a live join that a
  // later closure would silently rewrite (see 20260920050000_conditional_handover.sql).
  let overrideItems: ConditionalOpenItem[] | null = null;
  if (conditional) {
    try {
      overrideItems = await buildOverrideItems(supabase, projectId, readiness, projectRow?.status);
    } catch (err) {
      console.error("[data-book] override snapshot failed", err);
      return { error: "Could not read the open items to record on the Conditional Handover. Nothing was changed — try again." };
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- RPC not in generated Database type yet
  const { error: rpcError } = await (supabase.rpc as any)("compile_data_book", {
    p_data_book_id: dataBookId,
    p_override: conditional,
    p_override_reason: conditional ? overrideReason : null,
    p_override_items: overrideItems,
  });
  if (rpcError && !isMissingDbObject(rpcError)) {
    return { error: bookTransitionErrorMessage(rpcError.message, "Could not compile the Data Book. Check you have permission and try again.") };
  }
  if (rpcError) {
    // Pre-migration path: the guarded RPC is not deployed yet.
    const { data: updated, error } = await supabase
      .from(DATA_BOOKS_TABLE)
      .update({
        status: "compiled",
        compiled_by: user?.id ?? null,
        compiled_at: new Date().toISOString(),
        override_open_punch_items: conditional,
        override_reason: conditional ? overrideReason : null,
        override_by: conditional ? (user?.id ?? null) : null,
        override_items: overrideItems,
      })
      .eq("id", dataBookId)
      .eq("project_id", projectId)
      .eq("status", "draft")
      .select("id")
      .maybeSingle<{ id: string }>();
    if (error) {
      return { error: "Could not compile the Data Book. Check you have permission and try again." };
    }
    if (!updated) {
      return { error: "This Data Book has already been compiled or issued." };
    }
  }

  try {
    const { data: project } = await supabase
      .from("projects")
      .select("organization_id")
      .eq("id", projectId)
      .single();
    if (project?.organization_id) {
      await recordAuditEvent(supabase, {
        organizationId: project.organization_id,
        projectId,
        entityType: "data_book",
        entityId: dataBookId,
        action: "compiled",
        actorId: user?.id ?? null,
        summary: conditional
          ? `Data Book compiled with override (${overrideReason})`
          : "Data Book compiled",
      });
    }
  } catch {
    // Best-effort — see lib/audit/log.ts's doc comment.
  }

  invalidateDataBookReadiness(projectId);
  revalidatePath(`/inspect/projects/${projectId}/data-book`);
  return { error: null };
}

export interface WithdrawDataBookState {
  error: string | null;
}

/**
 * Admin-only escape hatch (S7-05): returns a COMPILED book to draft (wrong override reason, wrong number,
 * data changed) so it never becomes a dead end. Needs a reason, is audited, and is refused once a
 * handover certificate exists. Requires the withdraw_data_book() RPC (no direct fallback: the database
 * guard only allows draft -> compiled -> issued otherwise).
 */
export async function withdrawDataBookAction(
  _prev: WithdrawDataBookState,
  formData: FormData
): Promise<WithdrawDataBookState> {
  const dataBookId = String(formData.get("data_book_id") ?? "").trim();
  const projectId = String(formData.get("project_id") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();
  if (!dataBookId || !projectId) return { error: "Missing Data Book." };
  if (reason.length < 10) return { error: "Give a reason of at least 10 characters for withdrawing the compiled book." };
  if (reason.length > 2000) return { error: "The reason must be 2000 characters or fewer." };

  const session = await requireSession();
  if (!isAdminStaff(session)) return { error: "Only a JAGS Admin can withdraw a compiled Data Book." };

  const supabase = await createSupabaseServerClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- RPC not in generated Database type yet
  const { error } = await (supabase.rpc as any)("withdraw_data_book", { p_data_book_id: dataBookId, p_reason: reason });
  if (error) {
    if (isMissingDbObject(error)) return { error: "Withdrawing a compiled Data Book needs the latest database update, which has not been applied yet." };
    return { error: bookTransitionErrorMessage(error.message, "Could not withdraw the Data Book.") };
  }

  try {
    const { data: project } = await supabase.from("projects").select("organization_id").eq("id", projectId).maybeSingle<{ organization_id: string }>();
    if (project?.organization_id) {
      await recordAuditEvent(supabase, {
        organizationId: project.organization_id,
        projectId,
        entityType: "data_book",
        entityId: dataBookId,
        action: "withdrawn",
        actorId: session.userId,
        summary: `Compiled Data Book withdrawn to draft — ${reason}`,
      });
    }
  } catch {
    // Best-effort audit.
  }

  invalidateDataBookReadiness(projectId);
  revalidatePath(`/inspect/projects/${projectId}/data-book`);
  return { error: null };
}
