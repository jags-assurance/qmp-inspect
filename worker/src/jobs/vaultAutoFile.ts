import type { SupabaseClient } from "@supabase/supabase-js";
import { assertNotAborted, PermanentJobError } from "./jobAbort";

/**
 * Auto-files a worker-rendered PDF into the project's Document Vault, so generated documents are
 * findable alongside manually-uploaded ones (apps/web/lib/vault/*).
 *
 * Vault folders are the fixed, per-project set auto-created by the `create_default_vault_folders`
 * trigger; this never invents a category, it only resolves (or re-creates) the standard folder.
 *
 * Bucket note: worker-rendered PDFs live in the "generated-documents" bucket, so the path stored
 * here is prefixed "generated-documents:<path>" (the vault viewer and download-all route parse that
 * optional "<bucket>:<path>" prefix; unprefixed paths default to inspection-evidence).
 *
 * Rules enforced here and in the per-document gates below:
 *  - Only FINAL documents are filed as 'approved' (see the should/assert gates below).
 *  - Every generation uses a unique storage path (buildGeneratedPath) and is never upserted over a
 *    path a vault row references.
 *  - Revisions are computed from the numeric maximum already filed (computeNextRevision), the new
 *    row only supersedes lower-revision 'approved' rows (selectSupersedable).
 *  - Failures THROW so the job fails and can be retried; a retry is idempotent per storage_path.
 */
const DEFAULT_FOLDER_NAMES: Record<string, string> = {
  drawings: "Drawings",
  specifications: "Specifications",
  standards_codes: "Standards & Codes",
  material_submittals: "Material Submittals",
  rfis: "RFIs",
  method_statements: "Method Statements",
  itps_approved: "ITPs (Approved)",
  checklists_forms: "Checklists & Forms",
  approvals_correspondence: "Approvals & Correspondence",
  certificates: "Certificates",
  general_reference: "General Reference",
  test_reports: "Test Reports",
};

export const GENERATED_DOCUMENTS_BUCKET = "generated-documents";

type PreviousRow = { id: string; revision: string; status: string };

// ---------------------------------------------------------------------------------------------
// Pure helpers (unit tested)
// ---------------------------------------------------------------------------------------------

function safeSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "doc";
}

/** `<prefix>/<base>-rev<revision>-<timestamp>.pdf` — unique per generation. */
export function buildGeneratedPath(
  prefix: string,
  base: string,
  revision: string | null | undefined,
  now: number = Date.now(),
  /** Source-content tag (see generatedDocument.ts): lets an identical regeneration find this file again. */
  tag?: string
): string {
  const rev = revision === null || revision === undefined || revision === "" ? "" : `-rev${safeSegment(String(revision))}`;
  const h = tag ? `-h${tag}` : "";
  return `${prefix.replace(/\/+$/, "")}/${safeSegment(base)}${rev}${h}-${now}.pdf`;
}

/** `<prefix>/<timestamp>/<fileName>` — for packs whose consumers derive sibling paths by file name. */
export function buildGeneratedDirPath(prefix: string, fileName: string, now: number = Date.now()): string {
  return `${prefix.replace(/\/+$/, "")}/${now}/${fileName}`;
}

function numericRevision(revision: string): number | null {
  return /^\d+$/.test(revision.trim()) ? Number.parseInt(revision.trim(), 10) : null;
}

/**
 * Next revision label: highest NUMERIC revision + 1 (0 when nothing is filed). Non-numeric labels
 * ("A", "draft") never restart the count at 0. If the candidate collides with an existing label it
 * keeps incrementing, so the label is always unique among `rows`.
 */
export function computeNextRevision(rows: { revision: string }[]): string {
  const taken = new Set(rows.map((r) => r.revision.trim()));
  const numerics = rows.map((r) => numericRevision(r.revision)).filter((n): n is number => n !== null);
  let candidate = numerics.length > 0 ? Math.max(...numerics) + 1 : rows.length === 0 ? 0 : rows.length;
  while (taken.has(String(candidate))) candidate += 1;
  return String(candidate);
}

/** Ids a newly filed revision may supersede: only 'approved' rows with a LOWER numeric revision. */
export function selectSupersedable(previous: PreviousRow[], newRevision: string, inclusive = false): string[] {
  const next = numericRevision(newRevision);
  if (next === null) return [];
  return previous
    .filter((d) => {
      if (d.status !== "approved") return false;
      const n = numericRevision(d.revision);
      return n !== null && (inclusive ? n <= next : n < next);
    })
    .map((d) => d.id);
}

export function shouldFileFatAsFinal(assignmentStatus: string | null | undefined): boolean {
  return assignmentStatus === "completed";
}

export function shouldFileDataBook(status: string | null | undefined): boolean {
  return status === "issued";
}

export function assertInspectionFileable(overallResult: string | null | undefined): void {
  if (!overallResult) {
    throw new PermanentJobError("Inspection has no overall result yet; refusing to render/file a final inspection report.");
  }
}

export function assertIrnFileable(voidedAt: string | null | undefined, allowVoid = false): void {
  if (voidedAt && !allowVoid) {
    throw new PermanentJobError("IRN is voided; refusing to render/file it as a live certificate.");
  }
}

export function assertNcrCloseoutFileable<
  T extends { status: string | null; root_cause: string | null; corrective_action: string | null; verification_notes: string | null },
>(ncr: T): asserts ncr is T & { root_cause: string; corrective_action: string; verification_notes: string } {
  if (ncr.status !== "closed" || !ncr.root_cause || !ncr.corrective_action || !ncr.verification_notes) {
    throw new PermanentJobError("NCR is not closed with root cause, corrective action and verification; refusing to render/file a close-out certificate.");
  }
}

/** NCR dossier: 'approved' only once the NCR is closed; open/other NCRs file as 'for_review'. */
export function ncrDossierFilingStatus(ncrStatus: string | null | undefined): "approved" | "for_review" {
  return ncrStatus === "closed" ? "approved" : "for_review";
}

/** True when an RPC error means the function is not deployed yet (Postgres 42883 / PostgREST PGRST202). */
export function isRpcMissing(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false;
  return error.code === "42883" || error.code === "PGRST202" || /could not find the function/i.test(error.message ?? "");
}

export function shouldFileOrgPacks(): boolean {
  return process.env.FILE_ORG_PACKS_IN_PROJECT_VAULTS === "true";
}

// ---------------------------------------------------------------------------------------------
// Storage / vault operations
// ---------------------------------------------------------------------------------------------

/** Uploads a generated file to a unique path (never upserts) unless the job was aborted. */
export async function uploadGeneratedFile(
  supabase: SupabaseClient,
  path: string,
  body: Buffer | Uint8Array,
  contentType = "application/pdf"
): Promise<void> {
  assertNotAborted();
  const { error } = await supabase.storage.from(GENERATED_DOCUMENTS_BUCKET).upload(path, body, { contentType, upsert: false });
  if (error) throw new Error(`Failed to upload generated file: ${error.message}`);
}

async function loadPreviousRows(supabase: SupabaseClient, folderId: string, documentReference: string): Promise<PreviousRow[]> {
  const PAGE = 500;
  const MAX_PAGES = 20;
  const all: PreviousRow[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await supabase
      .from("vault_documents" as never)
      .select("id, revision, status")
      .eq("folder_id", folderId)
      .eq("document_reference", documentReference)
      .order("created_at", { ascending: true })
      .range(page * PAGE, page * PAGE + PAGE - 1)
      .returns<PreviousRow[]>();
    if (error) throw new Error(`Could not read earlier vault revisions: ${error.message}`);
    const rows = data ?? [];
    all.push(...rows);
    if (rows.length < PAGE) break;
  }
  return all;
}

/**
 * Read-only: the revision the next generation of this document will be filed as. Renderers call this
 * BEFORE rendering so the printed "Rev" matches the vault row. Best-effort: returns "0" when the
 * folder does not exist yet; throws on a read error (job is retryable).
 */
export async function resolveNextRevision(
  supabase: SupabaseClient,
  projectId: string,
  folderKey: string,
  documentReference: string
): Promise<string> {
  const { data: folder, error } = await supabase
    .from("vault_folders" as never)
    .select("id")
    .eq("project_id", projectId)
    .eq("folder_key", folderKey)
    .maybeSingle<{ id: string }>();
  if (error) throw new Error(`Could not resolve vault folder '${folderKey}': ${error.message}`);
  if (!folder) return "0";
  return computeNextRevision(await loadPreviousRows(supabase, folder.id, documentReference));
}

export async function autoFileVaultDocument(
  supabase: SupabaseClient,
  params: {
    projectId: string;
    folderKey: string;
    title: string;
    documentReference: string | null;
    revision: string;
    storagePath: string;
    fileSize: number | null;
    generatedBy?: string | null;
    /** Count the revision up from the numeric maximum already filed (ignores `revision`). */
    autoRevision?: boolean;
    /** "approved" (default) for issued records; "for_review" files without superseding anything. */
    status?: "approved" | "for_review";
    /** Document revisions are owned by the source record (ITPs): keep `revision` as given and let a
     *  regeneration of the same revision supersede the earlier copy of that revision. */
    keepRevision?: boolean;
  }
): Promise<void> {
  assertNotAborted();

  let { data: folder, error: folderError } = await supabase
    .from("vault_folders" as never)
    .select("id")
    .eq("project_id", params.projectId)
    .eq("folder_key", params.folderKey)
    .maybeSingle<{ id: string }>();

  if (!folder && !folderError && DEFAULT_FOLDER_NAMES[params.folderKey]) {
    const created = await supabase
      .from("vault_folders" as never)
      .insert({ project_id: params.projectId, folder_key: params.folderKey, name: DEFAULT_FOLDER_NAMES[params.folderKey] } as never)
      .select("id")
      .single<{ id: string }>();
    folder = created.data;
    folderError = created.error as typeof folderError;
  }

  if (folderError || !folder) {
    throw new Error(`Could not resolve vault folder '${params.folderKey}' for project ${params.projectId}: ${folderError?.message ?? "no folder row"}`);
  }

  const storedPath = `${GENERATED_DOCUMENTS_BUCKET}:${params.storagePath}`;

  // Preferred path: one atomic, advisory-locked SQL function. Falls back to the multi-step path
  // below when the function is not deployed yet.
  assertNotAborted();
  const rpc = await supabase.rpc("vault_file_generated_document" as never, {
    p_folder_id: folder.id,
    p_title: params.title,
    p_document_reference: params.documentReference ?? params.title,
    p_revision: params.revision,
    p_storage_path: storedPath,
    p_file_size: params.fileSize,
    p_status: params.status ?? "approved",
    p_uploaded_by: params.generatedBy ?? null,
    p_auto_revision: params.autoRevision === true,
    p_keep_revision: params.keepRevision === true,
  } as never);
  if (!rpc.error) return;
  if (!isRpcMissing(rpc.error)) {
    throw new Error(`Failed to file '${params.title}' in the vault: ${rpc.error.message}`);
  }

  // Idempotency: a retried job (or double call) must not file the same stored object twice.
  const { data: existing, error: existingError } = await supabase
    .from("vault_documents" as never)
    .select("id")
    .eq("folder_id", folder.id)
    .eq("storage_path", storedPath)
    .limit(1)
    .returns<{ id: string }[]>();
  if (existingError) throw new Error(`Could not check for an existing vault row: ${existingError.message}`);
  if (existing && existing.length > 0) return;

  const documentReference = params.documentReference ?? params.title;
  const status = params.status ?? "approved";
  const previous = await loadPreviousRows(supabase, folder.id, documentReference);

  let revision = params.revision;
  if (!params.keepRevision && (params.autoRevision || previous.some((d) => d.revision.trim() === revision.trim()))) {
    revision = computeNextRevision(previous);
  }

  assertNotAborted();
  const { data: inserted, error: insertError } = await supabase
    .from("vault_documents" as never)
    .insert({
      folder_id: folder.id,
      title: params.title,
      document_reference: documentReference,
      revision,
      storage_path: storedPath,
      file_size: params.fileSize,
      status,
      uploaded_by: params.generatedBy ?? null,
    } as never)
    .select("id")
    .single<{ id: string }>();

  if (insertError || !inserted) {
    throw new Error(`Failed to insert vault_documents row for '${params.title}': ${insertError?.message ?? "no row returned"}`);
  }

  const stale = status === "for_review" ? [] : selectSupersedable(previous, revision, params.keepRevision === true);
  if (stale.length > 0) {
    const { error: supersedeError } = await supabase
      .from("vault_documents" as never)
      .update({ status: "superseded", superseded_by: inserted.id } as never)
      .in("id", stale);
    if (supersedeError) {
      throw new Error(`Filed '${params.title}' but could not supersede earlier copies: ${supersedeError.message}`);
    }
  }
}

/**
 * Files an ORGANISATION-WIDE pack (weekly / monthly report pack, portfolio summary) into the vault
 * of every project it covers, under "General Reference".
 *
 * CAUTION: these PDFs contain figures for every project in the organisation, and a project's vault is
 * visible to its client / contractor / TPI. Off by default; only set
 * FILE_ORG_PACKS_IN_PROJECT_VAULTS=true for development/test data.
 */
/** Kill switch for project-scoped packs: filed by default; set FILE_PROJECT_PACKS_IN_PROJECT_VAULTS=false to stop. */
export function shouldFileProjectPacks(): boolean {
  return process.env.FILE_PROJECT_PACKS_IN_PROJECT_VAULTS !== "false";
}

/**
 * Files a PROJECT-SCOPED pack (aggregated with a project_id filter, so it only holds that project's
 * figures) into that one project's vault under "General Reference". Unlike fileOrgPackInProjectVaults it
 * is on by default, because nothing in the PDF belongs to another project. Callers must only pass a pack
 * that was aggregated for exactly this project.
 */
export async function fileProjectPackInProjectVault(
  supabase: SupabaseClient,
  params: {
    projectId: string;
    title: string;
    documentReference: string;
    storagePath: string;
    fileSize: number | null;
    generatedBy?: string | null;
  }
): Promise<void> {
  if (!shouldFileProjectPacks()) return;
  await autoFileVaultDocument(supabase, {
    projectId: params.projectId,
    folderKey: "general_reference",
    title: params.title,
    documentReference: params.documentReference,
    revision: "0",
    storagePath: params.storagePath,
    fileSize: params.fileSize,
    generatedBy: params.generatedBy ?? null,
    autoRevision: true,
  });
}

export async function fileOrgPackInProjectVaults(
  supabase: SupabaseClient,
  params: {
    projectIds: string[];
    title: string;
    documentReference: string;
    storagePath: string;
    fileSize: number | null;
    generatedBy?: string | null;
  }
): Promise<void> {
  if (!shouldFileOrgPacks()) return;
  for (const projectId of [...new Set(params.projectIds)]) {
    await autoFileVaultDocument(supabase, {
      projectId,
      folderKey: "general_reference",
      title: params.title,
      documentReference: params.documentReference,
      revision: "0",
      storagePath: params.storagePath,
      fileSize: params.fileSize,
      generatedBy: params.generatedBy ?? null,
      autoRevision: true,
    });
  }
}
