"use client";

import { useActionState } from "react";
import { signOffWalkdownAction, type SignOffWalkdownState } from "@/lib/punch-list/actions";
import { Button } from "@/components/ui/button";
import { useKeepFormValues } from "@/lib/hooks/use-keep-form-values";

export function SignOffWalkdownButton({ projectId, walkdownId }: { projectId: string; walkdownId: string }) {
  const [state, action, pending] = useActionState(signOffWalkdownAction, { error: null } as SignOffWalkdownState);
  const keepValuesSubmit_action = useKeepFormValues(state, action);
  return (
    <form onSubmit={keepValuesSubmit_action} className="flex items-center gap-2">
      <input type="hidden" name="project_id" value={projectId} />
      <input type="hidden" name="walkdown_id" value={walkdownId} />
      <Button type="submit" disabled={pending} variant="outline" size="sm">
        {pending ? "Signing…" : "Sign off"}
      </Button>
      {state.error && <span className="text-xs text-danger">{state.error}</span>}
    </form>
  );
}
