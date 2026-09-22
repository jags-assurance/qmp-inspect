"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { ITP_APPROVAL_WORKFLOW_CONFIGS_TABLE } from "./types";

export interface ItpApprovalWorkflowState {
  error: string | null;
}

/**
 * Sets or clears this organisation's required-reviewer / required-approver for the ITP
 * draft -> under_review -> approved chain (R79). An empty select value clears that slot back to
 * "any JAGS staff with org access" — today's unrestricted default — rather than leaving the field
 * required, since a busy admin needs an easy way to remove a restriction, not just add one.
 *
 * RLS (itp_approval_workflow_configs_admin_write) already stops any non-staff user cold; the
 * Admin/Inspector split is a business permission enforced here, same pattern as
 * updateEngagementModeAction.
 */
export async function updateItpApprovalWorkflowAction(
  _prev: ItpApprovalWorkflowState,
  formData: FormData
): Promise<ItpApprovalWorkflowState> {
  const session = await requireSession();
  if (!isAdminStaff(session)) {
    return { error: "Only a JAGS Admin can change the ITP approval workflow." };
  }

  const organizationId = String(formData.get("organization_id") ?? "").trim();
  const requiredReviewerUserId = String(formData.get("required_reviewer_user_id") ?? "").trim();
  const requiredApproverUserId = String(formData.get("required_approver_user_id") ?? "").trim();

  if (!organizationId) {
    return { error: "Organisation is required." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from(ITP_APPROVAL_WORKFLOW_CONFIGS_TABLE).upsert(
    {
      organization_id: organizationId,
      required_reviewer_user_id: requiredReviewerUserId || null,
      required_approver_user_id: requiredApproverUserId || null,
    },
    { onConflict: "organization_id" }
  );

  if (error) {
    return { error: "Could not save the ITP approval workflow. Check you have permission and try again." };
  }

  revalidatePath("/inspect/organisation/numbering");
  return { error: null };
}
