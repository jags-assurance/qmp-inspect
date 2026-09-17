"use client";

import { useActionState } from "react";
import { unenrollFactorAction, type MfaActionState } from "@/lib/auth/mfa-actions";

const initialState: MfaActionState = { error: null };

export function UnenrollFactorButton({ factorId }: { factorId: string }) {
  const [state, formAction, pending] = useActionState(unenrollFactorAction, initialState);

  return (
    <form action={formAction} className="inline">
      <input type="hidden" name="factor_id" value={factorId} />
      <button
        type="submit"
        disabled={pending}
        className="text-xs text-danger hover:underline disabled:opacity-50"
      >
        {pending ? "Removing…" : "Remove"}
      </button>
      {state.error && <span className="ml-2 text-xs text-danger">{state.error}</span>}
    </form>
  );
}
