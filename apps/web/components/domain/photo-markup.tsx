"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  MARKUP_COLORS,
  drawShapes,
  fitWithin,
  isMeaningfulShape,
  markedFileName,
  strokeWidthFor,
  type MarkupShape,
  type MarkupTool,
  type Pt,
} from "@/lib/media/markup";
import { Tx } from "@/components/domain/tx";
import { useTranslate } from "@/lib/i18n/locale-context";

type Outcome = { kind: "saved"; file: File } | { kind: "original" } | { kind: "cancel" };

/** Decodes with EXIF orientation applied where the browser supports it. */
async function loadBitmap(file: File): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void }> {
  if (typeof createImageBitmap === "function") {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
    } catch {
      // fall through to <img>
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => undefined };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function MarkupEditor({ file, onDone }: { file: File; onDone: (o: Outcome) => void }) {
  const tl = useTranslate();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const baseRef = useRef<HTMLCanvasElement | null>(null);
  const [shapes, setShapes] = useState<MarkupShape[]>([]);
  const [tool, setTool] = useState<MarkupTool>("pen");
  const [color, setColor] = useState<string>(MARKUP_COLORS[0]);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const draftRef = useRef<MarkupShape | null>(null);
  const sizeRef = useRef({ width: 0, height: 0, line: 4 });
  const shapesRef = useRef<MarkupShape[]>([]);

  const paint = useCallback((extra?: MarkupShape | null) => {
    const canvas = canvasRef.current;
    const base = baseRef.current;
    if (!canvas || !base) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(base, 0, 0);
    drawShapes(ctx, extra ? [...shapesRef.current, extra] : shapesRef.current, sizeRef.current.line);
  }, []);

  useEffect(() => {
    shapesRef.current = shapes;
    paint();
  }, [shapes, paint]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const bmp = await loadBitmap(file);
        if (cancelled) {
          bmp.close();
          return;
        }
        const fit = fitWithin(bmp.width, bmp.height);
        const base = document.createElement("canvas");
        base.width = fit.width;
        base.height = fit.height;
        base.getContext("2d")?.drawImage(bmp.source, 0, 0, fit.width, fit.height);
        bmp.close();
        baseRef.current = base;
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = fit.width;
        canvas.height = fit.height;
        sizeRef.current = { width: fit.width, height: fit.height, line: strokeWidthFor(fit.width, fit.height) };
        setReady(true);
        paint();
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [file, paint]);

  function toPoint(e: React.PointerEvent<HTMLCanvasElement>): Pt {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
    };
  }

  function onDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!ready) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = toPoint(e);
    draftRef.current = { tool, color, points: tool === "pen" ? [p] : [p, p] };
  }
  function onMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const draft = draftRef.current;
    if (!draft) return;
    const p = toPoint(e);
    if (draft.tool === "pen") draft.points.push(p);
    else draft.points[1] = p;
    paint(draft);
  }
  function onUp() {
    const draft = draftRef.current;
    draftRef.current = null;
    if (draft && isMeaningfulShape(draft)) setShapes((prev) => [...prev, draft]);
    else paint();
  }

  function save() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (shapes.length === 0) {
      onDone({ kind: "original" });
      return;
    }
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          onDone({ kind: "original" });
          return;
        }
        onDone({ kind: "saved", file: new File([blob], markedFileName(file.name), { type: "image/jpeg", lastModified: Date.now() }) });
      },
      "image/jpeg",
      0.85
    );
  }

  const toolBtn = (t: MarkupTool, label: string) => (
    <button
      type="button"
      onClick={() => setTool(t)}
      aria-pressed={tool === t}
      className={`min-h-10 rounded-md border px-3 py-1.5 text-sm ${tool === t ? "border-burgundy bg-burgundy/10 text-burgundy" : "border-border bg-surface text-ink"}`}
    >
      {label}
    </button>
  );

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-3" role="dialog" aria-modal="true" aria-label={tl("Mark up photo")}>
      <div className="flex max-h-full w-full max-w-3xl flex-col gap-2 rounded-lg bg-surface p-3">
        <div className="flex flex-wrap items-center gap-2">
          {toolBtn("pen", "Draw")}
          {toolBtn("arrow", "Arrow")}
          {toolBtn("circle", "Circle")}
          <span className="mx-1 flex items-center gap-1" role="group" aria-label={tl("Colour")}>
            {MARKUP_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Colour ${c}`}
                aria-pressed={color === c}
                onClick={() => setColor(c)}
                className={`h-8 w-8 rounded-full border-2 ${color === c ? "border-burgundy" : "border-border"}`}
                style={{ backgroundColor: c }}
              />
            ))}
          </span>
          <button
            type="button"
            disabled={shapes.length === 0}
            onClick={() => setShapes((prev) => prev.slice(0, -1))}
            className="min-h-10 rounded-md border border-border px-3 py-1.5 text-sm disabled:opacity-40"
          >
            <Tx>Undo</Tx>
          </button>
          <button
            type="button"
            disabled={shapes.length === 0}
            onClick={() => setShapes([])}
            className="min-h-10 rounded-md border border-border px-3 py-1.5 text-sm disabled:opacity-40"
          >
            <Tx>Clear</Tx>
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto rounded-md bg-black/5">
          {failed ? (
            <p className="p-6 text-sm text-danger"><Tx>This photo could not be opened for marking up. You can still use it as it is.</Tx></p>
          ) : (
            <canvas
              ref={canvasRef}
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerCancel={onUp}
              className="mx-auto block max-h-[65vh] w-full cursor-crosshair rounded-md object-contain"
              style={{ touchAction: "none" }}
            />
          )}
          {!ready && !failed && <p className="p-6 text-sm text-muted"><Tx>Loading photo…</Tx></p>}
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" onClick={() => onDone({ kind: "cancel" })} className="min-h-10 rounded-md border border-border px-4 py-2 text-sm">
            <Tx>Discard photo</Tx>
          </button>
          <button type="button" onClick={() => onDone({ kind: "original" })} className="min-h-10 rounded-md border border-border px-4 py-2 text-sm">
            <Tx>Use without marks</Tx>
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!ready}
            className="min-h-10 rounded-md bg-burgundy px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {shapes.length === 0 ? "Use photo" : "Save marked photo"}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Photo markup step: `markup(file)` opens the editor and resolves with the annotated JPEG, the
 * original file (the user skipped marking), or null (the user discarded the photo). Render `dialog`
 * once in the component. Nothing leaves the browser: the annotated copy is then uploaded like any
 * other photo.
 */
export function usePhotoMarkup() {
  const [current, setCurrent] = useState<{ file: File; resolve: (f: File | null) => void } | null>(null);

  const markup = useCallback(
    (file: File) =>
      new Promise<File | null>((resolve) => {
        setCurrent({ file, resolve });
      }),
    []
  );

  const dialog = current ? (
    <MarkupEditor
      key={`${current.file.name}-${current.file.lastModified}-${current.file.size}`}
      file={current.file}
      onDone={(o) => {
        const { resolve, file } = current;
        setCurrent(null);
        resolve(o.kind === "saved" ? o.file : o.kind === "original" ? file : null);
      }}
    />
  ) : null;

  return { markup, dialog };
}

export const MARKUP_PREF_KEY = "photo-markup-before-upload";

/** The per-device "mark up each photo before upload" preference, remembered in localStorage (a convenience only). */
export function useMarkupPreference() {
  const [markupFirst, setMarkupFirstState] = useState(false);
  useEffect(() => {
    try {
      // Hydration-safe: localStorage is only readable after mount.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMarkupFirstState(window.localStorage.getItem(MARKUP_PREF_KEY) === "1");
    } catch {
      // storage unavailable: leave it off
    }
  }, []);
  const setMarkupFirst = useCallback((on: boolean) => {
    setMarkupFirstState(on);
    try {
      window.localStorage.setItem(MARKUP_PREF_KEY, on ? "1" : "0");
    } catch {
      // ignore
    }
  }, []);
  return { markupFirst, setMarkupFirst };
}

/**
 * A file input for forms that submit their files with the form (server actions): when the preference is on,
 * each picked image goes through the markup editor first and the input's files are replaced with the marked
 * copies (a discarded photo is dropped). Pass the usual input attributes; `name` etc. are kept.
 */
export function MarkupFileInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const { markup, dialog } = usePhotoMarkup();
  const { markupFirst, setMarkupFirst } = useMarkupPreference();
  const { onChange, ...rest } = props;

  async function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const input = e.currentTarget;
    if (markupFirst && input.files && input.files.length > 0) {
      const picked = Array.from(input.files);
      const out: File[] = [];
      for (const f of picked) {
        if (!f.type.startsWith("image/") || f.type === "image/heic") {
          out.push(f); // not editable in the browser canvas: keep as is
          continue;
        }
        const marked = await markup(f);
        if (marked) out.push(marked);
      }
      try {
        const dt = new DataTransfer();
        out.forEach((f) => dt.items.add(f));
        input.files = dt.files;
      } catch {
        // DataTransfer unsupported: keep the originals
      }
    }
    onChange?.(e);
  }

  return (
    <>
      <label className="mb-1 flex items-center gap-2 text-xs text-muted">
        <input type="checkbox" checked={markupFirst} onChange={(e) => setMarkupFirst(e.target.checked)} />
        <Tx>Mark up each photo before adding</Tx>
      </label>
      <input {...rest} type="file" onChange={handleChange} />
      {dialog}
    </>
  );
}
