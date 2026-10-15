"use client";

import { MarkupFileInput } from "@/components/domain/photo-markup";
import { useActionState, useEffect, useRef, useState } from "react";
import { compressFormPhotos } from "@/lib/media/compress-form-photos";
import { addPunchItemAction, type AddPunchItemState } from "@/lib/punch-list/actions";
import { Button } from "@/components/ui/button";
import { StickyActionBar } from "@/components/ui/sticky-action-bar";
import { FormField } from "@/components/ui/form-field";
import { Tx } from "@/components/domain/tx";
import { useTranslate } from "@/lib/i18n/locale-context";

const initialState: AddPunchItemState = { error: null };

export function AddPunchItemForm({
  projectId,
  projectParties,
}: {
  projectId: string;
  projectParties: { id: string; name: string }[];
}) {
  const tl = useTranslate();
  const [state, formAction, pending] = useActionState(addPunchItemAction, initialState);
  const formRef = useRef<HTMLFormElement>(null);
  // Idempotency key per attempt: a double tap or a refresh-resubmit cannot add the item twice.
  const [requestId, setRequestId] = useState("");
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- post-mount / external-event sync (hydration-safe default, then real value); not derivable during render
    setRequestId(crypto.randomUUID());
  }, []);
  // Reset the fields and issue a fresh key after a successful add.
  useEffect(() => {
    if (state.added) {
      formRef.current?.reset();
      // eslint-disable-next-line react-hooks/set-state-in-effect -- post-mount / external-event sync (hydration-safe default, then real value); not derivable during render
      setRequestId(crypto.randomUUID());
      setConfirmed(true);
      const t = setTimeout(() => setConfirmed(false), 4000);
      return () => clearTimeout(t);
    }
  }, [state]);

  async function submit(formData: FormData) {
    const tooBig = await compressFormPhotos(formData, ["photos"]);
    setPhotoError(tooBig);
    if (tooBig) return;
    formAction(formData);
  }

  return (
    <form ref={formRef} action={submit} encType="multipart/form-data" className="grid grid-cols-1 items-end gap-4 rounded-lg border border-border bg-surface p-4 shadow-xs sm:p-5 md:grid-cols-2">
      <input type="hidden" name="project_id" value={projectId} />
      <input type="hidden" name="request_id" value={requestId} />

      <div className="min-w-0 md:col-span-2">
        <FormField label="Description" error={state.fieldErrors?.description}>
          <input
          name="description"
          required
          placeholder={tl("What needs fixing before handover…")}
          className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
        />
        </FormField>
      </div>

      <div className="min-w-0">
        <FormField label="Location" error={state.fieldErrors?.location}>
          <input
          name="location"
          className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
        />
        </FormField>
      </div>

      <div className="min-w-0">
        <FormField label="Responsible party" error={state.fieldErrors?.responsible_party_id}>
          <select
          name="responsible_party_id"
          defaultValue=""
          className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
        >
          <option value=""><Tx>Unassigned</Tx></option>
          {projectParties.map((party) => (
            <option key={party.id} value={party.id}>
              {party.name}
            </option>
          ))}
        </select>
        </FormField>
      </div>

      <div className="min-w-0">
        <FormField label="Due date" error={state.fieldErrors?.due_date}>
          <input
          name="due_date"
          type="date"
          className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
        />
        </FormField>
      </div>

      <div className="min-w-0">
        <FormField label="Priority">
          <select
          name="priority"
          defaultValue="B"
          className="mt-1 min-h-11 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
        >
          <option value="A"><Tx>A - critical</Tx></option>
          <option value="B"><Tx>B - major</Tx></option>
          <option value="C"><Tx>C - minor</Tx></option>
        </select>
        </FormField>
      </div>

      <div className="min-w-0">
        <label htmlFor="photos" className="block text-xs font-medium text-ink">
          <Tx>Photo (optional)</Tx>
        </label>
        <MarkupFileInput
          id="photos"
          name="photos"
          
          accept="image/jpeg,image/png,image/webp,image/heic"
          capture="environment"
          multiple
          className="mt-1 w-full text-xs"
        />
      </div>

      <StickyActionBar className="md:col-span-2">
        <Button type="submit" disabled={pending}>
        {pending ? "Adding…" : "+ Add punch item"}
      </Button>
      </StickyActionBar>

      {photoError && <p role="alert" className="md:col-span-2 text-sm text-danger">{photoError}</p>}
      {state.error && <p role="alert" className="md:col-span-2 text-sm text-danger">{state.error}</p>}
      {confirmed && <p role="status" className="md:col-span-2 text-sm text-success"><Tx>Punch item added.</Tx></p>}
    </form>
  );
}
