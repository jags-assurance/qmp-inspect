"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import {
  createNcrAction,
  findOpenNcrsForItemAction,
  draftNcrDescriptionAction,
  type CreateNcrState,
  type DraftNcrDescriptionState,
} from "@/lib/ncrs/actions";
import { NCR_SEVERITIES, type NcrSeverity } from "@/lib/ncrs/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

const initialState: CreateNcrState = { error: null };
const initialDraftState: DraftNcrDescriptionState = {
  error: null,
  description: null,
  requirementNotMet: null,
  aiLogId: null,
};

const DEFAULT_DAYS: Record<NcrSeverity, number> = { major_ncr: 7, minor_ncr: 14, observation: 30 };
function addDays(n: number): string {
  return new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
}
const SEVERITY_HELP: Record<NcrSeverity, string> = {
  major_ncr: "Major: affects safety, structural integrity or a hold point. Needs urgent corrective action.",
  minor_ncr: "Minor: isolated departure from the specification that does not affect safety or function.",
  observation: "Observation: a potential issue or improvement. No formal corrective action required unless graded up.",
};

const SEVERITY_LABEL: Record<NcrSeverity, string> = {
  observation: "Observation",
  minor_ncr: "Minor NCR",
  major_ncr: "Major NCR",
};

// Matches the Badge tones used for severity everywhere else (register, detail page): info/gold/danger.
const SEVERITY_PILL_CLASS: Record<NcrSeverity, string> = {
  observation: "has-[:checked]:border-info has-[:checked]:bg-info has-[:checked]:text-white",
  minor_ncr: "has-[:checked]:border-gold has-[:checked]:bg-gold has-[:checked]:text-[color:var(--color-burgundy-dark)]",
  major_ncr: "has-[:checked]:border-danger has-[:checked]:bg-danger has-[:checked]:text-white",
};

export function NewNcrForm({
  projects,
  peopleByProject,
  partiesByProject,
  initialProjectId,
  itpItemId,
  inspectionRecordId,
  checklistItemId,
  initialDescription,
  defaultSeverity,
  lockSeverity,
  onCreated,
}: {
  projects: { id: string; project_number: string; name: string }[];
  peopleByProject: Record<string, { id: string; name: string }[]>;
  /** R68: this project's active parties, for the optional "responsible party" picker. */
  partiesByProject: Record<string, { id: string; name: string; party_type: string }[]>;
  /** Pre-fill from a failed inspection record's "Raise NCR" link (app/inspect/inspections/[id]) —
   * itpItemId/inspectionRecordId are the real FK linkage (see createNcrAction); the project/severity/
   * description fields stay fully editable either way. */
  initialProjectId?: string;
  itpItemId?: string;
  inspectionRecordId?: string;
  /** The checklist item this NCR is raised from (stored as ncrs.checklist_item_id). */
  checklistItemId?: string;
  initialDescription?: string;
  /** Preselected severity (default: observation). */
  defaultSeverity?: NcrSeverity;
  /** Hides the other severities, e.g. when raising from the Observations register. */
  lockSeverity?: boolean;
  /** When given, the form is hosted in a side panel: it stays on the page after raising and reports
   *  the new record here instead of redirecting to the NCR's own page. */
  onCreated?: (created: { id: string; ncrNumber: string }) => void;
}) {
  const [state, formAction, pending] = useActionState(createNcrAction, initialState);
  const [draftState, draftFormAction, draftPending] = useActionState(
    draftNcrDescriptionAction,
    initialDraftState
  );

  // Report each created record once, even if the parent hands us a new onCreated every render.
  const reportedId = useRef<string | null>(null);
  useEffect(() => {
    if (state.created && reportedId.current !== state.created.id) {
      reportedId.current = state.created.id;
      onCreated?.(state.created);
    }
  }, [state.created, onCreated]);

  const [projectId, setProjectId] = useState(initialProjectId ?? "");
  const [severity, setSeverity] = useState<NcrSeverity>(defaultSeverity ?? "observation");
  const [dueDate, setDueDate] = useState(() => addDays(DEFAULT_DAYS[defaultSeverity ?? "observation"]));
  const [dueTouched, setDueTouched] = useState(false);
  const [duplicates, setDuplicates] = useState<{ id: string; ncr_number: string; description: string; status: string }[]>([]);
  useEffect(() => {
    if (!itpItemId) return;
    let cancelled = false;
    findOpenNcrsForItemAction(itpItemId)
      .then((r) => !cancelled && setDuplicates(r))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [itpItemId]);
  const [notes, setNotes] = useState("");
  const [description, setDescription] = useState(initialDescription ?? "");
  const [requirementNotMet, setRequirementNotMet] = useState("");
  const [aiLogId, setAiLogId] = useState<string | null>(null);
  const [aiOriginalDescription, setAiOriginalDescription] = useState<string | null>(null);

  // Fills the (still fully editable) description/requirement fields once a fresh draft comes
  // back, derived during render (React's documented "adjust state while rendering" pattern)
  // rather than in a useEffect — never auto-submits the NCR itself.
  const [appliedDraftState, setAppliedDraftState] = useState(draftState);
  if (draftState !== appliedDraftState) {
    setAppliedDraftState(draftState);
    if (draftState.description !== null) {
      setDescription(draftState.description);
      setRequirementNotMet(draftState.requirementNotMet ?? "");
      setAiLogId(draftState.aiLogId);
      setAiOriginalDescription(draftState.description);
    }
  }

  return (
    <form action={formAction} className="mt-6 space-y-6">
      {onCreated && <input type="hidden" name="stay_on_page" value="true" />}
      <input type="hidden" name="ai_log_id" value={aiLogId ?? ""} />
      <input type="hidden" name="ai_original_description" value={aiOriginalDescription ?? ""} />
      {itpItemId && <input type="hidden" name="itp_item_id" value={itpItemId} />}
      {inspectionRecordId && <input type="hidden" name="inspection_record_id" value={inspectionRecordId} />}
      {checklistItemId && <input type="hidden" name="checklist_item_id" value={checklistItemId} />}
      <section className="space-y-4">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">Details</h2>

        <div>
          <label htmlFor="project_id" className="block text-sm font-medium text-ink">
            Project <span className="text-danger">*</span>
          </label>
          <select
            id="project_id"
            name="project_id"
            required
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy"
          >
            <option value="">Select…</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.project_number} — {p.name}
              </option>
            ))}
          </select>
        </div>

        <fieldset>
          <legend className="block text-sm font-medium text-ink">Severity</legend>
          <div className="mt-1 grid grid-cols-3 gap-2">
            {NCR_SEVERITIES.filter((sv) => !lockSeverity || sv === severity).map((sv) => (
              <label
                key={sv}
                className={cn(
                  "cursor-pointer rounded-full border border-border bg-surface px-3 py-2 text-center text-sm font-medium transition-colors",
                  SEVERITY_PILL_CLASS[sv]
                )}
              >
                <input
                  type="radio"
                  name="severity"
                  value={sv}
                  checked={severity === sv}
                  onChange={() => {
                    setSeverity(sv);
                    if (!dueTouched) setDueDate(addDays(DEFAULT_DAYS[sv]));
                  }}
                  required
                  className="sr-only"
                />
                {SEVERITY_LABEL[sv]}
              </label>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-muted">
            {SEVERITY_HELP[severity]} Default: due in {DEFAULT_DAYS[severity]} days.
          </p>
        </fieldset>
      </section>

      <hr className="border-border" />

      <section className="space-y-4">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">Description</h2>

        <div className="rounded-md border border-border bg-off-white p-3">
          <label htmlFor="ai_notes" className="block text-sm font-medium text-ink">
            Draft with AI (optional)
          </label>
          <textarea
            id="ai_notes"
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Jot down factual notes — equipment, what was observed…"
            className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy"
          />
          <button
            type="button"
            disabled={draftPending || !projectId || !notes.trim()}
            onClick={() => {
              const fd = new FormData();
              fd.set("project_id", projectId);
              fd.set("notes", notes);
              draftFormAction(fd);
            }}
            className="mt-2 rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-ink hover:bg-off-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {draftPending ? "Drafting…" : "Draft with AI"}
          </button>
          {/* Real gap found live: the button just silently stayed disabled with no explanation when
              a project hadn't been picked yet, or the notes box was still empty — looked broken
              rather than waiting on input. */}
          {!draftPending && !projectId && (
            <p className="mt-1.5 text-xs text-muted">Select a project above first.</p>
          )}
          {!draftPending && projectId && !notes.trim() && (
            <p className="mt-1.5 text-xs text-muted">Jot down some field notes above first.</p>
          )}
          {draftState.error && <p className="mt-2 text-sm text-danger">{draftState.error}</p>}
        </div>

        <div>
          <label htmlFor="description" className="block text-sm font-medium text-ink">
            Description <span className="text-danger">*</span>
          </label>
          <textarea
            id="description"
            name="description"
            required
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What was observed / not conforming…"
            className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy"
          />
        </div>

        <div>
          <label htmlFor="requirement_not_met" className="block text-sm font-medium text-ink">
            Requirement not met
          </label>
          <textarea
            id="requirement_not_met"
            name="requirement_not_met"
            rows={2}
            value={requirementNotMet}
            onChange={(e) => setRequirementNotMet(e.target.value)}
            placeholder="Spec clause, drawing note, or ITP acceptance criteria not met…"
            className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy"
          />
        </div>
      </section>

      <hr className="border-border" />

      <section className="space-y-4">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">Assignment</h2>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="assigned_to" className="block text-sm font-medium text-ink">
              Assigned to
            </label>
            <select
              id="assigned_to"
              name="assigned_to"
              defaultValue=""
              disabled={!projectId}
              className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy disabled:opacity-60"
            >
              <option value="">Unassigned</option>
              {(peopleByProject[projectId] ?? []).map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </select>
            {!projectId && <p className="mt-1 text-xs text-muted">Select a project first.</p>}
          </div>
          <div>
            <label htmlFor="due_date" className="block text-sm font-medium text-ink">
              Due date
            </label>
            <input
              id="due_date"
              name="due_date"
              type="date"
              required
              value={dueDate}
              onChange={(e) => {
                setDueDate(e.target.value);
                setDueTouched(true);
              }}
              className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy"
            />
          </div>
        </div>

        <div>
          <label htmlFor="responsible_party_id" className="block text-sm font-medium text-ink">
            Responsible party <span className="font-normal text-muted">(optional)</span>
          </label>
          <select
            id="responsible_party_id"
            name="responsible_party_id"
            defaultValue=""
            disabled={!projectId}
            className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy disabled:opacity-60"
          >
            <option value="">Not specified</option>
            {(partiesByProject[projectId] ?? []).map((party) => (
              <option key={party.id} value={party.id}>
                {party.name} ({party.party_type})
              </option>
            ))}
          </select>
          {!projectId && <p className="mt-1 text-xs text-muted">Select a project first.</p>}
        </div>
      </section>

      {duplicates.length > 0 && (
        <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-ink">
          <p className="font-medium">Open NCRs already exist on this activity</p>
          <ul className="mt-1 space-y-0.5 text-xs">
            {duplicates.map((d) => (
              <li key={d.id}>
                <a href={`/inspect/ncrs/${d.id}`} target="_blank" rel="noreferrer" className="text-burgundy hover:underline">
                  {d.ncr_number}
                </a>{" "}
                ({d.status.replace("_", " ")}): {d.description.slice(0, 80)}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-muted">Check it is not the same issue before raising another.</p>
        </div>
      )}

      {state.error && <p className="text-sm text-danger">{state.error}</p>}

      <Button type="submit" disabled={pending}>
        {pending ? "Raising…" : "Raise NCR"}
      </Button>
    </form>
  );
}
