import { NextRequest, NextResponse } from "next/server";
import { Readable } from "node:stream";
import { createHash } from "node:crypto";
import { ZipArchive } from "archiver";
import { requireSession } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { VAULT_FOLDERS_TABLE, VAULT_DOCUMENTS_TABLE } from "@/lib/vault/types";
import { buildManifestCsv, sanitizeZipSegment, type ManifestRow } from "@/lib/vault/zip-helpers";

export const runtime = "nodejs";
// A big project's pack is hundreds of files: allow the function to run for the platform maximum
// instead of the short default (a truncated zip with HTTP 200 was the failure mode).
export const maxDuration = 300;

interface FolderRow {
  id: string;
  name: string;
}

interface DocumentRow {
  id: string;
  folder_id: string;
  title: string;
  document_number: string | null;
  revision: string;
  storage_path: string;
  status: string;
}

/** How many files are signed + fetched ahead of the one being written into the zip. */
const PREFETCH = 4;
const SIGN_BATCH = 100;

/**
 * Every manually-uploaded vault document lives in the "inspection-evidence" bucket with a bare
 * storage_path; worker-auto-filed documents (worker/src/jobs/vaultAutoFile.ts) are prefixed
 * "generated-documents:<path>" since they're rendered into a separate bucket. Same parsing as
 * drawing-markup-viewer.tsx (the single-document viewer) — kept in sync with it deliberately.
 */
function resolveStorageLocation(storagePath: string): { bucket: string; path: string } {
  const prefixMatch = /^([a-z0-9_-]+):(.+)$/i.exec(storagePath);
  if (prefixMatch && prefixMatch[1] === "generated-documents") {
    return { bucket: prefixMatch[1], path: prefixMatch[2] };
  }
  return { bucket: "inspection-evidence", path: storagePath };
}

/**
 * Bundles every current (non-superseded) document in a project's Document Vault into a single zip,
 * one folder per vault category (e.g. "ITPs (Approved)/GSP-ITP-007 — rev0.pdf"), streamed rather
 * than buffered so a large project's worth of files never sits fully in memory at once. The zip ends
 * with MANIFEST.csv (path, title, number, revision, status, size, SHA-256 of every file) so the
 * recipient can verify the pack, and any file that could not be included is listed in
 * _NOT_INCLUDED.txt together with the reason (a pack that stops early says so).
 *
 * Access control: deliberately reuses the exact same RLS-scoped query pattern the vault pages
 * themselves use (createSupabaseServerClient() from the caller's own session, `has_org_access`
 * enforced by vault_folders_select/vault_documents_select) — this route can only ever see and zip
 * documents the requesting session could already see one at a time in the UI.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const session = await requireSession();
  const { projectId } = await params;
  // ?ids=a,b,c : an explicit selection from the folder table (still RLS-scoped to this project's
  // folders). Selected documents may be any status except rejected; unapproved ones are flagged in
  // the file name so a draft can't be mistaken for a controlled copy.
  const idsParam = request.nextUrl.searchParams.get("ids");
  const selectedIds = idsParam
    ? idsParam.split(",").map((s) => s.trim()).filter((s) => /^[0-9a-f-]{36}$/i.test(s)).slice(0, 200)
    : null;
  if (idsParam && (!selectedIds || selectedIds.length === 0)) {
    return NextResponse.json({ error: "No valid documents were selected." }, { status: 400 });
  }
  const supabase = await createSupabaseServerClient();

  const { data: folders, error: foldersError } = await supabase
    .from(VAULT_FOLDERS_TABLE)
    .select("id, name")
    .eq("project_id", projectId)
    .returns<FolderRow[]>();

  if (foldersError) {
    return NextResponse.json({ error: "Could not load this project's vault folders." }, { status: 500 });
  }

  const folderIds = (folders ?? []).map((f) => f.id);
  if (folderIds.length === 0) {
    return NextResponse.json({ error: "No vault folders found for this project." }, { status: 404 });
  }

  // Paged: a single PostgREST response is capped at 1000 rows, which silently dropped documents from big projects.
  let documents: DocumentRow[];
  try {
    documents = await fetchAll<DocumentRow>((from, to) => {
      let q = supabase
        .from(VAULT_DOCUMENTS_TABLE)
        .select("id, folder_id, title, document_number, revision, storage_path, status")
        .in("folder_id", folderIds);
      // Whole-project pack: approved, current documents only — a handover pack must not include drafts.
      // Non-staff roles only ever receive approved documents, even when ids are given explicitly:
      // for_review / superseded (including voided IRN certificates) / rejected are excluded for them.
      q = selectedIds
        ? session.isJagsStaff
          ? q.in("id", selectedIds).neq("status", "rejected")
          : q.in("id", selectedIds).eq("status", "approved")
        : q.eq("status", "approved");
      return q.order("id").range(from, to).returns<DocumentRow[]>();
    });
  } catch {
    return NextResponse.json({ error: "Could not load this project's vault documents." }, { status: 500 });
  }

  if (documents.length === 0) {
    if (selectedIds && !session.isJagsStaff) {
      return NextResponse.json(
        { error: "None of the selected documents are approved, so none can be downloaded." },
        { status: 403 }
      );
    }
    return NextResponse.json({ error: "This project's vault has no documents to download yet." }, { status: 404 });
  }

  // Selected ids that did not come back (not approved for a non-staff caller, rejected, or not
  // visible) are reported rather than silently dropped.
  const returnedIds = new Set(documents.map((d) => d.id));
  const preSkippedCount = selectedIds ? selectedIds.filter((id) => !returnedIds.has(id)).length : 0;

  const folderNameById = new Map((folders ?? []).map((f) => [f.id, f.name] as const));

  const archive = new ZipArchive({ zlib: { level: 6 } });
  archive.on("warning", (err: Error) => console.error("[vault download-all] archiver warning:", err));
  archive.on("error", (err: Error) => console.error("[vault download-all] archiver error:", err));

  // Short-lived URLs (E-11), signed in batches per bucket instead of one round trip per file.
  const locations = documents.map((d) => resolveStorageLocation(d.storage_path));
  const signedUrl = new Map<string, string>();
  const signErrors = new Map<string, string>();
  for (const bucket of new Set(locations.map((l) => l.bucket))) {
    const paths = [...new Set(locations.filter((l) => l.bucket === bucket).map((l) => l.path))];
    for (let i = 0; i < paths.length; i += SIGN_BATCH) {
      const chunk = paths.slice(i, i + SIGN_BATCH);
      const { data, error } = await supabase.storage.from(bucket).createSignedUrls(chunk, 300);
      if (error || !data) {
        for (const p of chunk) signErrors.set(`${bucket}:${p}`, error?.message ?? "could not sign");
        continue;
      }
      for (const row of data) {
        if (row.signedUrl && !row.error && row.path) signedUrl.set(`${bucket}:${row.path}`, row.signedUrl);
        else if (row.path) signErrors.set(`${bucket}:${row.path}`, row.error ?? "could not sign");
      }
    }
  }

  // Fire-and-continue: appends each document's bytes as they're fetched from Storage, then
  // finalizes. Errors reading an individual file are logged and skipped rather than failing the
  // whole zip — one bad/missing object shouldn't block downloading everything else.
  (async () => {
    const skipped: string[] = [];
    const manifest: ManifestRow[] = [];
    let aborted: string | null = null;
    try {
      // Name collisions within the same folder (e.g. two revisions with the same title) are
      // disambiguated with a numeric suffix rather than silently overwriting one in the zip.
      const usedNames = new Set<string>();
      const startFetch = (index: number) => {
        const loc = locations[index];
        const url = signedUrl.get(`${loc.bucket}:${loc.path}`);
        return url ? fetch(url).catch(() => null) : Promise.resolve(null);
      };
      const inflight = new Map<number, Promise<Response | null>>();
      for (let i = 0; i < Math.min(PREFETCH, documents.length); i++) inflight.set(i, startFetch(i));

      for (let i = 0; i < documents.length; i++) {
        const doc = documents[i];
        const { bucket, path } = locations[i];
        const fileResponse = await inflight.get(i)!;
        inflight.delete(i);
        const next = i + PREFETCH;
        if (next < documents.length) inflight.set(next, startFetch(next));

        if (!fileResponse?.ok || !fileResponse.body) {
          const reason = signErrors.get(`${bucket}:${path}`) ?? (fileResponse ? `HTTP ${fileResponse.status}` : "download failed");
          console.error(`[vault download-all] Skipping "${doc.title}" — could not download:`, reason);
          skipped.push(`${doc.title} (${reason})`);
          continue;
        }
        const folderName = sanitizeZipSegment(folderNameById.get(doc.folder_id) ?? "General Reference");
        const extMatch = /\.([a-z0-9]+)$/i.exec(path);
        const ext = extMatch ? `.${extMatch[1]}` : "";
        const statusTag = doc.status === "approved" ? "" : doc.status === "superseded" ? " (SUPERSEDED)" : " (UNAPPROVED)";
        const baseName = sanitizeZipSegment(`${doc.document_number ?? doc.title} — rev${doc.revision}${statusTag}`);
        let entryName = `${folderName}/${baseName}${ext}`;
        let dupeCount = 1;
        while (usedNames.has(entryName)) {
          entryName = `${folderName}/${baseName} (${++dupeCount})${ext}`;
        }
        usedNames.add(entryName);

        // Stream the file into the zip rather than holding it all in memory, hashing it on the way through.
        const hash = createHash("sha256");
        let size = 0;
        const fileStream = Readable.fromWeb(fileResponse.body as unknown as import("stream/web").ReadableStream);
        fileStream.on("data", (chunk: Buffer) => {
          hash.update(chunk);
          size += chunk.length;
        });
        archive.append(fileStream, { name: entryName });
        await new Promise<void>((resolve) => {
          fileStream.once("end", () => resolve());
          fileStream.once("error", () => resolve());
        });
        manifest.push({
          path: entryName,
          title: doc.title,
          documentNumber: doc.document_number,
          revision: doc.revision,
          status: doc.status,
          sizeBytes: size,
          sha256: hash.digest("hex"),
        });
      }
    } catch (err) {
      console.error("[vault download-all] aborted:", err);
      aborted = err instanceof Error ? err.message : "unexpected error";
    } finally {
      // The HTTP status was already sent as 200 when streaming started, so an early stop is reported inside the zip.
      const notes: string[] = [];
      if (aborted) notes.push(`THIS PACK IS INCOMPLETE: the export stopped early (${aborted}). Download it again.`);
      if (preSkippedCount > 0) notes.push(`${preSkippedCount} selected document(s) were not included (not approved or not accessible).`);
      if (skipped.length > 0) notes.push(`These files could not be included:\n${skipped.join("\n")}`);
      if (notes.length > 0) archive.append(`${notes.join("\n\n")}\n`, { name: "_NOT_INCLUDED.txt" });
      archive.append(buildManifestCsv(manifest), { name: "MANIFEST.csv" });
      void archive.finalize();
    }
  })();

  const webStream = Readable.toWeb(archive as unknown as Readable) as ReadableStream;

  return new NextResponse(webStream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${selectedIds ? "vault-selected-documents" : "vault-documents"}.zip"`,
      ...(preSkippedCount > 0 ? { "X-Vault-Skipped-Count": String(preSkippedCount) } : {}),
    },
  });
}
