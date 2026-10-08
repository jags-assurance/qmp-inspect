"use client";

import { useActionState, useEffect, useRef, useState, type PointerEvent } from "react";
import { addSignatureAction, type AddSignatureState } from "@/lib/standalone/actions";
import { enqueueOutboxItem } from "@/lib/offline/db";
import { notifyOutboxChanged } from "@/lib/offline/sync-client";
import { FormField } from "@/components/ui/form-field";
import { Tx } from "@/components/domain/tx";
import { useTranslate } from "@/lib/i18n/locale-context";

const initialState: AddSignatureState = { error: null };

/** Plain HTML5 canvas + pointer events — no signature-pad package needed for this. */
export function SignaturePad({ assignmentId }: { assignmentId: string }) {
  const tl = useTranslate();
  const [state, formAction, pending] = useActionState(addSignatureAction, initialState);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const [signatureData, setSignatureData] = useState("");
  const [hasDrawn, setHasDrawn] = useState(false);
  const [queued, setQueued] = useState(false);

  function pointerPos(e: PointerEvent<HTMLCanvasElement>) {
    const canvas = e.currentTarget;
    const rect = canvas.getBoundingClientRect();
    // The canvas is CSS-scaled (w-full) so map screen pixels to canvas pixels.
    const sx = rect.width ? canvas.width / rect.width : 1;
    const sy = rect.height ? canvas.height / rect.height : 1;
    return { x: (e.clientX - rect.left) * sx, y: (e.clientY - rect.top) * sy };
  }

  function handlePointerDown(e: PointerEvent<HTMLCanvasElement>) {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    drawingRef.current = true;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // not supported / pointer already released
    }
    const { x, y } = pointerPos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  }

  function handlePointerMove(e: PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const { x, y } = pointerPos(e);
    ctx.strokeStyle = "#1f1a17";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineTo(x, y);
    ctx.stroke();
    setHasDrawn(true);
  }

  function handlePointerUp() {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    const canvas = canvasRef.current;
    if (canvas) setSignatureData(canvas.toDataURL("image/png"));
  }

  // Clear the pad after a successful save so the same signature cannot be double-submitted.
  const wasPending = useRef(false);
  useEffect(() => {
    if (pending) {
      wasPending.current = true;
    } else if (wasPending.current) {
      wasPending.current = false;
      if (!state.error) handleClear();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handleClear only touches refs/setters
  }, [pending]);

  function handleClear() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    setSignatureData("");
    setHasDrawn(false);
  }

  // Offline: keep the signature on this device and send it when the connection returns.
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    setQueued(false);
    if (navigator.onLine) return;
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const fields: Record<string, string> = { kind: "standalone_signature" };
    for (const [k, v] of form.entries()) if (typeof v === "string" && !k.startsWith("$ACTION")) fields[k] = v;
    if (!fields.signature_data || !fields.role?.trim() || !fields.signatory_name?.trim()) return;
    await enqueueOutboxItem({ kind: "standalone_signature", fields });
    notifyOutboxChanged();
    handleClear();
    setQueued(true);
  }

  return (
    <form action={formAction} onSubmit={onSubmit} className="mt-4 space-y-3 border-t border-border pt-4">
      <input type="hidden" name="assignment_id" value={assignmentId} />
      <input type="hidden" name="signature_data" value={signatureData} />

      <div className="grid grid-cols-2 gap-3">
        <div>
          <FormField label="Role">
            <input
            name="role"
            required
            placeholder={tl("e.g. Client witness")}
            className="mt-1 w-full rounded-md border border-border bg-off-white px-2 py-1.5 text-sm outline-none focus:border-burgundy"
          />
          </FormField>
        </div>
        <div>
          <FormField label="Signatory name">
            <input
            name="signatory_name"
            required
            className="mt-1 w-full rounded-md border border-border bg-off-white px-2 py-1.5 text-sm outline-none focus:border-burgundy"
          />
          </FormField>
        </div>
      </div>

      <div>
        <label className="block text-xs text-muted"><Tx>Signature</Tx></label>
        <canvas
          ref={canvasRef}
          width={400}
          height={120}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          className="mt-1 w-full touch-none rounded-md border border-border bg-off-white"
        />
        <button type="button" onClick={handleClear} className="mt-1 text-xs text-muted hover:text-ink">
          <Tx>Clear</Tx>
        </button>
      </div>

      {queued && <p className="text-sm text-muted"><Tx>Saved on this device — it will be sent when you&apos;re back online.</Tx></p>}
      {state.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}

      <button
        type="submit"
        disabled={pending || !hasDrawn}
        className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium hover:bg-off-white disabled:opacity-50"
      >
        {pending ? "Saving…" : "+ Add signature"}
      </button>
    </form>
  );
}
