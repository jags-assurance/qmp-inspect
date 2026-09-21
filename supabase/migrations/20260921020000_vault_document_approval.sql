-- Closes a real gap: vault_documents.status already supported 'for_review'/'approved'/'superseded'
-- (20260910010000_phase2_document_vault.sql) but no action anywhere ever moved a document from
-- 'for_review' to 'approved' — every uploaded document was stuck at "For review" forever, with no
-- button, no server action, nothing. This adds the missing approval step plus a real audit trail
-- (who approved it, when), the same shape every other approval act in this app already has
-- (itps.approved_by/approved_at, ncrs.closed_by/closed_at).

alter table public.vault_documents
  add column approved_by uuid references public.users (id),
  add column approved_at timestamptz;

-- Extend the fixed custom-role permission set (lib/rbac/types.ts's PERMISSION_KEYS is the single
-- source of truth this mirrors) with the new gate. Approving a vault document is "high authority"
-- by default (JAGS Admin) but delegatable per person via a custom role, same model as
-- issue_irn/close_ncr — and, like those, deliberately NOT added to the self-managed client's own
-- grantable subset (custom_role_permissions_self_managed_write,
-- 20260919030000_self_managed_custom_role_management.sql, already enumerates its own allowed keys
-- explicitly, so it does not need changing to keep excluding this one).
alter table public.custom_role_permissions
  drop constraint custom_role_permissions_permission_key_check,
  add constraint custom_role_permissions_permission_key_check check (permission_key in (
    'add_project_party',
    'reassign_project_party',
    'manage_intervention_levels',
    'issue_irn',
    'close_ncr',
    'view_org_reports',
    'approve_vault_document'
  ));

-- The existing vault_documents_update policy (has_project_access, no staff/role check) already
-- covers this write at the RLS layer — same relationship every other custom-role-gated action in
-- this app has to its own table's RLS (the app-layer check in approveVaultDocumentAction is what
-- actually narrows who can call it; RLS's job here is only tenant isolation, not the finer-grained
-- "which specific project-access-holder" question, matching add_project_party's own policy).
