-- Closes a real gap: closing a punch list item was a single unrestricted step — anyone with
-- project access could close ANY item (including one they themselves caused) just by typing any
-- text into "closing evidence," no independent check at all. That's the same self-certification
-- problem this app already avoids for NCR close-out, vault-document approval, and IRN issuance.
--
-- Adds a real middle state: 'resolved'. The person who did the fix marks it resolved (evidence of
-- the fix still required, same as before) — but closing it now requires a SEPARATE, independently-
-- gated step: a JAGS Admin, or someone specifically granted the new close_punch_item custom-role
-- permission, must verify and close it. "Anyone with project access can raise/mark-resolved an
-- item" is unchanged (still not staff-only, still just tenant isolation at the RLS layer) — only
-- the final close is now narrower, enforced at the app layer (closePunchItemAction), same
-- "RLS = tenant isolation, app layer = the real narrowing" split this app already documents for
-- approveVaultDocumentAction.

alter table public.punch_list_items
  drop constraint if exists punch_list_items_status_check,
  add constraint punch_list_items_status_check check (status in ('open', 'resolved', 'closed')),
  add column if not exists resolved_by uuid references public.users (id),
  add column if not exists resolved_at timestamptz,
  add column if not exists verification_notes text;

comment on column public.punch_list_items.closing_evidence is
  'What was done to fix it — recorded by whoever marked the item resolved (step 1 of 2), not the verifier.';
comment on column public.punch_list_items.verification_notes is
  'The independent verifier''s own notes at the verify-and-close step (step 2 of 2) — distinct from closing_evidence.';

-- Extend the fixed custom-role permission set (lib/rbac/types.ts's PERMISSION_KEYS is the single
-- source of truth this mirrors) with the new gate. Deliberately NOT added to
-- custom_role_permissions_self_managed_write's grantable-by-a-client allow-list (that policy's
-- WITH CHECK only lists specific permission_keys, so a new key is admin-grantable-only by default,
-- no RLS change needed here) — closing your own punch item without independent review is the same
-- self-certification concern as close_ncr/issue_irn/approve_vault_document, so it stays in that
-- same JAGS-Admin-grantable-only bucket regardless of engagement tier (self_managed or
-- client_managed alike).
alter table public.custom_role_permissions
  drop constraint if exists custom_role_permissions_permission_key_check,
  add constraint custom_role_permissions_permission_key_check check (permission_key in (
    'add_project_party',
    'reassign_project_party',
    'manage_intervention_levels',
    'issue_irn',
    'close_ncr',
    'view_org_reports',
    'approve_vault_document',
    'approve_itp',
    'provision_party_login',
    'close_punch_item'
  ));

-- No RLS policy changes: punch_list_items_write_u (20260922000200_consolidate_permissive_policies_
-- tier1.sql) already allows any has_project_access() caller to update ANY column including status
-- — same as it always has. The real narrowing (resolved-only viewers can't jump straight to
-- 'closed'; only an admin/close_punch_item holder's closePunchItemAction call actually writes
-- status='closed') lives entirely in the app layer, exactly like approveVaultDocumentAction's own
-- documented precedent.
