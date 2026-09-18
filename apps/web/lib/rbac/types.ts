// Domain types + table-name handles for supabase/migrations/20260918020000_custom_rbac.sql. None of
// these three tables are in the generated Database type yet — same documented cast pattern as
// lib/ncrs/types.ts and lib/vault/types.ts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- narrow, documented escape hatch
export const CUSTOM_ROLES_TABLE = "custom_roles" as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- narrow, documented escape hatch
export const CUSTOM_ROLE_PERMISSIONS_TABLE = "custom_role_permissions" as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- narrow, documented escape hatch
export const CUSTOM_ROLE_ASSIGNMENTS_TABLE = "custom_role_assignments" as any;

// Single source of truth for the fixed permission set — must exactly match the check constraint on
// custom_role_permissions.permission_key in the migration. Deliberately small and real: each key
// maps to one actual action already wired to check it (see lib/rbac/permissions.ts's call sites),
// not a speculative full list of every action in the app. Extend both together when wiring a new
// action into the permission system.
export const PERMISSION_KEYS = [
  "add_project_party",
  "reassign_project_party",
  "manage_intervention_levels",
  "issue_irn",
  "close_ncr",
  "view_org_reports",
] as const;
export type PermissionKey = (typeof PERMISSION_KEYS)[number];

export const PERMISSION_LABEL: Record<PermissionKey, string> = {
  add_project_party: "Add a party to a project",
  reassign_project_party: "Reassign a project party's linked login",
  manage_intervention_levels: "Manage custom intervention (approval) levels",
  issue_irn: "Issue an Inspection Release Notice",
  close_ncr: "Close out an NCR",
  view_org_reports: "View organisation reports & report packs",
};

export interface CustomRoleRow {
  id: string;
  organization_id: string | null;
  name: string;
  created_at: string;
}

export interface CustomRoleAssignmentRow {
  id: string;
  role_id: string;
  user_id: string;
  project_id: string | null;
  created_at: string;
}
