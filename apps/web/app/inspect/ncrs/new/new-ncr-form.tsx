"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { compressFormPhotos } from "@/lib/media/compress-form-photos";
import { useRouter } from "next/navigation";
import {
  createNcrAction,
  findOpenNcrsForItemAction,
  draftNcrDescriptionAction,
  type CreateNcrState,
  type DraftNcrDescriptionState,
} from "@/lib/ncrs/actions";
import { NCR_SEVERITIES, type NcrSeverity } from "@/lib/ncrs/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import { FormField } from "@/components/ui/form-field";
import { Tx } from "@/components/domain/tx";
import { NextNumberHint } from "@/components/domain/next-number-hint";
import { useTranslate } from "@/lib/i18n/locale-context";

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
  const tl = useTranslate();
  const [state, formAction, pending] = useActionState(createNcrAction, initialState);
  const [photoError, setPhotoError] = useState<string | null>(null);
  // Photos are compressed in the browser first: the Server Action body is capped (~4 MB), and phone
  // originals are several MB each.
  async function submitWithCompressedPhotos(formData: FormData) {
    const tooBig = await compressFormPhotos(formData, ["photos"]);
    setPhotoError(tooBig);
    if (tooBig) return;
    formAction(formData);
  }
  // Idempotency key for this raise attempt; a fresh one is issued after each successful create.
  const [requestId, setRequestId] = useState("");
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- post-mount / external-event sync (hydration-safe default, then real value); not derivable during render
    setRequestId(crypto.randomUUID());
  }, [state.created?.id]);
  const [draftState, draftFormAction, draftPending] = useActionState(
    draftNcrDescriptionAction,
    initialDraftState
  );

  // Full-page form: the NCR exists but its punch item failed (action returned created + error instead
  // of redirecting). Go to the NCR with a visible warning banner rather than staying on the form.
  const router = useRouter();
  useEffect(() => {
    if (!onCreated && state.created && state.error) {
      router.replace(`/inspect/ncrs/${state.created.id}?warning=punch`);
    }
  }, [onCreated, state.created, state.error, router]);

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
    <form action={submitWithCompressedPhotos} className="mt-6 space-y-6">
      {onCreated && <input type="hidden" name="stay_on_page" value="true" />}
      <input type="hidden" name="request_id" value={requestId} />
      <input type="hidden" name="ai_log_id" value={aiLogId ?? ""} />
      <input type="hidden" name="ai_original_description" value={aiOriginalDescription ?? ""} />
      {itpItemId && <input type="hidden" name="itp_item_id" value={itpItemId} />}
      {inspectionRecordId && <input type="hidden" name="inspection_record_id" value={inspectionRecordId} />}
      {checklistItemId && <input type="hidden" name="checklist_item_id" value={checklistItemId} />}
      <section className="space-y-4">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted"><Tx>Details</Tx></h2>

        <div>
          <FormField label="Project" id="project_id" required error={state.fieldErrors?.project_id}>
          <select
            name="project_id"
            required
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy"
          >
            <option value=""><Tx>Select…</Tx></option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.project_number} — {p.name}
              </option>
            ))}
          </select>
          </FormField>
          <NextNumberHint kind="ncr" id={projectId} />
        </div>

        <fieldset>
          <legend className="block text-sm font-medium text-ink"><Tx>Severity</Tx></legend>
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
            {SEVERITY_HELP[severity]} <Tx>Default: due in</Tx> {DEFAULT_DAYS[severity]} <Tx>days.</Tx>
          </p>
        </fieldset>
      </section>

      <hr className="border-border" />

      <section className="space-y-4">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted"><Tx>Description</Tx></h2>

        <div className="rounded-md border border-border bg-off-white p-3">
          <label htmlFor="ai_notes" className="block text-sm font-medium text-ink">
            <Tx>Draft with AI (optional)</Tx>
          </label>
          <textarea
            id="ai_notes"
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={tl("Jot down factual notes — equipment, what was observed…")}
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
            <p className="mt-1.5 text-xs text-muted"><Tx>Select a project above first.</Tx></p>
          )}
          {!draftPending && projectId && !notes.trim() && (
            <p className="mt-1.5 text-xs text-muted"><Tx>Jot down some field notes above first.</Tx></p>
          )}
          {draftState.error && <p role="alert" className="mt-2 text-sm text-danger">{draftState.error}</p>}
          {aiOriginalDescription !== null && (
            <p className="mt-2">
              <Badge tone="info"><Tx>AI-assisted draft</Tx></Badge>
            </p>
          )}
        </div>

        <div>
          <FormField label="Description" id="description" required error={state.fieldErrors?.description}>
          <textarea
            name="description"
            required
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={tl("What was observed / not conforming…")}
            className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy"
          />
          </FormField>
        </div>

        <div>
          <FormField label="Requirement not met">
            <textarea
            name="requirement_not_met"
            rows={2}
            value={requirementNotMet}
            onChange={(e) => setRequirementNotMet(e.target.value)}
            placeholder={tl("Spec clause, drawing note, or ITP acceptance criteria not met…")}
            className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy"
          />
          </FormField>
        </div>
      </section>

      <hr className="border-border" />

      <section className="space-y-4">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted"><Tx>Assignment</Tx></h2>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="assigned_to" className="block text-sm font-medium text-ink">
              <Tx>Assigned to</Tx>
            </label>
            <select
              id="assigned_to"
              name="assigned_to"
              defaultValue=""
              disabled={!projectId}
              className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy disabled:opacity-60"
            >
              <option value=""><Tx>Unassigned</Tx></option>
              {(peopleByProject[projectId] ?? []).map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </select>
            {!projectId && <p className="mt-1 text-xs text-muted"><Tx>Select a project first.</Tx></p>}
          </div>
          <div>
            <FormField label="Due date" error={state.fieldErrors?.due_date}>
              <input
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
            </FormField>
          </div>
        </div>

        <div>
          <label htmlFor="responsible_party_id" className="block text-sm font-medium text-ink">
            <Tx>Responsible party</Tx> <span className="font-normal text-muted"><Tx>(optional)</Tx></span>
          </label>
          <select
            id="responsible_party_id"
            name="responsible_party_id"
            defaultValue=""
            disabled={!projectId}
            className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy disabled:opacity-60"
          >
            <option value=""><Tx>Not specified</Tx></option>
            {(partiesByProject[projectId] ?? []).map((party) => (
              <option key={party.id} value={party.id}>
                {party.name} ({party.party_type})
              </option>
            ))}
          </select>
          {!projectId && <p className="mt-1 text-xs text-muted"><Tx>Select a project first.</Tx></p>}
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor="location" className="block text-sm font-medium text-ink">
            <Tx>Location / area</Tx> <span className="font-normal text-muted"><Tx>(optional)</Tx></span>
          </label>
          <input id="location" name="location" maxLength={200} className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy" />
        </div>
        <div>
          <label htmlFor="equipment_tag" className="block text-sm font-medium text-ink">
            <Tx>Equipment tag</Tx> <span className="font-normal text-muted"><Tx>(optional)</Tx></span>
          </label>
          <input id="equipment_tag" name="equipment_tag" maxLength={200} className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy" />
        </div>
        <div>
          <label htmlFor="spec_reference" className="block text-sm font-medium text-ink">
            <Tx>Spec clause</Tx> <span className="font-normal text-muted"><Tx>(optional)</Tx></span>
          </label>
          <input id="spec_reference" name="spec_reference" maxLength={200} className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy" />
        </div>
      </section>

      <div>
        <label htmlFor="ncr_photos" className="block text-sm font-medium text-ink">
          <Tx>Photos</Tx> <span className="font-normal text-muted"><Tx>(optional, compressed automatically)</Tx></span>
        </label>
        <input
          id="ncr_photos"
          name="photos"
          type="file"
          accept="image/*"
          multiple
          className="mt-1 block w-full text-sm text-ink"
        />
      </div>

      {duplicates.length > 0 && (
        <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-ink">
          <p className="font-medium"><Tx>Open NCRs already exist on this activity</Tx></p>
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
          <p className="mt-1 text-xs text-muted"><Tx>Check it is not the same issue before raising another.</Tx></p>
        </div>
      )}

      {photoError && <p role="alert" className="text-sm text-danger">{photoError}</p>}
      {state.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}

      <Button type="submit" disabled={pending}>
        {pending ? "Raising…" : severity === "observation" ? "Raise Observation" : "Raise NCR"}
      </Button>
    </form>
  );
}
