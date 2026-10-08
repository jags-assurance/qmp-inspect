"use client";

import { useActionState } from "react";
import { generateChecklistTemplatesAction, type GenerateChecklistsState } from "@/lib/checklists/actions";
import { Button } from "@/components/ui/button";
import { Tx } from "@/components/domain/tx";

const initialState: GenerateChecklistsState = { error: null };

export function GenerateChecklistsButton({ itpId }: { itpId: string }) {
  const [state, formAction, pending] = useActionState(generateChecklistTemplatesAction, initialState);

  return (
    <form action={formAction}>
      <input type="hidden" name="itp_id" value={itpId} />
      <Button type="submit" name="mode" value="ai" disabled={pending}>
        {pending ? "Generating…" : "Generate checklists with AI"}
      </Button>
      <p className="mt-2 text-xs text-muted">
        <Tx>AI-generated checklists are saved as drafts. Staff must review and confirm each one before inspections can start.</Tx>
      </p>
      {state.notice && (
        <p
          className={state.notice.tone === "warning" ? "mt-2 rounded-md border border-warning/50 bg-warning/10 px-3 py-2 text-sm text-ink" : "mt-2 text-sm text-ink"}
          role="status"
        >
          {state.notice.message}
        </p>
      )}
      {state.offerBlank && (
        <Button type="submit" name="mode" value="blank" variant="outline" className="mt-2" disabled={pending}>
          <Tx>Create blank checklists instead</Tx>
        </Button>
      )}
      {state.error && <p role="alert" className="mt-2 text-sm text-danger">{state.error}</p>}
    </form>
  );
}
