// Pure parsing helpers for app/api/vault/email-inbound/route.ts (R20b), split into their own
// module — with no Next.js/Supabase imports — so they're directly unit-testable the same way this
// app already tests other business logic (see lib/checklists/__tests__/completion-logic.test.ts),
// and so the route.ts module itself only exports the HTTP method handlers Next.js expects from a
// Route Handler file.
import { VAULT_FOLDER_KEYS, type VaultFolderKey } from "@/lib/vault/types";

export interface InboundAttachment {
  filename: string;
  contentType: string | null;
  contentBase64: string;
}

export interface NormalizedInboundEmail {
  to: string;
  from: string;
  subject: string;
  attachments: InboundAttachment[];
}

/**
 * Accepts Postmark's PascalCase Inbound Parse field names (the concrete target — see route.ts's
 * own header comment) and the lowercase generic shape most other providers use, so one handler
 * covers both without a second code path. Returns null when the payload doesn't even have the
 * minimum shape (a To address and an Attachments array) to be worth routing further.
 */
export function normalizeInboundPayload(body: unknown): NormalizedInboundEmail | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;

  const to = String(b.To ?? b.to ?? "").trim();
  const from = String(b.From ?? b.from ?? "").trim();
  const subject = String(b.Subject ?? b.subject ?? "").trim();
  const rawAttachments = (b.Attachments ?? b.attachments) as unknown;

  if (!to || !Array.isArray(rawAttachments)) return null;

  const attachments: InboundAttachment[] = [];
  for (const raw of rawAttachments) {
    if (!raw || typeof raw !== "object") continue;
    const a = raw as Record<string, unknown>;
    const filename = String(a.Name ?? a.filename ?? "").trim();
    const contentBase64 = String(a.Content ?? a.content ?? "").trim();
    if (!filename || !contentBase64) continue;
    attachments.push({
      filename,
      contentType: (a.ContentType ?? a.contentType ?? null) as string | null,
      contentBase64,
    });
  }

  return { to, from, subject, attachments };
}

const PROJECT_TOKEN_RE = /vault\+([0-9a-fA-F-]{36})@/;
const FOLDER_TOKEN_RE = /^\s*\[([a-z_]+)\]/i;
export const DEFAULT_INBOUND_FOLDER_KEY: VaultFolderKey = "general_reference";

/** Which PROJECT an inbound email is destined for: a `vault+<project-uuid>@...` plus-addressing
 *  token in the To address — see route.ts's ROUTING SCHEME comment for why a UUID, not a slug. */
export function parseProjectIdFromAddress(to: string): string | null {
  const match = to.match(PROJECT_TOKEN_RE);
  return match ? match[1] : null;
}

/** Which FOLDER within that project: an optional `[folder_key]` token at the start of the
 *  Subject line. Falls back to "general_reference" for a subject with no recognised token. */
export function parseFolderKeyFromSubject(subject: string): VaultFolderKey {
  const match = subject.match(FOLDER_TOKEN_RE);
  const candidate = match?.[1]?.toLowerCase();
  return (VAULT_FOLDER_KEYS as readonly string[]).includes(candidate ?? "")
    ? (candidate as VaultFolderKey)
    : DEFAULT_INBOUND_FOLDER_KEY;
}

/** Strips the extension and swaps underscores/dashes for spaces — mirrors
 *  upload-form.tsx's titleFromFilename, the same "no human filling in a Title field" case. */
export function titleFromAttachmentFilename(filename: string): string {
  const withoutExt = filename.replace(/\.[^/.]+$/, "");
  return withoutExt.replace(/[_-]+/g, " ").trim() || filename;
}
