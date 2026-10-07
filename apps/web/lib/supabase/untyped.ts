/**
 * Escape hatch for tables / RPCs that exist in the database but are not yet in the generated
 * `Database` types (packages/shared-types). Keeping the loose typing here (instead of
 * `as any` at every call site) makes the debt greppable and removable in one place once
 * `pnpm db:types` is regenerated against the live schema.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type LooseClient = SupabaseClient<any, any, any>;

export function untypedFrom(client: unknown, table: string): ReturnType<LooseClient["from"]> {
  return (client as LooseClient).from(table);
}

export function untypedRpc(client: unknown, fn: string, args?: Record<string, unknown>): ReturnType<LooseClient["rpc"]> {
  return (client as LooseClient).rpc(fn, args);
}
/* eslint-enable @typescript-eslint/no-explicit-any */
