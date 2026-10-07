"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { recordAuditEvent } from "@/lib/audit/log";
import { DATA_BOOKS_TABLE, type ConditionalOpenItem } from "@/lib/databook/types";
import { PUNCH_LIST_ITEMS_TABLE } from "@/lib/punch-list/types";
import { computeDataBookReadiness } from "@/lib/databook/readiness";
import { categoriesToOverrideItems, failingReadinessCategories, validateBookFields } from "@/lib/databook/helpers";

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

  const createSession = await requireSession();
  if (!createSession.isJagsStaff) {
    return { error: "Only JAGS staff can create a Data Book." };
  }

  if (!projectId) return { error: "Missing project." };
  const fieldError = validateBookFields(bookNumber, title);
  if (fieldError) return { error: fieldError };

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
  const { data: dataBook, error } = await supabase
    .from(DATA_BOOKS_TABLE)
    .insert({
      project_id: projectId,
      book_number: bookNumber,
      title,
    })
    .select("id")
    .single<{ id: string }>();

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
        summary: `Data Book ${bookNumber} created`,
      });
    }
  } catch {
    // Best-effort — see lib/audit/log.ts's doc comment.
  }

  revalidatePath(`/inspect/projects/${projectId}/data-book`);
  return { error: null };
}

export interface CompileDataBookState {
  error: string | null;
}

/**
 * Compiles a draft Data Book (R86-R87). Blocked unless every readiness category is at 100% and the
 * project's punch list has zero open items, UNLESS override is set — which requires a staff user
 * (already required to reach this action at all, per data_books_staff_write RLS) and a documented
 * reason, both of which are recorded on the row as a deliberate, visible, logged exception rather
 * than a silent bypass.
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

  const supabaseCheck = await createSupabaseServerClient();
  const { data: bookCheck } = await supabaseCheck
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

  const readiness = await computeDataBookReadiness(projectId);
  // An override is only meaningful (and only recorded) when the gates genuinely fail; a ready
  // project compiles cleanly and is never mislabelled as a conditional handover.
  // The project must be Completed for a clean (non-conditional) final book. Not completed is treated
  // as one more failing gate that needs the same documented override.
  const supabase = await createSupabaseServerClient();
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
  // Snapshot of everything outstanding at override time: every failing readiness category with its
  // counts, then each open punch item with owner and due date.
  let overrideItems: ConditionalOpenItem[] | null = null;
  if (conditional) {
    const { data: openItems } = await supabase
      .from(PUNCH_LIST_ITEMS_TABLE)
      .select("id, description, location, due_date, project_parties(name)")
      .eq("project_id", projectId)
      .neq("status", "closed")
      .limit(5000)
      .returns<{ id: string; description: string; location: string | null; due_date: string | null; project_parties: { name: string } | null }[]>();

    const categoryItems = categoriesToOverrideItems(failingReadinessCategories(readiness).filter((c) => c.category !== "Punch list items closed"));
    if (projectNotCompleted) {
      categoryItems.push({
        id: "category:project-status",
        description: `Project status is "${projectRow?.status ?? "unknown"}", not Completed`,
        location: null,
        due_date: null,
        responsible_party_name: null,
      });
    }
    overrideItems = [
      ...categoryItems,
      ...(openItems ?? []).map((item) => ({
        id: item.id,
        description: item.description,
        location: item.location,
        due_date: item.due_date,
        responsible_party_name: item.project_parties?.name ?? null,
      })),
    ];
  }

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

  revalidatePath(`/inspect/projects/${projectId}/data-book`);
  return { error: null };
}
