"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import { Button } from "@/components/ui/button";
import { Tx } from "@/components/domain/tx";

type Point = { x: number; y: number };

/**
 * Plain HTML5 canvas + pointer events signature pad (no dependency). The canvas fills the width of its
 * container at a fixed height (taller on phones), is scaled for devicePixelRatio so strokes stay crisp,
 * and keeps its strokes as vectors so a resize / rotation redraws them instead of wiping the signature.
 * Reports the signature as a PNG data URL via onChange; onChange(null) means "cleared / nothing left".
 */
export function SignaturePad({ onChange }: { onChange: (dataUrl: string | null) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const strokes = useRef<Point[][]>([]);
  const current = useRef<Point[] | null>(null);
  const [strokeCount, setStrokeCount] = useState(0);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#1a1a1a";
    for (const stroke of strokes.current) {
      if (stroke.length === 0) continue;
      ctx.beginPath();
      ctx.moveTo(stroke[0].x, stroke[0].y);
      if (stroke.length === 1) ctx.lineTo(stroke[0].x + 0.01, stroke[0].y);
      for (const p of stroke.slice(1)) ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }
  }, []);

  // Keep the bitmap in step with the CSS size (and the device pixel ratio).
  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const fit = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      if (!w || !h) return;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      redraw();
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [redraw]);

  function emit() {
    const canvas = canvasRef.current;
    if (!canvas || strokes.current.length === 0) onChange(null);
    else onChange(canvas.toDataURL("image/png"));
  }

  function pointerPos(e: PointerEvent<HTMLCanvasElement>): Point {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function handlePointerDown(e: PointerEvent<HTMLCanvasElement>) {
    const p = pointerPos(e);
    current.current = [p];
    strokes.current.push(current.current);
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // pointer already released
    }
  }

  function handlePointerMove(e: PointerEvent<HTMLCanvasElement>) {
    const stroke = current.current;
    const ctx = canvasRef.current?.getContext("2d");
    if (!stroke || !ctx) return;
    const prev = stroke[stroke.length - 1];
    const p = pointerPos(e);
    stroke.push(p);
    ctx.beginPath();
    ctx.moveTo(prev.x, prev.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    if (strokeCount === 0) setStrokeCount(1);
  }

  function handlePointerUp() {
    if (!current.current) return;
    current.current = null;
    setStrokeCount(strokes.current.length);
    emit();
  }

  function handleUndo() {
    strokes.current.pop();
    setStrokeCount(strokes.current.length);
    redraw();
    emit();
  }

  function handleClear() {
    strokes.current = [];
    setStrokeCount(0);
    redraw();
    onChange(null);
  }

  return (
    <div>
      <div ref={wrapRef} className="relative h-[200px] w-full overflow-hidden rounded-md border-2 border-control-border bg-surface sm:h-[160px]">
        {strokeCount === 0 && (
          <span aria-hidden="true" className="pointer-events-none absolute inset-0 flex items-center justify-center text-lg text-muted/60 select-none">
            <Tx>Sign here</Tx>
          </span>
        )}
        <span aria-hidden="true" className="pointer-events-none absolute inset-x-4 bottom-8 border-b border-dashed border-border-strong" />
        <canvas
          ref={canvasRef}
          style={{ touchAction: "none" }}
          className="absolute inset-0 h-full w-full touch-none"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        />
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted"><Tx>Sign above with a finger, stylus, or mouse.</Tx></p>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" onClick={handleUndo} disabled={strokeCount === 0}>
            <Tx>Undo</Tx>
          </Button>
          <Button type="button" variant="outline" onClick={handleClear} disabled={strokeCount === 0}>
            <Tx>Clear</Tx>
          </Button>
        </div>
      </div>
    </div>
  );
}
