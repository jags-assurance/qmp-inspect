"use client";

import { useActionState, useState } from "react";
import { Tx } from "@/components/domain/tx";
import { confirmationMatches } from "@/lib/projects/delete-helpers";
import type { DeletePreview, DeleteState } from "@/lib/projects/delete-actions";
import { Button } from "@/components/ui/button";
import { useKeepFormValues } from "@/lib/hooks/use-keep-form-values";

const initialState: DeleteState = { error: null };

/**
 * "Danger zone" delete for a project or an organisation (JAGS Admin only; the server re-checks everything).
 * Loads a preview of what would be removed on demand, then asks for the exact project number / name.
 */
export function DangerDelete({
  kind,
  id,
  confirmWord,
  loadPreview,
  action,
}: {
  kind: "project" | "organisation";
  id: string;
  /** What must be typed to confirm: the project number or the organisation name. */
  confirmWord: string;
  loadPreview: (id: string) => Promise<DeletePreview | null>;
  action: (prev: DeleteState, formData: FormData) => Promise<DeleteState>;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const keepValuesSubmit = useKeepFormValues(state, formAction);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<DeletePreview | null>(null);
  const [typed, setTyped] = useState("");
  const noun = kind === "project" ? "project" : "organisation";

  async function openPanel() {
    setOpen(true);
    setLoading(true);
    setPreview(await loadPreview(id).catch(() => null));
    setLoading(false);
  }

  return (
    <div className="mt-8 rounded-lg border border-danger/40 bg-surface p-5">
      <h2 className="font-medium text-danger"><Tx>Danger zone</Tx></h2>
      <p className="mt-1 text-sm text-muted">
        <Tx>Deleting permanently removes everything under it and cannot be undone. Only a JAGS Admin can do this.</Tx>
      </p>
      {!open ? (
        <Button type="button" onClick={() => void openPanel()} variant="danger-outline" size="sm" className="mt-3">
          {kind === "project" ? "Delete this project…" : "Delete this organisation…"}
        </Button>
      ) : (
        <form onSubmit={keepValuesSubmit} className="mt-3 max-w-lg space-y-3 text-sm">
          <input type="hidden" name={kind === "project" ? "project_id" : "organization_id"} value={id} />
          {loading && <p className="text-muted"><Tx>Checking what would be deleted…</Tx></p>}
          {!loading && !preview && <p className="text-danger"><Tx>Could not load the details. Reload the page and try again.</Tx></p>}
          {preview && (
            <>
              <p className="font-medium text-ink">{preview.label}</p>
              <p className="text-muted"><Tx>This would permanently delete:</Tx></p>
              <ul className="list-disc ps-5 text-ink">
                {preview.contents.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
              {preview.blockedReason ? (
                <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-danger">{preview.blockedReason}</p>
              ) : (
                <label className="block">
                  <span className="text-xs font-medium text-ink">
                    <Tx>Type</Tx> <span className="font-mono">{confirmWord}</span> <Tx>to confirm</Tx>
                  </span>
                  <input
                    name="confirm"
                    value={typed}
                    onChange={(e) => setTyped(e.target.value)}
                    autoComplete="off"
                    className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:border-danger"
                  />
                </label>
              )}
            </>
          )}
          {state.error && <p role="alert" className="text-danger">{state.error}</p>}
          <div className="flex gap-2">
            <Button
              type="submit"
              disabled={pending || !preview || !!preview.blockedReason || !confirmationMatches(typed, confirmWord)}
              variant="danger" size="sm"
            >
              {pending ? "Deleting…" : `Delete this ${noun} permanently`}
            </Button>
            <button type="button" onClick={() => { setOpen(false); setTyped(""); }} disabled={pending} className="rounded-md border border-border px-3 py-1.5">
              <Tx>Cancel</Tx>
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
