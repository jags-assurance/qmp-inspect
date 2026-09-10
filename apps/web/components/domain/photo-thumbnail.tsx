"use client";

import { useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

/** Renders one inspection-evidence photo as a signed-URL thumbnail. Shared by the field upload view and the completed-record view. */
export function PhotoThumbnail({ storagePath, caption }: { storagePath: string; caption?: string | null }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const supabase = createSupabaseBrowserClient();
    supabase.storage
      .from("inspection-evidence")
      .createSignedUrl(storagePath, 3600)
      .then(({ data }) => {
        if (!cancelled) setUrl(data?.signedUrl ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, [storagePath]);

  return (
    <div className="aspect-square overflow-hidden rounded-md border border-border bg-off-white">
      {url && <img src={url} alt={caption ?? "Inspection evidence"} className="h-full w-full object-cover" />}
    </div>
  );
}
