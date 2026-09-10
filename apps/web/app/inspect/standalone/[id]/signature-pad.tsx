"use client";

import { useActionState, useRef, useState, type PointerEvent } from "react";
import { addSignatureAction, type AddSignatureState } from "@/lib/standalone/actions";

const initialState: AddSignatureState = { error: null };

/** Plain HTML5 canvas + pointer events — no signature-pad package needed for this. */
export function SignaturePad({ assignmentId }: { assignmentId: string }) {
  const [state, formAction, pending] = useActionState(addSignatureAction, initialState);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const [signatureData, setSignatureData] = useState("");
  const [hasDrawn, setHasDrawn] = useState(false);

  function pointerPos(e: PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function handlePointerDown(e: PointerEvent<HTMLCanvasElement>) {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    drawingRef.current = true;
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

  function handleClear() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    setSignatureData("");
    setHasDrawn(false);
  }

  return (
    <form action={formAction} className="mt-4 space-y-3 border-t border-border pt-4">
      <input type="hidden" name="assignment_id" value={assignmentId} />
      <input type="hidden" name="signature_data" value={signatureData} />

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-muted">Role</label>
          <input
            name="role"
            required
            placeholder="e.g. Client witness"
            className="mt-1 w-full rounded-md border border-border bg-off-white px-2 py-1.5 text-sm outline-none focus:border-burgundy"
          />
        </div>
        <div>
          <label className="block text-xs text-muted">Signatory name</label>
          <input
            name="signatory_name"
            required
            className="mt-1 w-full rounded-md border border-border bg-off-white px-2 py-1.5 text-sm outline-none focus:border-burgundy"
          />
        </div>
      </div>

      <div>
        <label className="block text-xs text-muted">Signature</label>
        <canvas
          ref={canvasRef}
          width={400}
          height={120}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
          className="mt-1 w-full touch-none rounded-md border border-border bg-off-white"
        />
        <button type="button" onClick={handleClear} className="mt-1 text-xs text-muted hover:text-ink">
          Clear
        </button>
      </div>

      {state.error && <p className="text-sm text-danger">{state.error}</p>}

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
