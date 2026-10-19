"use client";

import { useActionState, useState } from "react";
import { saveTermAction, type TermState } from "@/lib/terminology/actions";
import { previewSentence, validateTermForms, type TermForms, type TermKey } from "@/lib/terminology/terms";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Tx } from "@/components/domain/tx";

const initial: TermState = { error: null };
const INPUT = "mt-1 w-64 rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm outline-none focus:border-burgundy";

export function TermForm({
  termKey,
  description,
  defaults,
  current,
}: {
  termKey: TermKey;
  description: string;
  defaults: TermForms;
  current: TermForms | null;
}) {
  const [state, formAction, pending] = useActionState(saveTermAction, initial);
  const [singular, setSingular] = useState((current ?? defaults).singular);
  const [plural, setPlural] = useState((current ?? defaults).plural);

  // The live preview only uses the typed values once they are valid; otherwise it shows the default.
  const checked = validateTermForms(termKey, singular, plural);
  const previewForms: TermForms = checked.ok ? (checked.forms ?? defaults) : defaults;

  return (
    <form action={formAction} className="rounded-lg border border-border bg-surface p-4 shadow-xs sm:p-5">
      <input type="hidden" name="term_key" value={termKey} />
      <h2 className="text-sm font-semibold text-ink">
        {defaults.singular}{" "}
        <span className="font-normal text-muted">
          · <Tx>Default:</Tx> {defaults.singular} / {defaults.plural}
        </span>
      </h2>
      <p className="mt-1 text-xs text-muted">{description}</p>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <FormField label="Singular">
          <input name="singular" value={singular} onChange={(e) => setSingular(e.target.value)} required minLength={2} maxLength={40} className={INPUT} />
        </FormField>
        <FormField label="Plural" hint="Blank adds an s">
          <input name="plural" value={plural} onChange={(e) => setPlural(e.target.value)} maxLength={40} className={INPUT} />
        </FormField>
        <Button type="submit" name="intent" value="save" disabled={pending}>{pending ? "Saving…" : "Save"}</Button>
        <Button
          type="submit"
          name="intent"
          value="reset"
          variant="outline"
          disabled={pending}
          onClick={() => {
            setSingular(defaults.singular);
            setPlural(defaults.plural);
          }}
        >
          Reset to default
        </Button>
      </div>
      <p className="mt-3 rounded-md border border-border px-3 py-2 text-xs text-muted" aria-live="polite">
        <span className="font-medium text-ink"><Tx>Preview:</Tx></span> {previewSentence(termKey, previewForms)}
      </p>
      {!checked.ok && <p role="alert" className="mt-2 text-xs text-danger">{checked.error}</p>}
      {state.error && <p role="alert" className="mt-2 text-xs text-danger">{state.error}</p>}
      {!state.error && state.success && <p role="status" className="mt-2 text-xs text-muted">✓ {state.success}</p>}
    </form>
  );
}
