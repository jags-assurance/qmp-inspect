// Table-name handle for `project_party_members` (supabase/migrations/20260930180000_project_party_members.sql).
//
// Kept in its own file, not lib/projects/party-access-actions.ts, because that file is a
// "use server" module — Next.js only allows a "use server" file to export async functions, so a
// plain constant like this one has to live somewhere else and get imported into it instead.
//
// `project_party_members` isn't in the generated Database type yet, so `.from()` can't resolve it
// against the Tables map. Casting the table name here is the one place that gap leaks in, same
// documented pattern as lib/ncrs/types.ts's NCRS_TABLE — every query still gets its real row shape
// back via an explicit `.returns<T>()` / typed `.single<T>()`/`.maybeSingle<T>()`, so nothing
// downstream works with untyped data.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- narrow, documented escape hatch
export const PROJECT_PARTY_MEMBERS_TABLE = "project_party_members" as any;
