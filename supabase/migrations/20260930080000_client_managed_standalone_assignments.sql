-- Closes a real gap in the "Full Client-Managed" tier: Standalone Assignments (FAT/witness
-- inspection/specific test/pre-shipment) were left hardcoded JAGS-staff-only everywhere, with no
-- exception for any engagement tier — contradicting the whole point of client_managed ("zero JAGS
-- staff involvement in day-to-day work"). Adds a 3rd CLIENT_MANAGED_ONLY_PERMISSION_KEY,
-- run_standalone_assignment, mirroring approve_itp/provision_party_login exactly: grantable only on
-- a client_managed org's own role, never a plain self_managed ("Hybrid") one, and the actual
-- enforcement lives in the app layer (lib/standalone/actions.ts) plus this migration's one real
-- DB-side widening below.

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
    'close_punch_item',
    'run_standalone_assignment'
  ));

-- The one real DB-layer gate that actually hardcodes is_jags_staff() for this feature: the
-- inspection-evidence Storage bucket's insert policy for the standalone/{assignment}/... path
-- (20260916100000_restrict_standalone_photo_upload_to_staff.sql). Widened to also allow a
-- run_standalone_assignment permission holder — otherwise a permission-granted client-managed
-- user's addPhotoAction would pass the app-layer check only to have the actual file upload
-- rejected by Storage RLS before that action ever runs.
drop policy if exists inspection_evidence_insert on storage.objects;
create policy inspection_evidence_insert on storage.objects for insert with check (
  bucket_id = 'inspection-evidence'
  and (
    exists (
      select 1 from public.projects p
      where p.id::text = (storage.foldername(objects.name))[1]
        and has_org_access(p.organization_id)
    )
    or exists (
      select 1 from public.standalone_assignments a join public.projects p on p.id = a.project_id
      where (storage.foldername(objects.name))[1] = 'standalone'
        and a.id::text = (storage.foldername(objects.name))[2]
        and has_org_access(p.organization_id)
        and (is_jags_staff() or has_custom_permission(auth.uid(), 'run_standalone_assignment', a.project_id))
    )
  )
);

-- custom_role_permissions_self_managed_write's WITH CHECK (20260930050000_client_managed_
-- engagement_scope.sql) hardcoded the 2-key client_managed-only allow-list at the time it was
-- written — re-created here with run_standalone_assignment added, otherwise a client_managed org
-- could never actually grant this new permission to its own role despite the check constraint
-- above now allowing the row to exist.
drop policy if exists custom_role_permissions_self_managed_write on public.custom_role_permissions;
create policy custom_role_permissions_self_managed_write on public.custom_role_permissions
  for all
  using (
    exists (
      select 1 from public.custom_roles r
      join public.organizations o on o.id = r.organization_id
      where r.id = custom_role_permissions.role_id
        and o.engagement_scope in ('self_managed', 'client_managed')
        and public.has_org_access(r.organization_id)
    )
  )
  with check (
    exists (
      select 1 from public.custom_roles r
      join public.organizations o on o.id = r.organization_id
      where r.id = custom_role_permissions.role_id
        and o.engagement_scope in ('self_managed', 'client_managed')
        and public.has_org_access(r.organization_id)
    )
    and (
      custom_role_permissions.permission_key in ('add_project_party', 'reassign_project_party', 'view_org_reports')
      or (
        custom_role_permissions.permission_key in ('approve_itp', 'provision_party_login', 'run_standalone_assignment')
        and exists (
          select 1 from public.custom_roles r2
          join public.organizations o2 on o2.id = r2.organization_id
          where r2.id = custom_role_permissions.role_id and o2.engagement_scope = 'client_managed'
        )
      )
    )
  );

-- No other RLS changes needed: standalone_assignments and its child tables (measurements, photos,
-- punch_items, signatures, evidence_documents) were already gated on has_project_access() alone at
-- the DB layer, never is_jags_staff() — the "JAGS staff only" rule for this feature has always been
-- purely an app-layer convention (lib/standalone/actions.ts), so widening that app-layer check is
-- sufficient everywhere except the one Storage policy above.
