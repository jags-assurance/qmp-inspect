"use client";

import { useActionState } from "react";
import { generateChecklistTemplatesAction, type GenerateChecklistsState } from "@/lib/checklists/actions";
import { Button } from "@/components/ui/button";

const initialState: GenerateChecklistsState = { error: null };

export function GenerateChecklistsButton({ itpId }: { itpId: string }) {
  const [state, formAction, pending] = useActionState(generateChecklistTemplatesAction, initialState);

  return (
    <form action={formAction}>
      <input type="hidden" name="itp_id" value={itpId} />
      <Button type="submit" disabled={pending}>
        {pending ? "Generating…" : "Generate checklists"}
      </Button>
      {state.error && <p className="mt-2 text-sm text-danger">{state.error}</p>}
    </form>
  );
}
