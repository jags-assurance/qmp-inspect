"use client";

import { useActionState, useState } from "react";
import {
  createNcrAction,
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
}: {
  projects: { id: string; project_number: string; name: string }[];
  peopleByProject: Record<string, { id: string; name: string }[]>;
}) {
  const [state, formAction, pending] = useActionState(createNcrAction, initialState);
  const [draftState, draftFormAction, draftPending] = useActionState(
    draftNcrDescriptionAction,
    initialDraftState
  );

  const [projectId, setProjectId] = useState("");
  const [notes, setNotes] = useState("");
  const [description, setDescription] = useState("");
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
      <input type="hidden" name="ai_log_id" value={aiLogId ?? ""} />
      <input type="hidden" name="ai_original_description" value={aiOriginalDescription ?? ""} />
      <section className="space-y-4">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">Details</h2>

        <div>
          <label htmlFor="project_id" className="block text-sm font-medium text-ink">
            Project
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
            {NCR_SEVERITIES.map((severity, i) => (
              <label
                key={severity}
                className={cn(
                  "cursor-pointer rounded-full border border-border bg-surface px-3 py-2 text-center text-sm font-medium transition-colors",
                  SEVERITY_PILL_CLASS[severity]
                )}
              >
                <input
                  type="radio"
                  name="severity"
                  value={severity}
                  defaultChecked={i === 0}
                  required
                  className="sr-only"
                />
                {SEVERITY_LABEL[severity]}
              </label>
            ))}
          </div>
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
          {draftState.error && <p className="mt-2 text-sm text-danger">{draftState.error}</p>}
        </div>

        <div>
          <label htmlFor="description" className="block text-sm font-medium text-ink">
            Description
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
              className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy"
            />
          </div>
        </div>
      </section>

      {state.error && <p className="text-sm text-danger">{state.error}</p>}

      <Button type="submit" disabled={pending}>
        {pending ? "Raising…" : "Raise NCR"}
      </Button>
    </form>
  );
}
