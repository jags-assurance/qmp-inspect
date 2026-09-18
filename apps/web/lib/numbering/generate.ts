import type { SupabaseClient } from "@supabase/supabase-js";
import { NUMBERING_CONFIGS_TABLE, type NumberingConfigRow, type NumberingDocType } from "@/lib/numbering/types";
import { formatDocumentNumber } from "@/lib/numbering/format";

export interface GenerateDocumentNumberParams {
  organizationId: string;
  projectId: string;
  docType: NumberingDocType;
  /** The project's own project_number, used by the hardcoded fallback format. */
  projectNumber: string;
}

export interface GeneratedDocumentNumber {
  documentNumber: string;
  /**
   * Only populated for a 'white_label' engagement — the hidden JAGS-internal traceability
   * reference behind the client-visible document number. Null for every other engagement mode.
   */
  internalReference: string | null;
}

const DEFAULT_CONFIG: Pick<
  NumberingConfigRow,
  "originator_code" | "separator" | "sequence_padding" | "include_year"
> = {
  originator_code: "JAGS",
  separator: "-",
  sequence_padding: 3,
  include_year: false,
};

function formatNumber(
  parts: { clientCode: string; originatorCode: string; docType: string; seq: number },
  config: Pick<NumberingConfigRow, "separator" | "sequence_padding" | "include_year">
): string {
  return formatDocumentNumber(parts, {
    separator: config.separator,
    sequencePadding: config.sequence_padding,
    includeYear: config.include_year,
  });
}

/**
 * Generates a document number for the given doc type, driven by the organisation's (optionally
 * project-overridden) numbering_configs row and its engagement_mode.
 *
 * Lookup order for the config: project-specific row, then org-level row (project_id is null),
 * then a hardcoded default — numbering being unconfigured must never block document creation.
 *
 * The sequence itself is advanced via the next_document_sequence() Postgres function (a single
 * atomic upsert-and-increment-and-return), never via a separate select-then-update from here,
 * which would race under concurrent document creation.
 */
export async function generateDocumentNumber(
  supabase: SupabaseClient,
  { organizationId, projectId, docType, projectNumber }: GenerateDocumentNumberParams
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
  };

  const { data: seqValue, error: seqError } = await supabase.rpc("next_document_sequence", {
    org_id: organizationId,
    proj_id: projectId,
    seq_doc_type: docType,
  });

  if (seqError || typeof seqValue !== "number") {
    // Numbering must never block document creation — fall back to a timestamp-based placeholder
    // number rather than throwing. Still log loudly: a silent fallback here means collision-prone
    // numbers are being issued instead of real atomic ones, and nobody would otherwise know.
    console.error(
      `[numbering] next_document_sequence RPC failed for org ${organizationId}, docType "${docType}" — using fallback sequence number.`,
      seqError?.message ?? `unexpected RPC result: ${JSON.stringify(seqValue)}`
    );
    const fallbackSeq = Date.now() % 100000;
    return {
      documentNumber: formatNumber(
        { clientCode: projectNumber, originatorCode: "JAGS", docType, seq: fallbackSeq },
        DEFAULT_CONFIG
      ),
      internalReference: null,
    };
  }

  const documentNumber = formatNumber(
    { clientCode, originatorCode, docType, seq: seqValue },
    formatOpts
  );

  const { data: org } = await supabase
    .from("organizations")
    .select("engagement_mode")
    .eq("id", organizationId)
    .maybeSingle<{ engagement_mode: string }>();

  let internalReference: string | null = null;
  if (org?.engagement_mode === "white_label") {
    const { data: internalSeqValue } = await supabase.rpc("next_document_sequence", {
      org_id: organizationId,
      proj_id: projectId,
      seq_doc_type: `internal:${docType}`,
    });
    if (typeof internalSeqValue === "number") {
      internalReference = formatNumber(
        { clientCode: "JAGS", originatorCode: "", docType, seq: internalSeqValue },
        { separator: "-", sequence_padding: 3, include_year: false }
      );
    }
  }

  return { documentNumber, internalReference };
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
    // Numbering must never block document creation — same fallback spirit as generateDocumentNumber.
    // Still log loudly: a silent fallback here means a collision-prone number is being issued.
    console.error(
      `[numbering] next_document_sequence RPC failed for org ${organizationId}, seqKey "${seqKey}" — using fallback sequence number.`,
      error?.message ?? `unexpected RPC result: ${JSON.stringify(data)}`
    );
    return Date.now() % 100000;
  }

  return data;
}
