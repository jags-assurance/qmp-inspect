"use client";

import { useActionState } from "react";
import { addItpItemAction, type AddItemState } from "@/lib/itps/actions";

const initialState: AddItemState = { error: null };

export function AddItemForm({
  itpId,
  sectionId,
  disciplines,
  isIssued,
  drawingDocuments,
}: {
  itpId: string;
  sectionId: string;
  disciplines: { id: string; code: string; name: string }[];
  /** True once the ITP has left draft/under_review (approved or client_accepted) — adding an
   *  activity at this point is an edit-after-issue (R101) and requires a reason, since it bumps a
   *  new revision and freezes the pre-edit content into history rather than editing silently. */
  isIssued: boolean;
  /** Vault documents from this project's "Drawings" folder — optional governing-drawing picker
   *  (R103/R125). Empty when the project has no drawings uploaded yet. */
  drawingDocuments: { id: string; title: string; revision: string }[];
}) {
  const [state, formAction, pending] = useActionState(addItpItemAction, initialState);

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3 border-t border-border bg-off-white px-4 py-4">
      <input type="hidden" name="itp_id" value={itpId} />
      <input type="hidden" name="section_id" value={sectionId} />

      <div>
        <label className="block text-xs font-medium text-muted">Item no.</label>
        <input
          name="item_number"
          required
          placeholder="1.1"
          className="mt-1 w-20 rounded-md border border-border bg-surface px-2.5 py-2 text-sm outline-none focus:border-burgundy"
        />
      </div>
      <div className="min-w-48 flex-1">
        <label className="block text-xs font-medium text-muted">Activity</label>
        <input
          name="activity"
          required
          className="mt-1 w-full rounded-md border border-border bg-surface px-2.5 py-2 text-sm outline-none focus:border-burgundy"
        />
      </div>
      <div className="min-w-48 flex-1">
        <label className="block text-xs font-medium text-muted">Acceptance criteria</label>
        <input
          name="acceptance_criteria"
          className="mt-1 w-full rounded-md border border-border bg-surface px-2.5 py-2 text-sm outline-none focus:border-burgundy"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-muted">Evidence</label>
        <select
          name="evidence_type"
          defaultValue="1"
          className="mt-1 rounded-md border border-border bg-surface px-2.5 py-2 text-sm outline-none focus:border-burgundy"
        >
          <option value="1">Checklist</option>
          <option value="2">Document upload</option>
          <option value="3">Measurement</option>
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium text-muted">Discipline</label>
        <select
          name="discipline_id"
          defaultValue=""
          className="mt-1 rounded-md border border-border bg-surface px-2.5 py-2 text-sm outline-none focus:border-burgundy"
        >
          <option value="">—</option>
          {disciplines.map((d) => (
            <option key={d.id} value={d.id}>
              {d.code}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium text-muted">Notice hours (override)</label>
        <input
          name="notice_hours_override"
          type="number"
          min={0}
          placeholder="Default"
          title="R25: optional per-activity notice period, in hours. Leave blank to use the project/organisation default for the level assigned on each cell."
          className="mt-1 w-24 rounded-md border border-border bg-surface px-2.5 py-2 text-sm outline-none focus:border-burgundy"
        />
      </div>
      {drawingDocuments.length > 0 && (
        <div>
          <label className="block text-xs font-medium text-muted">Governing drawing</label>
          <select
            name="governing_drawing_document_id"
            defaultValue=""
            className="mt-1 rounded-md border border-border bg-surface px-2.5 py-2 text-sm outline-none focus:border-burgundy"
          >
            <option value="">— None —</option>
            {drawingDocuments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.title} (Rev {d.revision})
              </option>
            ))}
          </select>
        </div>
      )}
      {isIssued && (
        <div className="min-w-64 flex-1">
          <label className="block text-xs font-medium text-danger">Reason for revision (required — this ITP is already issued)</label>
          <input
            name="revision_reason"
            required
            placeholder="Why this activity is being added after issue"
            className="mt-1 w-full rounded-md border border-danger/40 bg-surface px-2.5 py-2 text-sm outline-none focus:border-danger"
          />
        </div>
      )}
      <button
        type="submit"
        disabled={pending}
        className="rounded-md border border-border bg-surface px-3.5 py-2 text-sm font-medium hover:bg-off-white disabled:opacity-50"
      >
        {pending ? "Adding…" : isIssued ? "+ Add activity (new revision)" : "+ Add activity"}
      </button>
      {isIssued && (
        <p className="w-full text-xs text-warning">
          This ITP has already been issued — adding an activity will record a new revision and freeze the current content into history.
        </p>
      )}
      {state.error && <p className="w-full text-sm text-danger">{state.error}</p>}
    </form>
  );
}
