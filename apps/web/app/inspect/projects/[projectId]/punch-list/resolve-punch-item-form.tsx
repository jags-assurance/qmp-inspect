"use client";

import { MarkupFileInput } from "@/components/domain/photo-markup";
import { useActionState, useState } from "react";
import { compressFormPhotos } from "@/lib/media/compress-form-photos";
import { resolvePunchItemAction, type ResolvePunchItemState } from "@/lib/punch-list/actions";
import { Button } from "@/components/ui/button";

const initialState: ResolvePunchItemState = { error: null };

/**
 * Step 1 of 2 — anyone with project access can mark their own fix resolved (evidence required,
 * enforced server-side). Distinct from VerifyClosePunchItemForm's step 2, which is independently
 * gated — see resolvePunchItemAction/closePunchItemAction in lib/punch-list/actions.ts for why this
 * is two steps now instead of one.
 */
export function ResolvePunchItemForm({ projectId, punchItemId }: { projectId: string; punchItemId: string }) {
  const [state, formAction, pending] = useActionState(resolvePunchItemAction, initialState);
  const [expanded, setExpanded] = useState(false);
  const [evidence, setEvidence] = useState("");
  const [photoError, setPhotoError] = useState<string | null>(null);

  async function submit(formData: FormData) {
    const tooBig = await compressFormPhotos(formData, ["closing_photos"]);
    const attached = formData.getAll("closing_photos").some((f) => typeof f !== "string" && f.size > 0);
    const message = tooBig ?? (attached ? null : "Attach at least one photo of the fix.");
    setPhotoError(message);
    if (message) return;
    formAction(formData);
  }

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="text-sm font-medium text-burgundy hover:underline"
      >
        Mark resolved
      </button>
    );
  }

  return (
    <form action={submit} encType="multipart/form-data" className="flex min-w-56 flex-col gap-2">
      <input type="hidden" name="punch_item_id" value={punchItemId} />
      <input type="hidden" name="project_id" value={projectId} />
      <textarea
        name="closing_evidence"
        required
        rows={2}
        value={evidence}
        onChange={(e) => setEvidence(e.target.value)}
        placeholder="What was done to fix it (reference photo/record)…"
        className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-xs outline-none focus:border-burgundy"
      />
      <label className="text-xs font-medium text-ink">
        Photos of the fix (required)
        <MarkupFileInput name="closing_photos"  accept="image/*" capture="environment" multiple required className="mt-1 w-full text-xs" />
      </label>
      {photoError && <p className="text-xs text-danger">{photoError}</p>}
      {state.error && <p className="text-xs text-danger">{state.error}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending || !evidence.trim()}>
          {pending ? "Submitting…" : "Confirm resolved"}
        </Button>
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-off-white"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
