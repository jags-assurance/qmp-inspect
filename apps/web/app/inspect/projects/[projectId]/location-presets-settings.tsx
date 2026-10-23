"use client";

import { useActionState, useState } from "react";
import { useAvailability } from "@/lib/hooks/use-availability";
import {
  addLocationPresetAction,
  removeLocationPresetAction,
  type AddLocationPresetState,
  type RemoveLocationPresetState,
} from "@/lib/checklists/location-presets-actions";
import { Tx } from "@/components/domain/tx";
import { useTranslate } from "@/lib/i18n/locale-context";
import { Button } from "@/components/ui/button";
import { useKeepFormValues } from "@/lib/hooks/use-keep-form-values";

const initialAddState: AddLocationPresetState = { error: null };
const initialRemoveState: RemoveLocationPresetState = { error: null };

/**
 * Manages this project's preset location list (lib/checklists/location-presets.ts) — shown as a
 * <select> alongside the free-text field on the "Start inspection" form, so field inspectors pick a
 * known site zone/block instead of retyping it every time. project_id is always set on rows added
 * here (this is the project-scoped list, not the org-wide default — there's no UI for the org default
 * yet, matching how notice_period_configs' own project-override-only UI works today).
 */
export function LocationPresetsSettings({
  organizationId,
  projectId,
  presets,
}: {
  organizationId: string;
  projectId: string;
  presets: { id: string; name: string }[];
}) {
  const tl = useTranslate();
  const [addState, addAction, addPending] = useActionState(addLocationPresetAction, initialAddState);
  const [newName, setNewName] = useState("");
  const nameCheck = useAvailability("location_name", newName, { projectId });
  // The input is controlled so a failed add keeps what was typed; clear it once an add succeeds.
  const [seenAddState, setSeenAddState] = useState(addState);
  if (addState !== seenAddState) {
    setSeenAddState(addState);
    if (!addState.error) setNewName("");
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-5">
      <h2 className="font-medium text-ink"><Tx>Preset inspection locations</Tx></h2>
      <p className="mt-1 text-sm text-muted">
        <Tx>Zones inspectors can pick when starting an inspection.</Tx>
      </p>

      {presets.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2">
          {presets.map((p) => (
            <PresetPill key={p.id} organizationId={organizationId} projectId={projectId} presetId={p.id} name={p.name} />
          ))}
        </ul>
      )}

      <form action={addAction} className="mt-3 flex flex-wrap items-center gap-2">
        <input type="hidden" name="organization_id" value={organizationId} />
        <input type="hidden" name="project_id" value={projectId} />
        <input
          name="name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder={tl("e.g. Block C, Level 2")}
          required
          aria-invalid={nameCheck.message ? true : undefined}
          className="w-full sm:min-w-56 rounded-md border border-border bg-off-white px-2.5 py-1.5 text-sm"
        />
        <Button
          type="submit"
          disabled={addPending}
          variant="outline" size="sm"
        >
          {addPending ? "Adding…" : "+ Add location"}
        </Button>
      </form>
      {(nameCheck.message ?? addState.error) && <p role="alert" className="mt-2 text-sm text-danger">{nameCheck.message ?? addState.error}</p>}
    </div>
  );
}

function PresetPill({
  organizationId,
  projectId,
  presetId,
  name,
}: {
  organizationId: string;
  projectId: string;
  presetId: string;
  name: string;
}) {
  const [state, action, pending] = useActionState(removeLocationPresetAction, initialRemoveState);
  const keepValuesSubmit_action = useKeepFormValues(state, action);
  return (
    <li>
      <form onSubmit={keepValuesSubmit_action} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-off-white px-3 py-1 text-xs">
        <input type="hidden" name="organization_id" value={organizationId} />
        <input type="hidden" name="project_id" value={projectId} />
        <input type="hidden" name="preset_id" value={presetId} />
        <span>{name}</span>
        <button type="submit" disabled={pending} aria-label={`Remove ${name}`} className="text-muted hover:text-danger disabled:opacity-50">
          ×
        </button>
      </form>
      {state.error && <p role="alert" className="text-xs text-danger">{state.error}</p>}
    </li>
  );
}
