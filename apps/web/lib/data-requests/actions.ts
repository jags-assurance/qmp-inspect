"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceRoleClient, isServiceRoleConfigured } from "@/lib/supabase/service";
import { untypedRpc } from "@/lib/supabase/untyped";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { anonymisedEmail, MIN_REASON_LENGTH, MAX_REASON_LENGTH } from "./anonymise";

export interface AnonymiseState {
  error: string | null;
  message: string | null;
}

const PATH = "/inspect/organisation/data-requests";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Same "forever" ban the deactivation action uses.
const BAN_FOREVER = "876000h";

interface AnonymiseResult {
  status: "anonymised" | "already_anonymised";
  skipped?: { table: string; reason: string }[];
}

/**
 * U6: anonymises one account through the database function anonymise_user() (replaces name and email with
 * placeholders, deactivates the account, keeps every record, writes the audit event), then mirrors it in
 * Supabase Auth (placeholder email, permanent ban) when the service role is configured. JAGS Admin only; a
 * typed reason of at least MIN_REASON_LENGTH characters is required. Refuses the last active JAGS Admin and
 * the caller's own account (the function enforces both; the action only translates the error).
 */
export async function anonymiseUserAction(_prev: AnonymiseState, formData: FormData): Promise<AnonymiseState> {
  const session = await requireSession();
  if (!isAdminStaff(session)) return { error: "Only a JAGS Admin can anonymise an account.", message: null };

  const userId = String(formData.get("user_id") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();
  if (!UUID.test(userId)) return { error: "Choose an account first.", message: null };
  if (reason.length < MIN_REASON_LENGTH) return { error: `Enter a reason of at least ${MIN_REASON_LENGTH} characters (it is kept in the audit log).`, message: null };
  if (reason.length > MAX_REASON_LENGTH) return { error: `The reason can be at most ${MAX_REASON_LENGTH} characters.`, message: null };
  if (userId === session.userId) return { error: "You can't anonymise your own account.", message: null };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await untypedRpc(supabase, "anonymise_user", { p_user_id: userId, p_reason: reason });
  if (error) {
    const m = error.message ?? "";
    if (m.includes("last active JAGS Admin")) {
      return { error: "This is the last active JAGS Admin, so it can't be anonymised. Promote another admin first.", message: null };
    }
    if (m.includes("own account")) return { error: "You can't anonymise your own account.", message: null };
    if (error.code === "42501") return { error: "Only a JAGS Admin can anonymise an account.", message: null };
    if (error.code === "PGRST202" || error.code === "42883") {
      return { error: "The anonymisation database update (migration 20261129000100) has not been applied yet. Ask a JAGS Admin to apply it.", message: null };
    }
    console.error("[anonymise] rpc failed", error.code, m);
    return { error: "Could not anonymise that account. Check the server log and try again.", message: null };
  }

  const result = (data ?? {}) as AnonymiseResult;
  if (result.status === "already_anonymised") {
    revalidatePath(PATH);
  revalidatePath("/inspect/settings");
    return { error: null, message: "That account was already anonymised. Nothing was changed." };
  }

  const notes: string[] = [];
  if (isServiceRoleConfigured()) {
    const { error: authError } = await createSupabaseServiceRoleClient().auth.admin.updateUserById(userId, {
      email: anonymisedEmail(userId),
      email_confirm: true,
      ban_duration: BAN_FOREVER,
      app_metadata: { deactivated: true, anonymised: true },
      user_metadata: {},
    });
    if (authError) {
      console.error("[anonymise] auth update failed", authError.message);
      notes.push("The sign-in (Auth) record could not be updated: replace its email and ban the user in the Supabase dashboard (see the server log).");
    }
  } else {
    notes.push("SUPABASE_SERVICE_ROLE_KEY is not configured, so the sign-in (Auth) email was not replaced and no sign-in ban was applied; replace it in the Supabase dashboard.");
  }
  if (result.skipped?.some((s) => s.reason !== "table not present" && s.reason !== "columns not present")) {
    notes.push("Some related records could not be scrubbed (see the audit event).");
  }

  revalidatePath(PATH);
  revalidatePath("/inspect/settings");
  return { error: null, message: `Account anonymised and deactivated; all records were kept.${notes.length ? ` ${notes.join(" ")}` : ""}` };
}
