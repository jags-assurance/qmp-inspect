"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceRoleClient, isServiceRoleConfigured } from "@/lib/supabase/service";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { recordAuditEvent } from "@/lib/audit/log";
import { MAX_BULK_ACCOUNTS, parseEmailList } from "@/lib/auth/bulk-emails";

export interface DeactivationState {
  error: string | null;
  message: string | null;
}

export interface BulkDeactivationResult {
  email: string;
  ok: boolean;
  detail: string;
}

export interface BulkDeactivationState {
  error: string | null;
  results: BulkDeactivationResult[];
}

const PATH = "/inspect/organisation/staff-access";
// Long enough to be "forever"; Supabase accepts hour units ("876000h" ~ 100 years), "none" lifts it.
const BAN_FOREVER = "876000h";

interface TargetRow {
  id: string;
  email: string;
  full_name: string;
  is_active: boolean;
}

interface GrantRow {
  scope_type: "global" | "organization" | "project";
  organization_id: string | null;
  project_id: string | null;
  role: string;
}

async function loadTarget(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const userId = String(formData.get("user_id") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  let query = supabase.from("users").select("id, email, full_name, is_active");
  if (userId) query = query.eq("id", userId);
  else if (email) query = query.ilike("email", email.replace(/[%_\\]/g, (m) => `\\${m}`));
  else return { supabase, target: null as TargetRow | null };
  const { data } = await query.maybeSingle<TargetRow>();
  return { supabase, target: data ?? null };
}

/**
 * Offboards an account (JAGS staff or an external party user): marks public.users.is_active = false
 * (the RLS helpers stop recognising the account — 20261104000100), bans the Auth user so no new
 * session can be issued and flags app_metadata.deactivated so proxy.ts ends any session that is
 * already open, and removes every access grant (recorded in the audit event so reactivation can
 * restore them). JAGS Admin only. Works without the migration or the service role too: each step
 * that cannot run is reported, not silently skipped.
 */
export async function deactivateUserAction(_prev: DeactivationState, formData: FormData): Promise<DeactivationState> {
  const session = await requireSession();
  if (!isAdminStaff(session)) return { error: "Only a JAGS Admin can deactivate an account.", message: null };

  const { supabase, target } = await loadTarget(formData);
  const result = await deactivateTarget(session.userId, supabase, target);
  if (!result.error) revalidatePath(PATH);
  return result;
}

type Supabase = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/** The deactivation steps for one resolved account. The caller has already checked the actor is a JAGS Admin. */
async function deactivateTarget(actorId: string, supabase: Supabase, target: TargetRow | null): Promise<DeactivationState> {
  if (!target) return { error: "No matching account found.", message: null };
  if (target.id === actorId) return { error: "You can't deactivate your own account.", message: null };
  if (!target.is_active) return { error: "That account is already deactivated.", message: null };

  const { data: grants } = await supabase
    .from("access_grants")
    .select("scope_type, organization_id, project_id, role")
    .eq("user_id", target.id)
    .returns<GrantRow[]>();

  // 1. Database flag first: it carries the last-admin guard, so a refusal stops everything here.
  const { error: flagError } = await supabase.from("users").update({ is_active: false }).eq("id", target.id);
  if (flagError) {
    return {
      error: flagError.message.includes("last active JAGS Admin")
        ? "This is the last active JAGS Admin, so it can't be deactivated. Promote another admin first."
        : "Could not deactivate that account. Check you have permission and try again.",
      message: null,
    };
  }

  const notes: string[] = [];

  // 2. Ban + flag the Auth user (needs the service role).
  if (isServiceRoleConfigured()) {
    const { error: banError } = await createSupabaseServiceRoleClient().auth.admin.updateUserById(target.id, {
      ban_duration: BAN_FOREVER,
      app_metadata: { deactivated: true },
    });
    if (banError) notes.push(`The sign-in ban could not be applied (${banError.message}); database access is already revoked.`);
  } else {
    notes.push("SUPABASE_SERVICE_ROLE_KEY is not configured, so the Auth sign-in ban was not applied; database access is already revoked.");
  }

  // 3. Revoke grants.
  const { error: revokeError } = await supabase.from("access_grants").delete().eq("user_id", target.id);
  if (revokeError) notes.push("Some access grants could not be removed; the account is inactive regardless.");

  await recordAuditEvent(supabase, {
    organizationId: null,
    entityType: "user",
    entityId: target.id,
    action: "deactivated",
    actorId,
    summary: `Account ${target.email} deactivated and ${grants?.length ?? 0} access grant(s) revoked`,
    changes: { grants: grants ?? [] },
  });

  return { error: null, message: `${target.full_name} (${target.email}) was deactivated.${notes.length ? ` ${notes.join(" ")}` : ""}` };
}

/**
 * S1-16: deactivates (or restores) several accounts in one go from a pasted list of emails, e.g. when a whole
 * subcontractor crew leaves a project. JAGS Admin only; at most MAX_BULK_ACCOUNTS addresses per request; each
 * account is processed on its own with the same safeguards as the single action (last-admin guard, no
 * self-deactivation) and the result is reported per address.
 */
export async function bulkAccountLifecycleAction(_prev: BulkDeactivationState, formData: FormData): Promise<BulkDeactivationState> {
  const session = await requireSession();
  if (!isAdminStaff(session)) return { error: "Only a JAGS Admin can deactivate accounts.", results: [] };

  const intent = String(formData.get("intent") ?? "deactivate") === "reactivate" ? "reactivate" : "deactivate";
  const parsed = parseEmailList(String(formData.get("emails") ?? ""), MAX_BULK_ACCOUNTS);
  if (parsed.emails.length === 0) return { error: "Paste at least one email address.", results: [] };
  if (parsed.truncated) return { error: `At most ${MAX_BULK_ACCOUNTS} addresses can be processed at once.`, results: [] };

  const results: BulkDeactivationResult[] = [];
  for (const email of parsed.emails) {
    const fd = new FormData();
    fd.set("email", email);
    const { supabase, target } = await loadTarget(fd);
    const outcome =
      intent === "reactivate"
        ? await reactivateTarget(session.userId, supabase, target)
        : await deactivateTarget(session.userId, supabase, target);
    results.push({ email, ok: !outcome.error, detail: outcome.error ?? outcome.message ?? "" });
  }
  for (const bad of parsed.invalid) results.push({ email: bad, ok: false, detail: "Not a valid email address." });

  revalidatePath(PATH);
  return { error: null, results };
}

/** Form entry point for the "by email" box: `intent` is "deactivate" (default) or "reactivate". */
export async function accountLifecycleByEmailAction(prev: DeactivationState, formData: FormData): Promise<DeactivationState> {
  return String(formData.get("intent") ?? "deactivate") === "reactivate"
    ? reactivateUserAction(prev, formData)
    : deactivateUserAction(prev, formData);
}

/** Reverses deactivateUserAction: lifts the ban, sets is_active again, and restores the grants that deactivation recorded. */
export async function reactivateUserAction(_prev: DeactivationState, formData: FormData): Promise<DeactivationState> {
  const session = await requireSession();
  if (!isAdminStaff(session)) return { error: "Only a JAGS Admin can reactivate an account.", message: null };

  const { supabase, target } = await loadTarget(formData);
  const result = await reactivateTarget(session.userId, supabase, target);
  if (!result.error) revalidatePath(PATH);
  return result;
}

async function reactivateTarget(actorId: string, supabase: Supabase, target: TargetRow | null): Promise<DeactivationState> {
  if (!target) return { error: "No matching account found.", message: null };
  if (target.is_active) return { error: "That account is already active.", message: null };

  const { error: flagError } = await supabase.from("users").update({ is_active: true }).eq("id", target.id);
  if (flagError) return { error: "Could not reactivate that account. Check you have permission and try again.", message: null };

  const notes: string[] = [];
  if (isServiceRoleConfigured()) {
    const { error: banError } = await createSupabaseServiceRoleClient().auth.admin.updateUserById(target.id, {
      ban_duration: "none",
      app_metadata: { deactivated: false },
    });
    if (banError) notes.push(`The sign-in ban could not be lifted (${banError.message}).`);
  }

  // Restore what the last deactivation removed.
  const { data: lastEvent } = await supabase
    .from("audit_log" as never)
    .select("changes")
    .eq("entity_type", "user")
    .eq("entity_id", target.id)
    .eq("action", "deactivated")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ changes: { grants?: GrantRow[] } | null }>();
  const previous = lastEvent?.changes?.grants ?? [];
  let restored = 0;
  for (const g of previous) {
    const { error } = await supabase.from("access_grants").insert({
      user_id: target.id,
      scope_type: g.scope_type,
      organization_id: g.organization_id,
      project_id: g.project_id,
      role: g.role,
    });
    if (!error) restored += 1;
  }

  await recordAuditEvent(supabase, {
    organizationId: null,
    entityType: "user",
    entityId: target.id,
    action: "reactivated",
    actorId,
    summary: `Account ${target.email} reactivated; ${restored} access grant(s) restored`,
  });

  return {
    error: null,
    message: `${target.full_name} was reactivated and ${restored} access grant(s) restored.${notes.length ? ` ${notes.join(" ")}` : ""}`,
  };
}
