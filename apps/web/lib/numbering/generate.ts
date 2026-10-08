import type { SupabaseClient } from "@supabase/supabase-js";
import { NUMBERING_CONFIGS_TABLE, type NumberingConfigRow, type NumberingDocType } from "@/lib/numbering/types";
import { formatDocumentNumber } from "@/lib/numbering/format";
import { isMissingSchemaError } from "@/lib/offline/missing-schema";

export interface GenerateDocumentNumberParams {
  organizationId: string;
  projectId: string;
  docType: NumberingDocType;
  /** The project's own project_number, used by the hardcoded fallback format. */
  projectNumber: string;
  /** R104: this document's discipline code (master_disciplines.code), when one is resolvable at
   *  the point of generation — e.g. an NCR raised against a specific itp_item that has a discipline
   *  set. Only spliced into the number when the resolved config's include_discipline is true; when
   *  the config wants it but this is null (nothing resolvable for this document), the segment is
   *  simply omitted rather than inserting a placeholder. Omit this param entirely for a doc type
   *  that never has a discipline of its own to resolve (e.g. an ITP at creation time, before it has
   *  any items).*/
  disciplineCode?: string | null;
}

/** Raised when a number cannot be allocated. Callers surface a clear error instead of issuing a
 *  differently-formatted or collision-prone number (B3: no silent timestamp fallback). */
export class NumberingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NumberingError";
  }
}

export const NUMBERING_UNAVAILABLE_MESSAGE = "Could not allocate the next number. Please try again.";

export interface GeneratedDocumentNumber {
  documentNumber: string;
  /**
   * Hands the allocated number(s) back to the counter. Call it when the insert that was meant to use the
   * number fails, so the failed save leaves no gap. Best-effort and safe to call once: it only takes effect
   * while nothing newer has been allocated (see release_document_sequence); otherwise a gap remains.
   * Optional so callers/mocks that build the result by hand need not provide it.
   */
  releaseNumber?: () => Promise<void>;
  /**
   * Only populated for a 'white_label' engagement — the hidden JAGS-internal traceability
   * reference behind the client-visible document number. Null for every other engagement mode.
   */
  internalReference: string | null;
}

const DEFAULT_CONFIG: Pick<
  NumberingConfigRow,
  "originator_code" | "separator" | "sequence_padding" | "include_year" | "include_discipline"
> = {
  originator_code: "JAGS",
  separator: "-",
  sequence_padding: 3,
  include_year: false,
  include_discipline: false,
};

function formatNumber(
  parts: { clientCode: string; originatorCode: string; docType: string; seq: number; disciplineCode?: string | null },
  config: Pick<NumberingConfigRow, "separator" | "sequence_padding" | "include_year" | "include_discipline">
): string {
  return formatDocumentNumber(parts, {
    separator: config.separator,
    sequencePadding: config.sequence_padding,
    includeYear: config.include_year,
    includeDiscipline: config.include_discipline,
  });
}

/**
 * Generates a document number for the given doc type, driven by the organisation's (optionally
 * project-overridden) numbering_configs row and its engagement_mode.
 *
 * Lookup order for the config: project-specific row, then org-level row (project_id is null),
 * then a hardcoded default — numbering being unconfigured must never block document creation.
 * If the sequence itself cannot be allocated this THROWS NumberingError (no timestamp fallback).
 * The returned releaseNumber() hands the number back when the subsequent insert fails.
 *
 * The sequence itself is advanced via the next_document_sequence() Postgres function (a single
 * atomic upsert-and-increment-and-return), never via a separate select-then-update from here,
 * which would race under concurrent document creation.
 */
export async function generateDocumentNumber(
  supabase: SupabaseClient,
  { organizationId, projectId, docType, projectNumber, disciplineCode = null }: GenerateDocumentNumberParams
): Promise<GeneratedDocumentNumber> {
  const { data: configs } = await supabase
    .from(NUMBERING_CONFIGS_TABLE)
    .select("*")
    .eq("organization_id", organizationId)
    .eq("doc_type", docType)
    .eq("project_id", projectId)
    .returns<NumberingConfigRow[]>();

  const { data: orgConfigs } = await supabase
    .from(NUMBERING_CONFIGS_TABLE)
    .select("*")
    .eq("organization_id", organizationId)
    .eq("doc_type", docType)
    .is("project_id", null)
    .returns<NumberingConfigRow[]>();

  const projectConfig = configs?.[0] ?? null;
  const orgConfig = orgConfigs?.[0] ?? null;
  const config = projectConfig ?? orgConfig;

  const clientCode = config?.client_code ?? projectNumber;
  const originatorCode = config?.originator_code ?? DEFAULT_CONFIG.originator_code;
  const formatOpts = {
    separator: config?.separator ?? DEFAULT_CONFIG.separator,
    sequence_padding: config?.sequence_padding ?? DEFAULT_CONFIG.sequence_padding,
    include_year: config?.include_year ?? DEFAULT_CONFIG.include_year,
    include_discipline: config?.include_discipline ?? DEFAULT_CONFIG.include_discipline,
  };

  const { data: seqValue, error: seqError } = await supabase.rpc("next_document_sequence", {
    org_id: organizationId,
    proj_id: projectId,
    seq_doc_type: docType,
  });

  if (seqError || typeof seqValue !== "number") {
    // Fail clearly: a timestamp-based number would silently use a different format and could collide.
    console.error(
      `[numbering] next_document_sequence RPC failed for org ${organizationId}, docType "${docType}".`,
      seqError?.message ?? `unexpected RPC result: ${JSON.stringify(seqValue)}`
    );
    throw new NumberingError(NUMBERING_UNAVAILABLE_MESSAGE);
  }

  const documentNumber = formatNumber(
    { clientCode, originatorCode, docType, seq: seqValue, disciplineCode },
    formatOpts
  );

  const { data: org } = await supabase
    .from("organizations")
    .select("engagement_mode")
    .eq("id", organizationId)
    .maybeSingle<{ engagement_mode: string }>();

  let internalReference: string | null = null;
  let internalSeq: number | null = null;
  if (org?.engagement_mode === "white_label") {
    const { data: internalSeqValue } = await supabase.rpc("next_document_sequence", {
      org_id: organizationId,
      proj_id: projectId,
      seq_doc_type: `internal:${docType}`,
    });
    if (typeof internalSeqValue === "number") {
      internalSeq = internalSeqValue;
      internalReference = formatNumber(
        { clientCode: "JAGS", originatorCode: "", docType, seq: internalSeqValue },
        { separator: "-", sequence_padding: 3, include_year: false, include_discipline: false }
      );
    }
  }

  return {
    documentNumber,
    internalReference,
    releaseNumber: async () => {
      // Newest first so each release still sees its own number as the latest.
      if (internalSeq !== null) {
        await releaseSequence(supabase, { organizationId, projectId, seqKey: `internal:${docType}`, value: internalSeq });
      }
      await releaseSequence(supabase, { organizationId, projectId, seqKey: docType, value: seqValue });
    },
  };
}

/**
 * The same atomic, race-free primitive as generateDocumentNumber (next_document_sequence), for the
 * sub-document numbers that live inside a single ITP's own scheme rather than the client-configured
 * project/org numbering (checklist_number, an inspection record's INSP suffix, an IRN suffix,
 * standalone assignment numbers per type) — these don't have a client_code/format to look up in
 * numbering_configs, just a plain incrementing int, so there's no need to go through
 * generateDocumentNumber's config+formatting layer for them.
 *
 * seqKey should be namespaced by whatever the sequence is actually scoped to (e.g. `checklist:${itpId}`,
 * `irn:${itpNumber}`) so two different ITPs in the same project don't share one counter.
 */
export async function nextSequenceNumber(
  supabase: SupabaseClient,
  { organizationId, projectId, seqKey }: { organizationId: string; projectId: string | null; seqKey: string }
): Promise<number> {
  const { data, error } = await supabase.rpc("next_document_sequence", {
    org_id: organizationId,
    proj_id: projectId,
    seq_doc_type: seqKey,
  });

  if (error || typeof data !== "number") {
    // Fail clearly (B3): no timestamp fallback number that could collide or break the format.
    console.error(
      `[numbering] next_document_sequence RPC failed for org ${organizationId}, seqKey "${seqKey}".`,
      error?.message ?? `unexpected RPC result: ${JSON.stringify(data)}`
    );
    throw new NumberingError(NUMBERING_UNAVAILABLE_MESSAGE);
  }

  return data;
}

/**
 * Gives an allocated sequence value back (B3) when the insert that was going to use it failed, so the
 * failed save leaves no gap. Compare-and-decrement in release_document_sequence: it only takes effect
 * while `value` is still the counter's latest number, so a number a concurrent request has since taken is
 * never reused or disturbed. Best-effort and silent (including before the migration is applied).
 * Returns whether the counter was stepped back.
 */
export async function releaseSequence(
  supabase: SupabaseClient,
  { organizationId, projectId, seqKey, value }: { organizationId: string; projectId: string | null; seqKey: string; value: number }
): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc("release_document_sequence", {
      org_id: organizationId,
      proj_id: projectId,
      seq_doc_type: seqKey,
      released_value: value,
    });
    if (error) {
      if (!isMissingSchemaError(error)) console.error("[numbering] release_document_sequence failed", error.message);
      return false;
    }
    return data === true;
  } catch {
    return false;
  }
}
