"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { DATA_BOOKS_TABLE } from "@/lib/databook/types";
import { computeDataBookReadiness } from "@/lib/databook/readiness";

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

  if (!projectId || !bookNumber || !title) {
    return { error: "Book number and title are required." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from(DATA_BOOKS_TABLE).insert({
    project_id: projectId,
    book_number: bookNumber,
    title,
  });

  if (error) {
    if (error.code === "23505") {
      return { error: "A Data Book with that number already exists for this project." };
    }
    return { error: "Could not create the Data Book. Check you have permission and try again." };
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

  const readiness = await computeDataBookReadiness(projectId);

  if (!readiness.isReady && !override) {
    return {
      error:
        "This project isn't ready to compile: every category must be 100% and the punch list must have zero open items. Use the override option to compile anyway with a documented reason.",
    };
  }

  if (override && !overrideReason) {
    return { error: "An override reason is required to compile with open items outstanding." };
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: updated, error } = await supabase
    .from(DATA_BOOKS_TABLE)
    .update({
      status: "compiled",
      compiled_by: user?.id ?? null,
      compiled_at: new Date().toISOString(),
      override_open_punch_items: override,
      override_reason: override ? overrideReason : null,
      override_by: override ? (user?.id ?? null) : null,
    })
    .eq("id", dataBookId)
    .eq("status", "draft")
    .select("id")
    .maybeSingle<{ id: string }>();

  if (error) {
    return { error: "Could not compile the Data Book. Check you have permission and try again." };
  }
  if (!updated) {
    return { error: "This Data Book has already been compiled or issued." };
  }

  revalidatePath(`/inspect/projects/${projectId}/data-book`);
  return { error: null };
}
