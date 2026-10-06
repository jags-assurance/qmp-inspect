"use client";

import { useActionState, useState } from "react";
import { addItpItemAction, type AddItemState } from "@/lib/itps/actions";

const initialState: AddItemState = { error: null };

export function AddItemForm({
  itpId,
  sectionId,
  suggestedItemNumber,
  disciplines,
  isIssued,
  drawingDocuments,
  parties = [],
  levels = [],
}: {
  itpId: string;
  sectionId: string;
  /** Next free activity number in this section (e.g. "2.4"), pre-filled so numbering stays sequential. */
  suggestedItemNumber?: string;
  disciplines: { id: string; code: string; name: string }[];
  /** True once the ITP has left draft/under_review (approved or client_accepted) — adding an
   *  activity at this point is an edit-after-issue (R101) and requires a reason, since it bumps a
   *  new revision and freezes the pre-edit content into history rather than editing silently. */
  isIssued: boolean;
  /** Vault documents from this project's "Drawings" folder — optional governing-drawing picker
   *  (R103/R125). Empty when the project has no drawings uploaded yet. */
  drawingDocuments: { id: string; title: string; revision: string }[];
  /** This project's parties and this organisation's intervention levels — so each party's Hold / Witness / Review / Surveillance can be set while the activity is being created, not only afterwards in the grid. */
  parties?: { id: string; name: string }[];
  levels?: { code: string; label: string }[];
}) {
  const [state, formAction, pending] = useActionState(addItpItemAction, initialState);
  // Was always rendered fully open, one 7-field row per section, whether or not anyone was
  // actively adding an activity — real clutter on an ITP with several sections. Collapsed behind
  // its own button, same click-to-reveal pattern as the per-activity evidence sections right above.
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full border-t border-border bg-off-white px-4 py-2.5 text-left text-sm font-medium text-burgundy hover:bg-burgundy/5"
      >
        + Add activity
      </button>
    );
  }

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3 border-t border-border bg-off-white px-4 py-4">
      <input type="hidden" name="itp_id" value={itpId} />
      <input type="hidden" name="section_id" value={sectionId} />

      <div>
        <label className="block text-xs font-medium text-muted">Item no.</label>
        <input
          name="item_number"
          required
          defaultValue={suggestedItemNumber}
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
      <div className="min-w-48 flex-1">
        <label className="block text-xs font-medium text-muted">Reference document / clause</label>
        <input
          name="reference_spec"
          placeholder="e.g. Spec 03300 cl. 5.2 / API 1104"
          className="mt-1 w-full rounded-md border border-border bg-surface px-2.5 py-2 text-sm outline-none focus:border-burgundy"
        />
      </div>
      <div className="min-w-32">
        <label className="block text-xs font-medium text-muted">Method</label>
        <input
          name="method"
          placeholder="e.g. Visual, UT, Hydrotest"
          className="mt-1 w-full rounded-md border border-border bg-surface px-2.5 py-2 text-sm outline-none focus:border-burgundy"
        />
      </div>
      <div className="min-w-32">
        <label className="block text-xs font-medium text-muted">Frequency / sample</label>
        <input
          name="frequency"
          placeholder="e.g. 100%, each pour, 1 in 10"
          className="mt-1 w-full rounded-md border border-border bg-surface px-2.5 py-2 text-sm outline-none focus:border-burgundy"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-muted" title="Checklist: the inspector answers a checklist on site. Document upload: a record or certificate is attached. Measurement: values are recorded against nominal and tolerance.">
          Evidence
        </label>
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
      {parties.length > 0 && levels.length > 0 && (
        <fieldset className="w-full rounded-md border border-border bg-surface px-3 py-2">
          <legend className="px-1 text-xs font-medium text-muted">Sign-off level per party (optional — leave blank for no intervention)</legend>
          <div className="mt-1 grid gap-x-4 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
            {parties.map((party) => (
              <label key={party.id} className="flex items-center justify-between gap-2 text-sm text-ink">
                <span className="min-w-0 truncate" title={party.name}>
                  {party.name}
                </span>
                <select
                  name={`intervention__${party.id}`}
                  defaultValue=""
                  aria-label={`Sign-off level for ${party.name}`}
                  className="rounded-md border border-border bg-off-white px-2 py-1.5 text-sm outline-none focus:border-burgundy"
                >
                  <option value="">—</option>
                  {levels.map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.code} — {l.label}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </fieldset>
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
        {pending ? "Adding…" : isIssued ? "Add activity (new revision)" : "Add activity"}
      </button>
      <button type="button" onClick={() => setOpen(false)} className="text-sm text-muted hover:underline">
        Cancel
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
