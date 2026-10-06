-- Security hardening: pin search_path on remaining trigger functions and lock down EXECUTE.
-- Idempotent. Triggers fire regardless of EXECUTE privilege, so trigger functions are closed to all API roles.

alter function public.set_updated_at() set search_path = public, pg_temp;
alter function public.set_organization_module_licenses_updated_at() set search_path = public, pg_temp;
alter function public.itp_items_protect_history() set search_path = public, pg_temp;
alter function public.itps_guard_status_transition() set search_path = public, pg_temp;
alter function public.touch_itp_updated_at() set search_path = public, pg_temp;
alter function public.material_register_guard_release() set search_path = public, pg_temp;
alter function public.checklist_responses_touch() set search_path = public, pg_temp;
alter function public.punch_list_items_guard_transition() set search_path = public, pg_temp;
alter function public.ncrs_enforce_workflow() set search_path = public, pg_temp;
alter function public.data_books_set_revision() set search_path = public, pg_temp;
alter function public.data_books_block_issued_edit() set search_path = public, pg_temp;

do $$
declare
  fn text;
  trigger_fns text[] := array[
    'set_updated_at()','set_organization_module_licenses_updated_at()','itp_items_protect_history()',
    'itps_guard_status_transition()','touch_itp_updated_at()','material_register_guard_release()',
    'checklist_responses_touch()','punch_list_items_guard_transition()','ncrs_enforce_workflow()',
    'data_books_set_revision()','data_books_block_issued_edit()','check_client_team_project_same_org()',
    'create_default_intervention_levels()','create_default_organization_plan()','create_default_vault_folders()',
    'enforce_access_grants_org_seat_limit()','enforce_background_jobs_org_rate_limit()','guard_must_change_password()',
    'handle_new_activity_party_intervention()','handle_new_auth_user()','inspection_photos_guard()',
    'prevent_intervention_level_type_code_change_in_use()','prevent_intervention_level_type_removal()',
    'restrict_self_managed_org_update()','rls_auto_enable()','sync_itp_phase_from_intervention_level_types()',
    'sync_itp_phase_from_signoff()','sync_itp_phase_on_status_change()','validate_activity_intervention_code()',
    'validate_notice_period_intervention_code()','vault_documents_guard_approval()','vault_documents_guard_immutable()',
    'background_jobs_resolve_org_id(text, jsonb)','seed_default_intervention_levels(uuid)'
  ];
  signed_in_fns text[] := array[
    'accept_itp(uuid)','acknowledge_handover(uuid, text, text)','can_bootstrap_client_team(uuid)',
    'can_bootstrap_client_team_members(uuid)','compute_itp_phase(uuid)','has_custom_permission(uuid, text, uuid)',
    'has_org_access(uuid)','has_org_wide_access(uuid)','has_project_access(uuid, uuid)','insert_checklists_atomic(jsonb)',
    'is_admin_staff()','is_client_checklist_generator(uuid, text)','is_client_itp_creator(uuid, text)',
    'is_client_team_lead_of(uuid)','is_jags_staff()','is_register_contributor(uuid)','is_team_lead_of(uuid)',
    'next_document_sequence(uuid, uuid, text)','overdue_hold_points()','user_has_org_access(uuid, uuid)'
  ];
begin
  foreach fn in array trigger_fns loop
    if to_regprocedure('public.' || fn) is not null then
      execute format('revoke execute on function public.%s from public, anon, authenticated', fn);
      execute format('grant execute on function public.%s to service_role', fn);
    end if;
  end loop;
  -- Helpers used by RLS policies and RPCs: signed-in users only (never anon).
  foreach fn in array signed_in_fns loop
    if to_regprocedure('public.' || fn) is not null then
      execute format('revoke execute on function public.%s from public, anon', fn);
      execute format('grant execute on function public.%s to authenticated, service_role', fn);
    end if;
  end loop;
end $$;
