"use client";

import { useActionState } from "react";
import { requestHandoverCertificatePdfAction, type RequestCertificatePdfState } from "@/lib/handover/actions";
import { Button } from "@/components/ui/button";

const initialState: RequestCertificatePdfState = { error: null };

/** Staff-only: queues the Handover Certificate PDF when none exists yet (older certificates, or a failed render). */
export function CertificatePdfButton({ dataBookId, label = "Generate handover certificate PDF" }: { dataBookId: string; label?: string }) {
  const [state, formAction, pending] = useActionState(requestHandoverCertificatePdfAction, initialState);
  return (
    <form action={formAction} className="inline-flex items-center gap-2">
      <input type="hidden" name="data_book_id" value={dataBookId} />
      <Button type="submit" disabled={pending || state.success} variant="link">
        {pending ? "Queuing…" : state.success ? "Queued — refresh in a moment" : label}
      </Button>
      {state.error && <span className="text-xs text-danger">{state.error}</span>}
    </form>
  );
}
