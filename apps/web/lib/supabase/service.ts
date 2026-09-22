import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@jags/shared-types";

/**
 * Server-only Supabase client authenticated as the service role — bypasses RLS entirely. This is
 * NOT the default way this app talks to the database: every Server Action/Component/most Route
 * Handlers use createSupabaseServerClient() (lib/supabase/server.ts) instead, which runs as the
 * caller's own session and stays inside RLS, "the database is the permission check" (see that
 * file's comment). This client exists for the one class of caller that has no session to run as
 * at all: an inbound webhook from a third party (app/api/vault/email-inbound/route.ts, R20b) that
 * needs to write a vault_documents row / storage object on behalf of a project it can't present a
 * user cookie for. Its shared-secret header check (VAULT_EMAIL_WEBHOOK_SECRET) is what stands in
 * for RLS there — see that route's own comment.
 *
 * SUPABASE_SERVICE_ROLE_KEY has been a documented-but-unused env var since .env.local.example was
 * first written ("used by admin server actions... bypasses RLS. Never expose to the browser") —
 * this is the first real caller. Never import this from anything that runs in the browser bundle
 * (it's a plain, non "use client" module specifically so a client component importing it by
 * mistake fails to build rather than shipping the key).
 */
export function isServiceRoleConfigured(): boolean {
  return Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.NEXT_PUBLIC_SUPABASE_URL);
}

export function createSupabaseServiceRoleClient(): SupabaseClient<Database> {
  if (!isServiceRoleConfigured()) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not configured in this environment — service-role Supabase access is unavailable."
    );
  }

  return createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
