"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteInspectionPhotoAction, updateInspectionPhotoCaptionAction } from "@/lib/checklists/actions";

/**
 * Renders one inspection-evidence photo as a thumbnail from an ALREADY-RESOLVED signed URL — the
 * caller (a Server Component page) batches every photo's signed URL in one call via
 * lib/storage/signed-urls.ts's getSignedPhotoUrls and passes each one down, rather than this
 * component fetching its own signed URL client-side. A `null` url (still resolving upstream, or the
 * photo failed to sign) simply renders an empty frame instead of a broken image.
 *
 * With `photoId` + `editable`, tapping the thumbnail opens a full-size viewer with caption editing
 * and a confirmed delete (server actions enforce who may do this and only while the inspection is open).
 */
export function PhotoThumbnail({
  url,
  caption,
  photoId,
  editable = false,
}: {
  url: string | null;
  caption?: string | null;
  photoId?: string;
  editable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(caption ?? "");
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const interactive = !!photoId && editable;

  function saveCaption() {
    if (!photoId) return;
    setError(null);
    startTransition(async () => {
      const res = await updateInspectionPhotoCaptionAction(photoId, text);
      if (res.error) setError(res.error);
      else {
        setOpen(false);
        router.refresh();
      }
    });
  }

  function remove() {
    if (!photoId) return;
    setError(null);
    startTransition(async () => {
      const res = await deleteInspectionPhotoAction(photoId);
      if (res.error) {
        setError(res.error);
        setConfirming(false);
      } else {
        setOpen(false);
        router.refresh();
      }
    });
  }

  const frame = (
    <div className="aspect-square overflow-hidden rounded-md border border-border bg-off-white">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {url && <img src={url} alt={caption ?? "Inspection evidence"} className="h-full w-full object-cover" />}
    </div>
  );

  if (!interactive) {
    return (
      <div>
        {frame}
        {caption && <p className="mt-0.5 truncate text-[11px] text-muted">{caption}</p>}
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setText(caption ?? "");
          setConfirming(false);
          setError(null);
          setOpen(true);
        }}
        aria-label={caption ? `Photo: ${caption}. Open to edit or delete` : "Open photo to edit caption or delete"}
        className="block w-full text-left"
      >
        {frame}
        {caption && <p className="mt-0.5 truncate text-[11px] text-muted">{caption}</p>}
      </button>
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Photo details"
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget && !pending) setOpen(false);
          }}
        >
          <div className="max-h-[92vh] w-full overflow-y-auto rounded-t-xl bg-surface p-4 sm:max-w-lg sm:rounded-xl">
            {url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={url} alt={caption ?? "Inspection evidence"} className="max-h-[50vh] w-full rounded-md object-contain" />
            )}
            <label htmlFor={`photo-caption-${photoId}`} className="mt-3 block text-sm font-medium text-ink">
              Caption
            </label>
            <input
              id={`photo-caption-${photoId}`}
              value={text}
              maxLength={300}
              onChange={(e) => setText(e.target.value)}
              placeholder="What does this photo show?"
              className="mt-1 w-full rounded-md border border-border bg-off-white px-3 py-2 text-base outline-none focus:border-burgundy sm:text-sm"
            />
            {error && (
              <p role="alert" className="mt-2 text-sm text-danger">
                {error}
              </p>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={pending}
                onClick={saveCaption}
                className="min-h-11 flex-1 rounded-md bg-burgundy px-4 text-sm font-medium text-white disabled:opacity-60"
              >
                {pending && !confirming ? "Saving…" : "Save caption"}
              </button>
              {!confirming ? (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => setConfirming(true)}
                  className="min-h-11 rounded-md border border-danger px-4 text-sm font-medium text-danger disabled:opacity-60"
                >
                  Delete
                </button>
              ) : (
                <button
                  type="button"
                  disabled={pending}
                  onClick={remove}
                  className="min-h-11 rounded-md bg-danger px-4 text-sm font-medium text-white disabled:opacity-60"
                >
                  {pending ? "Deleting…" : "Confirm delete"}
                </button>
              )}
              <button
                type="button"
                disabled={pending}
                onClick={() => setOpen(false)}
                className="min-h-11 rounded-md border border-border px-4 text-sm font-medium text-ink"
              >
                Close
              </button>
            </div>
            {confirming && <p className="mt-2 text-xs text-muted">This permanently removes the photo from the evidence record.</p>}
          </div>
        </div>
      )}
    </>
  );
}
