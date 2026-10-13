"use client";

import { useRef, useState, type PointerEvent } from "react";
import { Button } from "@/components/ui/button";
import { Tx } from "@/components/domain/tx";

/**
 * Plain HTML5 canvas + pointer events signature pad — no external dependency, which is the right
 * call for a single capture surface like this rather than pulling in a signature-pad package.
 * Reports the captured signature as a PNG data URL via onChange; onChange(null) means "cleared".
 */
export function SignaturePad({ onChange }: { onChange: (dataUrl: string | null) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const strokeDrawn = useRef(false);
  const [hasStroke, setHasStroke] = useState(false);

  function getContext() {
    const canvas = canvasRef.current;
    return canvas?.getContext("2d") ?? null;
  }

  function pointerPos(e: PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function handlePointerDown(e: PointerEvent<HTMLCanvasElement>) {
    const ctx = getContext();
    if (!ctx) return;
    drawing.current = true;
    const { x, y } = pointerPos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    canvasRef.current?.setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const ctx = getContext();
    if (!ctx) return;
    const { x, y } = pointerPos(e);
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#1a1a1a";
    ctx.lineTo(x, y);
    ctx.stroke();
    strokeDrawn.current = true;
    if (!hasStroke) setHasStroke(true);
  }

  function handlePointerUp() {
    if (!drawing.current) return;
    drawing.current = false;
    const canvas = canvasRef.current;
    // strokeDrawn (a ref) rather than hasStroke: a fast stroke can end before the state update has re-rendered.
    if (canvas && strokeDrawn.current) onChange(canvas.toDataURL("image/png"));
  }

  function handleClear() {
    const canvas = canvasRef.current;
    const ctx = getContext();
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    strokeDrawn.current = false;
    setHasStroke(false);
    onChange(null);
  }

  return (
    <div>
      <canvas
        ref={canvasRef}
        width={480}
        height={160}
        className="w-full touch-none rounded-md border border-border bg-off-white"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      />
      <div className="mt-2 flex items-center justify-between">
        <p className="text-xs text-muted"><Tx>Sign above with a finger, stylus, or mouse.</Tx></p>
        <Button type="button" variant="outline" size="sm" onClick={handleClear}>
          <Tx>Clear</Tx>
        </Button>
      </div>
    </div>
  );
}
