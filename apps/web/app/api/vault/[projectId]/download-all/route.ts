import { NextRequest, NextResponse } from "next/server";
import { Readable } from "node:stream";
import { ZipArchive } from "archiver";
import { requireSession } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { VAULT_FOLDERS_TABLE, VAULT_DOCUMENTS_TABLE } from "@/lib/vault/types";

export const runtime = "nodejs";

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

function sanitizeFilename(name: string): string {
  return name.replace(/[/\\?%*:|"<>]/g, "-").trim() || "file";
}

/**
 * Bundles every current (non-superseded) document in a project's Document Vault into a single zip,
 * one folder per vault category (e.g. "ITPs (Approved)/GSP-ITP-007 — rev0.pdf"), streamed rather
 * than buffered so a large project's worth of files never sits fully in memory at once.
 *
 * Access control: deliberately reuses the exact same RLS-scoped query pattern the vault pages
 * themselves use (createSupabaseServerClient() from the caller's own session, `has_org_access`
 * enforced by vault_folders_select/vault_documents_select) — this route can only ever see and zip
 * documents the requesting session could already see one at a time in the UI.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  await requireSession();
  const { projectId } = await params;
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

  const { data: documents, error: documentsError } = await supabase
    .from(VAULT_DOCUMENTS_TABLE)
    .select("id, folder_id, title, document_number, revision, storage_path, status")
    .in("folder_id", folderIds)
    // Approved, current documents only — a handover pack must not include drafts still in review.
    .eq("status", "approved")
    .returns<DocumentRow[]>();

  if (documentsError) {
    return NextResponse.json({ error: "Could not load this project's vault documents." }, { status: 500 });
  }

  if (!documents || documents.length === 0) {
    return NextResponse.json({ error: "This project's vault has no documents to download yet." }, { status: 404 });
  }

  const folderNameById = new Map((folders ?? []).map((f) => [f.id, f.name] as const));

  const archive = new ZipArchive({ zlib: { level: 6 } });
  archive.on("warning", (err: Error) => console.error("[vault download-all] archiver warning:", err));
  archive.on("error", (err: Error) => console.error("[vault download-all] archiver error:", err));

  // Fire-and-continue: appends each document's bytes as they're fetched from Storage, then
  // finalizes. Errors reading an individual file are logged and skipped rather than failing the
  // whole zip — one bad/missing object shouldn't block downloading everything else.
  (async () => {
   const skipped: string[] = [];
   try {
    // Name collisions within the same folder (e.g. two revisions with the same title) are
    // disambiguated with a numeric suffix rather than silently overwriting one in the zip.
    const usedNames = new Set<string>();
    for (const doc of documents) {
      const folderName = sanitizeFilename(folderNameById.get(doc.folder_id) ?? "General Reference");
      const { bucket, path } = resolveStorageLocation(doc.storage_path);
      const { data: signed, error: signError } = await supabase.storage.from(bucket).createSignedUrl(path, 300);
      const fileResponse = signed?.signedUrl ? await fetch(signed.signedUrl) : null;
      if (signError || !fileResponse?.ok || !fileResponse.body) {
        console.error(`[vault download-all] Skipping "${doc.title}" — could not download:`, signError?.message ?? fileResponse?.status);
        skipped.push(doc.title);
        continue;
      }
      const extMatch = /\.([a-z0-9]+)$/i.exec(path);
      const ext = extMatch ? `.${extMatch[1]}` : "";
      const baseName = sanitizeFilename(`${doc.document_number ?? doc.title} — rev${doc.revision}`);
      let entryName = `${folderName}/${baseName}${ext}`;
      let dupeCount = 1;
      while (usedNames.has(entryName)) {
        entryName = `${folderName}/${baseName} (${++dupeCount})${ext}`;
      }
      usedNames.add(entryName);

      // Stream the file into the zip rather than holding it all in memory.
      const fileStream = Readable.fromWeb(fileResponse.body as unknown as import("stream/web").ReadableStream);
      archive.append(fileStream, { name: entryName });
      await new Promise<void>((resolve) => {
        fileStream.once("end", () => resolve());
        fileStream.once("error", () => resolve());
      });
    }
   } catch (err) {
    console.error("[vault download-all] aborted:", err);
   } finally {
    if (skipped.length > 0) {
      archive.append(`These files could not be included:\n${skipped.join("\n")}\n`, { name: "_NOT_INCLUDED.txt" });
    }
    void archive.finalize();
   }
  })();

  const webStream = Readable.toWeb(archive as unknown as Readable) as ReadableStream;

  return new NextResponse(webStream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="vault-documents.zip"`,
    },
  });
}
