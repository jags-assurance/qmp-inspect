-- Tier-independent counterpart to run_standalone_assignment (client_managed-only custom
-- permission, 20260930080000_client_managed_standalone_assignments.sql): a subcontractor or
-- main_contractor party is routinely the one who actually runs a FAT/witness inspection/specific
-- test/pre-shipment check on equipment they supplied, on ANY engagement tier — not just a
-- client_managed one. Mirrors allow_contractor_itp_creation exactly (same per-project, Admin-only
-- opt-in shape).

alter table public.projects
  add column if not exists allow_contractor_standalone_assignment boolean not null default false;

-- No RLS change needed: standalone_assignments and its child tables were already gated on
-- has_project_access() alone at the DB layer (see 20260930080000's own note) — this flag is
-- consumed purely at the app layer, in canRunStandaloneAssignment (lib/standalone/actions.ts),
-- exactly like allow_contractor_itp_creation is consumed by is_client_itp_creator/app-layer checks
-- rather than a dedicated RLS branch of its own.
