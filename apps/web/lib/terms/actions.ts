"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { recordAuditEvent } from "@/lib/audit/log";
import { untypedFrom } from "@/lib/supabase/untyped";
import { isMissingSchemaError } from "@/lib/offline/missing-schema";
import { TERMS_VERSION } from "./constants";

export interface AcceptTermsState {
  error: string | null;
  accepted: boolean;
}

/**
 * Records that the signed-in user accepted the current terms of use (U7). Only ever writes the caller's
 * own row. The version comes from the server constant, never from the form, so a stale or forged
 * client cannot record a version that was not shown. Until migration 20261128000100 is applied the
 * columns do not exist: the user gets a plain message and nothing else breaks.
 */
export async function acceptTermsAction(_prev: AcceptTermsState): Promise<AcceptTermsState> {
  const session = await requireSession();
  const supabase = await createSupabaseServerClient();

  const { error } = await untypedFrom(supabase, "users")
    .update({ terms_accepted_at: new Date().toISOString(), terms_version: TERMS_VERSION })
    .eq("id", session.userId);
  if (error) {
    if (isMissingSchemaError(error)) {
      return { error: "Recording acceptance needs the latest database update (migration 20261128000100). Ask a JAGS Admin to apply it. You can keep working.", accepted: false };
    }
    return { error: "Could not record your acceptance. Try again later; you can keep working.", accepted: false };
  }

  await recordAuditEvent(supabase, {
    organizationId: null,
    entityType: "user",
    entityId: session.userId,
    action: "terms_accepted",
    actorId: session.userId,
    summary: `Accepted the terms of use (version ${TERMS_VERSION})`,
    changes: { terms_version: TERMS_VERSION },
  });

  revalidatePath("/inspect", "layout");
  return { error: null, accepted: true };
}
