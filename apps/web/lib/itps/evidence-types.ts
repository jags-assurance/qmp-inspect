// Table-name constants for the ITP item evidence-execution feature (evidence_type=2/3), split out of
// evidence-actions.ts. Real build failure found live: a "use server" file may only export async
// functions — a runtime string constant (unlike a type/interface, which TypeScript erases entirely
// at compile time) is a real violation Next.js's build-time page-data collection rejects outright,
// even when nothing ever imports it from a Client Component. Same underlying class of bug as
// review-chain.ts's own split into review-chain.ts / review-chain-actions.ts.

// Same pattern as lib/ai/log.ts's AI_USAGE_LOG_TABLE: these two tables aren't in the generated
// Database type yet (packages/shared-types/src/database.ts is hand-maintained until the next
// `pnpm db:types` run — see the README), so `.from()` can't resolve them against the Tables map.
// Casting the table name here is the one place that gap leaks in.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- narrow, documented escape hatch
export const ITP_ITEM_MEASUREMENTS_TABLE = "itp_item_measurements" as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- narrow, documented escape hatch
export const ITP_ITEM_EVIDENCE_DOCUMENTS_TABLE = "itp_item_evidence_documents" as any;
