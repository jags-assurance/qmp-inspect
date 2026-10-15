"use client";

import { MarkupFileInput } from "@/components/domain/photo-markup";
import { useActionState, useState } from "react";
import { compressFormPhotos } from "@/lib/media/compress-form-photos";
import { resolvePunchItemAction, type ResolvePunchItemState } from "@/lib/punch-list/actions";
import { Button } from "@/components/ui/button";
import { StickyActionBar } from "@/components/ui/sticky-action-bar";
import { Tx } from "@/components/domain/tx";
import { useTranslate } from "@/lib/i18n/locale-context";

const initialState: ResolvePunchItemState = { error: null };

/**
 * Step 1 of 2 — anyone with project access can mark their own fix resolved (evidence required,
 * enforced server-side). Distinct from VerifyClosePunchItemForm's step 2, which is independently
 * gated — see resolvePunchItemAction/closePunchItemAction in lib/punch-list/actions.ts for why this
 * is two steps now instead of one.
 */
export function ResolvePunchItemForm({ projectId, punchItemId }: { projectId: string; punchItemId: string }) {
  const tl = useTranslate();
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
      <Button
        type="button"
        onClick={() => setExpanded(true)}
        variant="link"
      >
        <Tx>Mark resolved</Tx>
      </Button>
    );
  }

  return (
    <form action={submit} encType="multipart/form-data" className="grid gap-3 rounded-lg border border-border bg-surface p-4 shadow-xs sm:p-5 md:grid-cols-2">
      <input type="hidden" name="punch_item_id" value={punchItemId} />
      <input type="hidden" name="project_id" value={projectId} />
      <textarea
        name="closing_evidence"
        required
        rows={2}
        value={evidence}
        onChange={(e) => setEvidence(e.target.value)}
        placeholder={tl("What was done to fix it (reference photo/record)…")}
        className="w-full md:col-span-2 rounded-md border border-control-border bg-surface px-3 py-2 text-sm min-h-11"
      />
      <label className="text-xs font-medium text-ink md:col-span-2">
        <Tx>Photos of the fix (required)</Tx>
        <MarkupFileInput name="closing_photos"  accept="image/*" capture="environment" multiple required className="mt-1 w-full text-xs" />
      </label>
      {photoError && <p role="alert" className="text-sm text-danger md:col-span-2">{photoError}</p>}
      {state.error && <p role="alert" className="text-sm text-danger md:col-span-2">{state.error}</p>}
      <StickyActionBar inCard className="md:col-span-2">
        <Button type="submit" disabled={pending || !evidence.trim()}>
          {pending ? "Submitting…" : "Confirm resolved"}
        </Button>
        <Button
          type="button"
          onClick={() => setExpanded(false)}
          variant="outline"
        >
          <Tx>Cancel</Tx>
        </Button>
      </StickyActionBar>
    </form>
  );
}
