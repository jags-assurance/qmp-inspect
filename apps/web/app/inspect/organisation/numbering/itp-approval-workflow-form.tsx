"use client";

import { useActionState } from "react";
import { updateItpApprovalWorkflowAction, type ItpApprovalWorkflowState } from "@/lib/itp-approval-workflow/actions";
import { Button } from "@/components/ui/button";

const initialState: ItpApprovalWorkflowState = { error: null };

export interface StaffOption {
  id: string;
  full_name: string;
  email: string;
}

export function ItpApprovalWorkflowForm({
  organizationId,
  staff,
  requiredReviewerUserId,
  requiredApproverUserId,
}: {
  organizationId: string;
  staff: StaffOption[];
  requiredReviewerUserId: string | null;
  requiredApproverUserId: string | null;
}) {
  const [state, formAction, pending] = useActionState(updateItpApprovalWorkflowAction, initialState);

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="organization_id" value={organizationId} />

      <div>
        <label className="block text-xs font-medium text-muted">Required reviewer (draft → under review)</label>
        <select
          name="required_reviewer_user_id"
          defaultValue={requiredReviewerUserId ?? ""}
          className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
        >
          <option value="">— Unrestricted (any JAGS staff) —</option>
          {staff.map((s) => (
            <option key={s.id} value={s.id}>
              {s.full_name} ({s.email})
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-xs font-medium text-muted">Required approver (under review → approved)</label>
        <select
          name="required_approver_user_id"
          defaultValue={requiredApproverUserId ?? ""}
          className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
        >
          <option value="">— Unrestricted (any JAGS staff) —</option>
          {staff.map((s) => (
            <option key={s.id} value={s.id}>
              {s.full_name} ({s.email})
            </option>
          ))}
        </select>
      </div>

      {state.error && <p className="text-sm text-danger">{state.error}</p>}

      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save approval workflow"}
      </Button>
    </form>
  );
}
