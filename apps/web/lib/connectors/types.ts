// R21 — connector stubs for external construction-document platforms (Aconex/Procore/ProjectWise).
//
// This interface is deliberately shaped around what would actually be needed to feed
// importDocument straight into lib/vault/actions.ts's uploadVaultDocumentCore without a redesign
// later — see that function's params (folderId, projectId, title, documentReference, revision,
// documentDate, storagePath, fileSize, uploadedBy). A real connector's importDocument would:
//   1. Use downloadUrl (this platform's own authenticated API URL/token for the file's bytes) to
//      fetch the file.
//   2. Upload those bytes to the "inspection-evidence" Storage bucket under
//      `vault/${projectId}/${platformName}/${...}` (the same bucket + path shape every other vault
//      upload path already uses).
//   3. Call uploadVaultDocumentCore with a service-role Supabase client (no user session exists
//      for a background sync run — same reasoning as lib/supabase/service.ts's own comment) and
//      documentReference/revision carried over from the platform's own numbering so an existing
//      document there still supersedes correctly on re-import.
// None of the three stubs below can do any of this today — there is no real API access to build
// or test against in this environment (see each stub's own comment).
export interface ConnectorDocument {
  /** The platform's own identifier for this document — used to detect "already imported" and to
   *  request the file again later. */
  externalId: string;
  title: string;
  /** Maps to vault_documents.document_reference — lets a re-import supersede the prior revision
   *  the same way an in-app re-upload does. */
  documentReference: string | null;
  revision: string | null;
  documentDate: string | null;
  fileName: string;
  contentType: string | null;
  /** The platform's own authenticated URL (or opaque reference token) importDocument would fetch
   *  the file's bytes from — never the bytes themselves, since listDocuments is a metadata call and
   *  fetching every file's content just to list it would be wasteful and likely rate-limited. */
  downloadUrl: string;
}

export interface DocumentPlatformConnector {
  /** Human-readable name for display (e.g. in the Document Vault's connector list). */
  platformName: string;
  /** A REAL check — an env var/credential actually being present, never a hardcoded boolean. See
   *  each stub implementation for exactly what it checks. */
  isConfigured(): boolean;
  /** Lists documents available for one project on the external platform, keyed by that platform's
   *  own project reference/ID (not this app's project UUID — the two systems' project identifiers
   *  are unrelated until an org maps them, which none of these stubs do yet). */
  listDocuments(projectRef: string): Promise<ConnectorDocument[]>;
  /** Imports one listed document into this app's Document Vault, into the given vault folder ID. */
  importDocument(doc: ConnectorDocument, targetFolderId: string): Promise<void>;
}

/** Thrown by every stub's listDocuments/importDocument — a clear, consistent message rather than a
 *  generic network/auth error, so a caller (or this UI) can tell "not configured" apart from a real
 *  runtime failure once a connector is eventually implemented for real. */
export class ConnectorNotConfiguredError extends Error {
  constructor(platformName: string) {
    super(`${platformName} is not configured — no API credentials are available in this environment.`);
    this.name = "ConnectorNotConfiguredError";
  }
}
