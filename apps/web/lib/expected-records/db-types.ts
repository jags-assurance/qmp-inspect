// Domain types + table-name handle for the table added in
// supabase/migrations/20260910120000_phase3_activity_expected_records.sql.
//
// Not in the generated Database type yet, so `.from()` can't resolve it against the Tables map —
// same escape hatch as ACTIVITY_SIGNOFF_PROGRESS_TABLE in lib/signoff/db-types.ts. Every query still
// gets its real row shape back via an explicit `.returns<T>()` / typed `.single<T>()`.

/* eslint-disable @typescript-eslint/no-explicit-any -- narrow, documented escape hatch, see above */
export const ACTIVITY_EXPECTED_RECORDS_TABLE = "activity_expected_records" as any;
/* eslint-enable @typescript-eslint/no-explicit-any */

export const EXPECTED_RECORD_PROVIDERS = ["jags", "tpi", "contractor"] as const;
export type ExpectedRecordProvider = (typeof EXPECTED_RECORD_PROVIDERS)[number];

// `provider` uses the spec's own three labels (R54: Jags/TPI/Contractor); project_parties.party_type
// is finer-grained, so this maps each provider label to the party_type(s) that satisfy it — mirrored
// in the RLS policy in supabase/migrations/20260910120000_phase3_activity_expected_records.sql.
type PartyType = "jags" | "subcontractor" | "main_contractor" | "tpi_lab" | "vendor" | "client";

export const PROVIDER_TO_PARTY_TYPES: Record<ExpectedRecordProvider, PartyType[]> = {
  jags: ["jags"],
  tpi: ["tpi_lab"],
  contractor: ["main_contractor", "subcontractor"],
};

export interface ActivityExpectedRecordRow {
  id: string;
  itp_item_id: string;
  provider: ExpectedRecordProvider;
  record_type: string;
  document_number: string | null;
  storage_path: string | null;
  received_at: string | null;
  created_at: string;
}
