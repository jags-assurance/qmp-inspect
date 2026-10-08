"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { extractScanCode } from "@/lib/scan/code";
import { Tx } from "@/components/domain/tx";

// Minimal typings: BarcodeDetector is not in every TypeScript DOM lib. No third-party library is
// used; browsers without the API (Safari, Firefox) get a clear message instead of a broken button.
interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
}
type BarcodeDetectorCtor = new (opts?: { formats?: string[] }) => BarcodeDetectorLike;

function getDetectorCtor(): BarcodeDetectorCtor | null {
  if (typeof window === "undefined") return null;
  const ctor = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
  return ctor ?? null;
}

/**
 * Camera scan for a barcode / QR code (register lookups, start-work search). Uses the browser's
 * BarcodeDetector API with the rear camera. Calls onCode with the cleaned code. When the API or the
 * camera is unavailable it explains so and the user types the code instead.
 */
export function BarcodeScanButton({
  onCode,
  label = "Scan",
  className = "",
}: {
  onCode: (code: string) => void;
  label?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);

  const stop = useCallback(() => {
    if (timerRef.current != null) window.clearInterval(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => stop, [stop]);

  async function start() {
    setMessage(null);
    const Ctor = getDetectorCtor();
    if (!Ctor || !navigator.mediaDevices?.getUserMedia) {
      setMessage("Camera scanning isn't supported in this browser. Use your phone's camera app to scan the QR code, or type the code.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      streamRef.current = stream;
      setOpen(true);
      // The <video> mounts on the next render.
      await new Promise((r) => setTimeout(r, 0));
      const video = videoRef.current;
      if (!video) {
        stop();
        setOpen(false);
        return;
      }
      video.srcObject = stream;
      await video.play().catch(() => undefined);
      const detector = new Ctor();
      let busy = false;
      timerRef.current = window.setInterval(async () => {
        if (busy || video.readyState < 2) return;
        busy = true;
        try {
          const found = await detector.detect(video);
          const code = found.length ? extractScanCode(found[0].rawValue) : "";
          if (code) {
            stop();
            setOpen(false);
            onCode(code);
          }
        } catch {
          // A failed frame is not fatal; try the next one.
        } finally {
          busy = false;
        }
      }, 300);
    } catch {
      stop();
      setOpen(false);
      setMessage("Could not open the camera. Allow camera access for this site, or type the code.");
    }
  }

  function cancel() {
    stop();
    setOpen(false);
  }

  return (
    <span className="inline-flex flex-col">
      <button
        type="button"
        onClick={open ? cancel : start}
        className={`min-h-10 rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-ink hover:bg-off-white ${className}`}
      >
        {open ? "Stop scanning" : label}
      </button>
      {message && (
        <span role="status" className="mt-1 max-w-xs text-xs text-muted">
          {message}
        </span>
      )}
      {open && (
        <span className="fixed inset-x-4 top-20 z-50 mx-auto block max-w-sm rounded-lg border border-border bg-surface p-3 shadow-lg">
          <video ref={videoRef} muted playsInline className="aspect-square w-full rounded-md bg-black object-cover" />
          <span className="mt-2 block text-center text-xs text-muted"><Tx>Point the camera at the barcode or QR code.</Tx></span>
          <button type="button" onClick={cancel} className="mt-2 w-full rounded-md border border-border px-3 py-2 text-sm">
            <Tx>Cancel</Tx>
          </button>
        </span>
      )}
    </span>
  );
}
