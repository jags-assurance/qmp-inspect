"use client";

import { useActionState } from "react";
import { signOffWalkdownAction, type SignOffWalkdownState } from "@/lib/punch-list/actions";

export function SignOffWalkdownButton({ projectId, walkdownId }: { projectId: string; walkdownId: string }) {
  const [state, action, pending] = useActionState(signOffWalkdownAction, { error: null } as SignOffWalkdownState);
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="project_id" value={projectId} />
      <input type="hidden" name="walkdown_id" value={walkdownId} />
      <button type="submit" disabled={pending} className="min-h-8 rounded border border-border px-2 py-1 text-xs font-medium hover:bg-off-white disabled:opacity-50">
        {pending ? "Signing…" : "Sign off"}
      </button>
      {state.error && <span className="text-xs text-danger">{state.error}</span>}
    </form>
  );
}
