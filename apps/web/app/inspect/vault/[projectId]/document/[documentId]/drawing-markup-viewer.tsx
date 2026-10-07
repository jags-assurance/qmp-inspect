"use client";

import { useEffect, useState, type KeyboardEvent, type MouseEvent } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { createDrawingMarkupAction } from "@/lib/drawing-markups/actions";
import { DRAWING_MARKUP_TYPE_LABELS, type DrawingMarkupRow, type DrawingMarkupType } from "@/lib/drawing-markups/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"];

/**
 * Every manually-uploaded vault document lives in the "inspection-evidence" bucket with a bare
 * storage_path. Worker-auto-filed documents (ITP/NCR/Inspection Report PDFs — see
 * worker/src/jobs/vaultAutoFile.ts) live in the separate "generated-documents" bucket instead, so
 * their storage_path is prefixed "generated-documents:<path>". Parsed here so both kinds resolve
 * to the right bucket; the prefix is stripped from the path before use.
 */
function resolveStorageLocation(storagePath: string): { bucket: string; path: string } {
  const prefixMatch = /^([a-z0-9_-]+):(.+)$/i.exec(storagePath);
  if (prefixMatch && prefixMatch[1] === "generated-documents") {
    return { bucket: prefixMatch[1], path: prefixMatch[2] };
  }
  return { bucket: "inspection-evidence", path: storagePath };
}

function fileExtension(storagePath: string): string {
  const { path } = resolveStorageLocation(storagePath);
  const match = /\.([a-z0-9]+)$/i.exec(path);
  return match ? match[1].toLowerCase() : "";
}

interface NcrOption {
  id: string;
  label: string;
}

/**
 * Pin-drop markup overlay for a vault drawing/plan document (Round-table finding — see this
 * folder's page.tsx). Click a point on the rendered image to drop a labeled pin, positioned via
 * fractional x/y (0-1) so it stays correctly placed at any render size. Existing pins render as
 * absolute-positioned markers on top of the image; clicking one shows its label/linked NCR.
 *
 * Scope-down (reported, not silent): this only supports image documents. Rendering a PDF page to a
 * pixel surface needs a client-side PDF rasterizer (e.g. pdfjs-dist), and this codebase has no PDF
 * rendering library today (only server-side `pdf-parse`, for text extraction) — adding one was out
 * of scope for this pass. A PDF drawing still opens via the signed link below; pin-drop is disabled
 * for it with an explicit note rather than faked with an iframe overlay (browsers don't expose
 * reliable click coordinates on their native PDF viewer surface).
 */
export function DrawingMarkupViewer({
  projectId,
  documentId,
  storagePath,
  markups,
  ncrOptions,
}: {
  projectId: string;
  documentId: string;
  storagePath: string;
  markups: DrawingMarkupRow[];
  ncrOptions: NcrOption[];
}) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [pendingPin, setPendingPin] = useState<{ x: number; y: number } | null>(null);
  const [selectedMarkup, setSelectedMarkup] = useState<DrawingMarkupRow | null>(null);
  const [label, setLabel] = useState("");
  const [markupType, setMarkupType] = useState<DrawingMarkupType>("note");
  const [linkedNcrId, setLinkedNcrId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isImage = IMAGE_EXTENSIONS.includes(fileExtension(storagePath));

  useEffect(() => {
    let cancelled = false;
    const supabase = createSupabaseBrowserClient();
    const { bucket, path } = resolveStorageLocation(storagePath);
    supabase.storage
      .from(bucket)
      .createSignedUrl(path, 3600)
      .then(({ data }) => {
        if (!cancelled) setSignedUrl(data?.signedUrl ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, [storagePath]);

  function handleImageClick(e: MouseEvent<HTMLImageElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    setSelectedMarkup(null);
    setPendingPin({ x, y });
    setLabel("");
    setMarkupType("note");
    setLinkedNcrId("");
    setError(null);
  }

  function startPin(x: number, y: number) {
    setSelectedMarkup(null);
    setPendingPin({ x, y });
    setLabel("");
    setMarkupType("note");
    setLinkedNcrId("");
    setError(null);
  }

  // Keyboard path (no pointer): Enter/Space drops a pin at the centre, arrow keys nudge the pending
  // pin (Shift = bigger steps), Escape cancels it. The label form is then reached with Tab.
  function handleDrawingKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.target !== e.currentTarget) return;
    const step = e.shiftKey ? 0.1 : 0.02;
    const move: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    if (e.key in move) {
      e.preventDefault();
      const [dx, dy] = move[e.key];
      const base = pendingPin ?? { x: 0.5, y: 0.5 };
      startPinAt(Math.min(1, Math.max(0, base.x + dx)), Math.min(1, Math.max(0, base.y + dy)), !pendingPin);
    } else if ((e.key === "Enter" || e.key === " ") && !pendingPin) {
      e.preventDefault();
      startPin(0.5, 0.5);
    } else if (e.key === "Escape" && pendingPin) {
      e.preventDefault();
      setPendingPin(null);
    }
  }

  function startPinAt(x: number, y: number, fresh: boolean) {
    if (fresh) startPin(x, y);
    else setPendingPin({ x, y });
  }

  async function handleSavePin() {
    if (!pendingPin) return;
    if (!label.trim()) {
      setError("Enter a label for this pin.");
      return;
    }
    setSaving(true);
    setError(null);

    const formData = new FormData();
    formData.set("project_id", projectId);
    formData.set("vault_document_id", documentId);
    formData.set("x", String(pendingPin.x));
    formData.set("y", String(pendingPin.y));
    formData.set("label", label.trim());
    formData.set("markup_type", linkedNcrId ? "ncr" : markupType);
    if (linkedNcrId) formData.set("linked_entity_id", linkedNcrId);

    const result = await createDrawingMarkupAction({ error: null }, formData);
    setSaving(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setPendingPin(null);
    setLabel("");
    setLinkedNcrId("");
  }

  if (!isImage) {
    return (
      <div className="rounded-lg border border-border bg-surface p-4">
        {signedUrl && fileExtension(storagePath) === "pdf" && (
          <iframe src={signedUrl} title="Document preview" className="mb-3 h-[70vh] w-full rounded-md border border-border bg-off-white" />
        )}
        <p className="text-sm text-muted">
          {fileExtension(storagePath) === "pdf"
            ? "PDF preview above. Pin-drop markup is available for image drawings only."
            : `No in-browser preview for ${fileExtension(storagePath) || "this"} files (Word, Excel and similar open in their own app). Pin-drop markup is available for image drawings only.`}
        </p>
        {signedUrl && (
          <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <a href={signedUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center text-burgundy hover:underline sm:min-h-0">
              Open in new tab ↗
            </a>
            <a href={signedUrl} download className="inline-flex min-h-11 items-center text-burgundy hover:underline sm:min-h-0">
              Download
            </a>
          </p>
        )}
        {markups.length > 0 && (
          <div className="mt-4">
            <h2 className="text-sm font-semibold text-ink">Pins on this document</h2>
            <ul className="mt-2 space-y-1 text-sm text-ink">
              {markups.map((m) => (
                <li key={m.id}>
                  <Badge tone="neutral">{DRAWING_MARKUP_TYPE_LABELS[m.markup_type]}</Badge> {m.label}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 lg:flex-row">
      <div
        tabIndex={0}
        role="group"
        aria-label="Drawing. Press Enter to place a pin at the centre, then use the arrow keys to move it (Shift for larger steps), then Tab to the label form. Escape cancels."
        onKeyDown={handleDrawingKeyDown}
        className="relative inline-block max-w-full rounded-lg border border-border bg-off-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-burgundy"
      >
        {signedUrl ? (
          <img
            src={signedUrl}
            alt="Drawing"
            onClick={handleImageClick}
            className="block max-w-full cursor-crosshair select-none"
          />
        ) : (
          <div className="flex h-64 w-96 items-center justify-center text-sm text-muted">Loading…</div>
        )}

        {markups.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setPendingPin(null);
              setSelectedMarkup(m);
            }}
            title={m.label}
            aria-label={`${DRAWING_MARKUP_TYPE_LABELS[m.markup_type]} pin: ${m.label}`}
            style={{ left: `${m.x * 100}%`, top: `${m.y * 100}%` }}
            className="absolute -translate-x-1/2 -translate-y-full text-xl leading-none drop-shadow"
          >
            📍
          </button>
        ))}

        {pendingPin && (
          <div
            style={{ left: `${pendingPin.x * 100}%`, top: `${pendingPin.y * 100}%` }}
            role="img"
            aria-label={`Pending pin at ${Math.round(pendingPin.x * 100)}% across, ${Math.round(pendingPin.y * 100)}% down`}
            className="absolute -translate-x-1/2 -translate-y-full text-xl leading-none text-burgundy drop-shadow"
          >
            📍
          </div>
        )}
      </div>

      <div className="w-full max-w-sm shrink-0 space-y-4">
        {pendingPin && (
          <div className="rounded-lg border border-border bg-surface p-4">
            <h2 className="text-sm font-semibold text-ink">+ Add pin</h2>
            <div className="mt-3">
              <label htmlFor="pin-label" className="block text-xs text-muted">
                Label
              </label>
              <input
                id="pin-label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. Hold point at this valve"
                className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy"
              />
            </div>
            <div className="mt-3">
              <label htmlFor="pin-ncr" className="block text-xs text-muted">
                Link to an NCR (optional)
              </label>
              <select
                id="pin-ncr"
                value={linkedNcrId}
                onChange={(e) => setLinkedNcrId(e.target.value)}
                className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy"
              >
                <option value="">— None —</option>
                {ncrOptions.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.label}
                  </option>
                ))}
              </select>
            </div>
            {!linkedNcrId && (
              <div className="mt-3">
                <label htmlFor="pin-type" className="block text-xs text-muted">
                  Type
                </label>
                <select
                  id="pin-type"
                  value={markupType}
                  onChange={(e) => setMarkupType(e.target.value as DrawingMarkupType)}
                  className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy"
                >
                  <option value="note">Note</option>
                  <option value="photo">Photo</option>
                </select>
              </div>
            )}
            <div role="alert">{error && <p className="mt-2 text-sm text-danger">{error}</p>}</div>
            <div className="mt-3 flex gap-2">
              <Button size="sm" onClick={handleSavePin} disabled={saving}>
                {saving ? "Saving…" : "Drop pin"}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setPendingPin(null)} disabled={saving}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {selectedMarkup && !pendingPin && (
          <div className="rounded-lg border border-border bg-surface p-4">
            <div className="flex items-center justify-between">
              <Badge tone="neutral">{DRAWING_MARKUP_TYPE_LABELS[selectedMarkup.markup_type]}</Badge>
              <button type="button" onClick={() => setSelectedMarkup(null)} className="text-xs text-muted hover:underline">
                Close
              </button>
            </div>
            <p className="mt-2 text-sm text-ink">{selectedMarkup.label}</p>
            {selectedMarkup.linked_entity_id && (
              <p className="mt-1 text-xs text-muted">
                Linked NCR:{" "}
                {ncrOptions.find((n) => n.id === selectedMarkup.linked_entity_id)?.label ?? selectedMarkup.linked_entity_id}
              </p>
            )}
            <p className="mt-1 text-xs text-muted">{new Date(selectedMarkup.created_at).toLocaleString("en-GB")}</p>
          </div>
        )}

        {!pendingPin && !selectedMarkup && (
          <p className="text-sm text-muted">
            Click a point on the drawing to drop a labeled pin. Keyboard: focus the drawing, press Enter, then use the arrow keys to position the pin.
          </p>
        )}

        {markups.length > 0 && (
          <div className="rounded-lg border border-border bg-surface p-4">
            <h2 className="text-sm font-semibold text-ink">All pins ({markups.length})</h2>
            <ul className="mt-2 space-y-1">
              {markups.map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setPendingPin(null);
                      setSelectedMarkup(m);
                    }}
                    className="text-sm text-ink hover:text-burgundy hover:underline"
                  >
                    {m.label}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
