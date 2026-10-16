import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { untypedFrom } from "@/lib/supabase/untyped";
import { PageGuide } from "@/components/domain/page-guide";
import { SettingsBackLink } from "@/app/inspect/settings/settings-back-link";
import { formatDateTime } from "@/lib/dates/format";
import { fileNameOf, formatBytes, isImagePath, ORPHAN_BUCKET } from "@/lib/orphan-photos/logic";
import { OrphanPhotoControls } from "./orphan-photo-controls";
import { T } from "@/components/domain/t";
import { getTranslator } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Orphaned photos" };

interface FlagRow {
  storage_path: string;
  project_id: string;
  organization_id: string;
  inspection_record_id: string;
  size_bytes: number | null;
  object_created_at: string | null;
  status: "flagged" | "kept" | "removed";
  first_flagged_at: string;
  reviewed_at: string | null;
  review_note: string | null;
}

/**
 * Admin review of photos the worker flagged as orphaned: the file is in storage but no inspection photo
 * or document row points at it. Nothing is deleted automatically; an Admin keeps the file, records that it
 * was removed by hand, or deletes it here after a typed confirmation.
 */
export default async function OrphanPhotosPage() {
  const tl = await getTranslator();
  const session = await requireSession();
  if (!isAdminStaff(session)) redirect("/inspect?denied=1");

  const supabase = await createSupabaseServerClient();
  const { data, error } = await untypedFrom(supabase, "orphan_photo_flags")
    .select("storage_path, project_id, organization_id, inspection_record_id, size_bytes, object_created_at, status, first_flagged_at, reviewed_at, review_note")
    .order("first_flagged_at", { ascending: false })
    .limit(200)
    .returns<FlagRow[]>();
  const rows = data ?? [];
  const flagged = rows.filter((r) => r.status === "flagged");
  const reviewed = rows.filter((r) => r.status !== "flagged").slice(0, 30);

  const projectIds = [...new Set(rows.map((r) => r.project_id))];
  const recordIds = [...new Set(rows.map((r) => r.inspection_record_id))];
  const [projects, records] = await Promise.all([
    projectIds.length
      ? supabase.from("projects").select("id, name").in("id", projectIds).returns<{ id: string; name: string }[]>()
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    recordIds.length
      ? supabase.from("inspection_records").select("id, record_number").in("id", recordIds).returns<{ id: string; record_number: string }[]>()
      : Promise.resolve({ data: [] as { id: string; record_number: string }[] }),
  ]);
  const projectName = new Map((projects.data ?? []).map((p) => [p.id, p.name]));
  const recordNumber = new Map((records.data ?? []).map((r) => [r.id, r.record_number]));

  const previews = new Map<string, string>();
  await Promise.all(
    flagged.map(async (r) => {
      const { data: signed } = await supabase.storage.from(ORPHAN_BUCKET).createSignedUrl(r.storage_path, 600);
      if (signed?.signedUrl) previews.set(r.storage_path, signed.signedUrl);
    })
  );

  return (
    <div className="max-w-4xl">
      <SettingsBackLink />
      <PageHeader
        className="mt-2"
        title={<T>Orphaned photos</T>}
        guide={
        <PageGuide
          title={tl("Orphaned photos — how this works")}
          points={[
            "A photo upload can succeed while its record is never saved. The worker flags such files (older than 7 days, not linked to anything). It never deletes them itself.",
            "Keep stops the file being flagged again. Mark removed records that the file was deleted by hand.",
            "Remove file deletes the stored file for good. It needs a typed confirmation and is only allowed for a flagged file nothing refers to. Every decision is audited.",
          ]}
        />
        }
      />
      <p className="mt-1 text-sm text-muted"><T>Files in storage that no inspection photo or document points at.</T></p>

      {error && <p className="mt-6 rounded-md bg-warning/10 px-3 py-2 text-sm text-ink"><T>The orphan list is not available (the database update has not been applied).</T></p>}

      {!error && flagged.length === 0 && <p className="mt-6 text-sm text-muted"><T>Nothing is waiting for review.</T></p>}

      <div className="mt-6 space-y-4">
        {flagged.map((r) => {
          const url = previews.get(r.storage_path);
          return (
            <div key={r.storage_path} className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4 sm:flex-row">
              <div className="h-32 w-full shrink-0 overflow-hidden rounded-md border border-border bg-off-white sm:w-44">
                {url && isImagePath(r.storage_path) ? (
                  // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL, not optimisable
                  <img src={url} alt={`Preview of ${fileNameOf(r.storage_path)}`} className="h-full w-full object-cover" />
                ) : url ? (
                  <a href={url} target="_blank" rel="noreferrer" className="flex h-full items-center justify-center text-xs text-burgundy hover:underline"><T>Open file</T></a>
                ) : (
                  <span className="flex h-full items-center justify-center text-xs text-muted"><T>No preview</T></span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink" title={r.storage_path}>{fileNameOf(r.storage_path)}</p>
                <p className="mt-0.5 text-xs text-muted">
                  {projectName.get(r.project_id) ?? "Unknown project"} ·{" "}
                  <Link href={`/inspect/inspections/${r.inspection_record_id}`} className="text-burgundy hover:underline">
                    {recordNumber.get(r.inspection_record_id) ?? "Inspection record"}
                  </Link>{" "}
                  · {formatBytes(r.size_bytes)}
                </p>
                <p className="text-xs text-muted">
                  <T>Uploaded</T> {r.object_created_at ? formatDateTime(r.object_created_at, "UTC") : "unknown"} <T>UTC · flagged</T> {formatDateTime(r.first_flagged_at, "UTC")} <T>UTC</T>
                </p>
                <OrphanPhotoControls storagePath={r.storage_path} />
              </div>
            </div>
          );
        })}
      </div>

      {reviewed.length > 0 && (
        <section className="mt-10">
          <h2 className="text-sm font-semibold text-ink"><T>Recently reviewed</T></h2>
          <ul className="mt-2 divide-y divide-border rounded-lg border border-border bg-surface text-xs">
            {reviewed.map((r) => (
              <li key={r.storage_path} className="flex flex-wrap items-baseline justify-between gap-2 px-3 py-2">
                <span className="truncate text-ink" title={r.storage_path}>{fileNameOf(r.storage_path)}</span>
                <span className="text-muted">
                  {r.status === "kept" ? "Kept" : "Removed"}
                  {r.reviewed_at ? ` · ${formatDateTime(r.reviewed_at, "UTC")} UTC` : ""}
                  {r.review_note ? ` · ${r.review_note}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
