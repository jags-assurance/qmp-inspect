// Domain types for the tables added in
// supabase/migrations/20260917060000_teams_and_delegation.sql.
//
// Unlike lib/checklists/db-types.ts and lib/signoff/db-types.ts, these tables ARE in the generated
// Database type (packages/shared-types/src/database.ts) — added alongside this migration — so no
// `as any` table-name cast is needed here; `.from("teams")` etc. resolve against the Tables map
// directly.

export interface TeamRow {
  id: string;
  name: string;
  created_at: string;
}

export interface TeamMemberRow {
  team_id: string;
  user_id: string;
  is_team_lead: boolean;
  created_at: string;
}

export interface TeamProjectAssignmentRow {
  team_id: string;
  project_id: string;
  created_at: string;
}
