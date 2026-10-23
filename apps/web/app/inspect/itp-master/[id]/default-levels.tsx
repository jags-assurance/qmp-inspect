"use client";

import { useActionState } from "react";
import { setMasterDefaultLevelAction, type SetMasterDefaultLevelState } from "@/lib/itp-master/actions";
import { useKeepFormValues } from "@/lib/hooks/use-keep-form-values";

const initialState: SetMasterDefaultLevelState = { error: null };

const PARTY_TYPES: { type: string; label: string }[] = [
  { type: "client", label: "Client" },
  { type: "main_contractor", label: "Main contr." },
  { type: "subcontractor", label: "Subcontr." },
  { type: "tpi_lab", label: "TPI / Lab" },
];

const LEVELS: { code: string; label: string }[] = [
  { code: "H", label: "Hold" },
  { code: "W", label: "Witness" },
  { code: "R", label: "Review" },
  { code: "S", label: "Surveillance" },
];

function LevelSelect({
  templateId,
  masterItemId,
  partyType,
  label,
  current,
  editable,
}: {
  templateId: string;
  masterItemId: string;
  partyType: string;
  label: string;
  current: string;
  editable: boolean;
}) {
  const [state, formAction, pending] = useActionState(setMasterDefaultLevelAction, initialState);
  const keepValuesSubmit = useKeepFormValues(state, formAction);
  if (!editable) {
    return (
      <span className="text-xs text-muted">
        {label}: <span className="text-ink">{current || "—"}</span>
      </span>
    );
  }
  return (
    <form onSubmit={keepValuesSubmit} className="flex items-center gap-1">
      <input type="hidden" name="template_id" value={templateId} />
      <input type="hidden" name="master_item_id" value={masterItemId} />
      <input type="hidden" name="party_type" value={partyType} />
      <label className="flex items-center gap-1 text-xs text-muted">
        {label}
        <select
          name="intervention"
          defaultValue={current}
          disabled={pending}
          onChange={(e) => e.currentTarget.form?.requestSubmit()}
          className="rounded border border-border bg-surface px-1 py-0.5 text-xs text-ink"
        >
          <option value="">—</option>
          {LEVELS.map((l) => (
            <option key={l.code} value={l.code}>
              {l.code} · {l.label}
            </option>
          ))}
        </select>
      </label>
      {state.error && <span className="text-xs text-danger">{state.error}</span>}
    </form>
  );
}

/** Default sign-off level per party type for one master-template activity. */
export function DefaultLevels({
  templateId,
  masterItemId,
  defaults,
  editable,
}: {
  templateId: string;
  masterItemId: string;
  defaults: Record<string, string>;
  editable: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1">
      {PARTY_TYPES.map((p) => (
        <LevelSelect
          key={p.type}
          templateId={templateId}
          masterItemId={masterItemId}
          partyType={p.type}
          label={p.label}
          current={defaults[p.type] ?? ""}
          editable={editable}
        />
      ))}
    </div>
  );
}
