"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ACTIVE_PROJECT_COOKIE, isProjectId } from "./active-project";

/**
 * Header project selector: remembers the chosen project (blank = All projects). The id is checked
 * against what the caller can read (RLS), so a project they cannot see is never stored.
 */
export async function setActiveProjectAction(formData: FormData): Promise<void> {
  await requireSession();
  const raw = String(formData.get("project_id") ?? "").trim();
  const jar = await cookies();
  if (!raw) {
    jar.delete(ACTIVE_PROJECT_COOKIE);
  } else {
    if (!isProjectId(raw)) return;
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase.from("projects").select("id").eq("id", raw).maybeSingle<{ id: string }>();
    if (!data) return;
    jar.set(ACTIVE_PROJECT_COOKIE, raw, {
      path: "/",
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 24 * 90,
    });
  }
  revalidatePath("/", "layout");
}
