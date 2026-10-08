"use client";

import { useActionState, useState } from "react";
import { proposeItpToMasterAction, type ProposeToMasterState } from "@/lib/itp-master/actions";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Tx } from "@/components/domain/tx";

const initialState: ProposeToMasterState = { error: null, success: false };

/**
 * Small inline form (not a modal — keeps this addition self-contained) that lets JAGS staff
 * propose this ITP's current content back to the master library, as either a brand-new template
 * or an update to an existing one. Only rendered by the detail page when the ITP's own status is
 * approved/client_accepted (see apps/web/app/inspect/itps/[id]/page.tsx).
 */
export function ProposeToMasterForm({
  itpId,
  itpTitle,
  masterTemplates,
}: {
  itpId: string;
  itpTitle: string;
  masterTemplates: { id: string; title: string }[];
}) {
  const [state, formAction, pending] = useActionState(proposeItpToMasterAction, initialState);
  const [open, setOpen] = useState(false);
  const [action, setAction] = useState<"new_template" | "update_existing">("new_template");

  if (!open) {
    return (
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Tx>Propose to master library</Tx>
      </Button>
    );
  }

  if (state.success) {
    return <p className="text-sm text-success"><Tx>Proposal submitted — an admin will review it.</Tx></p>;
  }

  return (
    <form action={formAction} className="w-full max-w-md rounded-lg border border-border bg-surface p-4 text-start">
      <input type="hidden" name="source_itp_id" value={itpId} />
      <p className="text-sm font-medium text-ink"><Tx>Propose to master library</Tx></p>

      <div className="mt-3 space-y-1">
        <label className="flex items-center gap-2 text-sm text-ink">
          <input
            type="radio"
            name="proposed_action"
            value="new_template"
            checked={action === "new_template"}
            onChange={() => setAction("new_template")}
          />
          <Tx>New master template</Tx>
        </label>
        <label className="flex items-center gap-2 text-sm text-ink">
          <input
            type="radio"
            name="proposed_action"
            value="update_existing"
            checked={action === "update_existing"}
            onChange={() => setAction("update_existing")}
          />
          <Tx>Update an existing master template</Tx>
        </label>
      </div>

      {action === "new_template" ? (
        <div className="mt-3">
          <FormField label="Template title">
            <input
            name="proposed_title"
            defaultValue={itpTitle}
            className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy"
          />
          </FormField>
        </div>
      ) : (
        <div className="mt-3">
          <FormField label="Target template">
            <select
            name="target_template_id"
            required
            className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy"
          >
            <option value=""><Tx>Select…</Tx></option>
            {masterTemplates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>
          </FormField>
        </div>
      )}

      <div className="mt-3">
        <FormField label="Notes for the reviewer">
          <textarea
          name="proposal_notes"
          rows={2}
          className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy"
        />
        </FormField>
      </div>

      {state.error && <p role="alert" className="mt-2 text-sm text-danger">{state.error}</p>}

      <div className="mt-3 flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Submitting…" : "Submit proposal"}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
          <Tx>Cancel</Tx>
        </Button>
      </div>
    </form>
  );
}
