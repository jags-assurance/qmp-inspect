"use client";

import { useActionState, useState } from "react";
import { setDocumentApproversAction, type SetDocumentApproversState } from "@/lib/vault/multi-approval-actions";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Tx } from "@/components/domain/tx";
import { Disclosure } from "@/components/ui/disclosure";

const initialState: SetDocumentApproversState = { error: null };

export interface ApproverOption {
  id: string;
  name: string;
}

/**
 * Custom option: require specific named people to independently agree before a document counts as
 * approved, instead of the default "first permitted person clicks Approve." Staff-only, and only
 * useful before the document is already approved (see the action's own guard).
 */
export function SetApproversForm({
  documentOptions,
  approverOptions,
}: {
  documentOptions: { id: string; label: string; currentApproverIds: string[] }[];
  approverOptions: ApproverOption[];
}) {
  const [state, formAction, pending] = useActionState(setDocumentApproversAction, initialState);
  const [selectedDocId, setSelectedDocId] = useState(documentOptions[0]?.id ?? "");
  const selectedDoc = documentOptions.find((d) => d.id === selectedDocId);

  if (documentOptions.length === 0) return null;

  return (
    <Disclosure variant="pill" className="mt-6" bodyClassName="" summary={<Tx>Require specific approvers (optional)</Tx>}>
    <form action={formAction} className="mt-2 rounded-lg border border-border bg-surface p-4">
      <p className="text-xs text-muted">
        <Tx>Tick who must all agree. Leave none ticked so any permitted person can approve alone.</Tx>
      </p>

      <div className="mt-3 flex flex-wrap items-end gap-3">
        <div>
          <FormField label="Document">
            <select
            name="document_id"
            value={selectedDocId}
            onChange={(e) => setSelectedDocId(e.target.value)}
            className="mt-1 w-64 rounded-md border border-border bg-off-white px-2.5 py-1.5 text-sm"
          >
            {documentOptions.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </select>
          </FormField>
        </div>
        <Button type="submit" variant="outline" disabled={pending}>
          {pending ? "Saving…" : "Save required approvers"}
        </Button>
      </div>

      {/* Keyed on the selected document so switching it remounts these uncontrolled checkboxes —
          otherwise defaultChecked would stay frozen at whichever document was selected first. */}
      <div key={selectedDocId} className="mt-3 flex flex-wrap gap-3">
        {approverOptions.map((a) => (
          <label key={a.id} className="flex items-center gap-1.5 text-sm text-ink">
            <input
              type="checkbox"
              name="approver_user_ids"
              value={a.id}
              defaultChecked={selectedDoc?.currentApproverIds.includes(a.id)}
            />
            {a.name}
          </label>
        ))}
      </div>
      {state.error && <p role="alert" className="mt-2 text-sm text-danger">{state.error}</p>}
    </form>
    </Disclosure>
  );
}
