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

// Which of the 6 keys a Self-Managed client can attach to a role SCOPED TO ITS OWN org (never a
// JAGS-global role) — mirrors the RLS check in custom_role_permissions_self_managed_write
// (supabase/migrations/20260919030000_self_managed_custom_role_management.sql), where the full
// reasoning lives. Short version: these 3 are client-operational (deciding how the client's own
// people split up work on the client's own projects); the other 3
// (manage_intervention_levels/issue_irn/close_ncr) touch the platform's independent-assurance
// controls and stay JAGS-Admin-grantable-only even for a self-managed org's own role. A JAGS Admin
// is never limited by this list — only the self-managed client's own write path is.
export const CLIENT_SELF_SERVICE_PERMISSION_KEYS: readonly PermissionKey[] = [
  "add_project_party",
  "reassign_project_party",
  "view_org_reports",
];

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
