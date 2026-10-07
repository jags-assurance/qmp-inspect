"use client";

import { useActionState } from "react";
import { requestHandoverCertificatePdfAction, type RequestCertificatePdfState } from "@/lib/handover/actions";

const initialState: RequestCertificatePdfState = { error: null };

/** Staff-only: queues the Handover Certificate PDF when none exists yet (older certificates, or a failed render). */
export function CertificatePdfButton({ dataBookId, label = "Generate handover certificate PDF" }: { dataBookId: string; label?: string }) {
  const [state, formAction, pending] = useActionState(requestHandoverCertificatePdfAction, initialState);
  return (
    <form action={formAction} className="inline-flex items-center gap-2">
      <input type="hidden" name="data_book_id" value={dataBookId} />
      <button type="submit" disabled={pending || state.success} className="text-burgundy hover:underline disabled:opacity-60">
        {pending ? "Queuing…" : state.success ? "Queued — refresh in a moment" : label}
      </button>
      {state.error && <span className="text-xs text-danger">{state.error}</span>}
    </form>
  );
}
