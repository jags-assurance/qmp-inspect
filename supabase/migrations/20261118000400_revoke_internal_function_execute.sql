-- Review of callable database functions: close the ones the app never calls through .rpc().
--
-- Method (against the migration files in this repo):
--   * every `.rpc("…")` call in apps/web and worker was listed (insert_checklists_atomic, issue_irn,
--     next_document_sequence, reopen_inspection, close_project, overdue_hold_points, issue_data_book_handover,
--     acknowledge_handover, compile_data_book, withdraw_data_book, record_audit_event, accept_itp,
--     is_register_contributor, has_custom_permission, user_has_org_access, verify_document,
--     vault_file_generated_document). Those keep their existing grants.
--   * RLS helper functions referenced inside CREATE POLICY (has_org_access, is_jags_staff, …) keep
--     EXECUTE for authenticated: policies are evaluated with the caller's privileges.
--   * The functions below are neither. Each is SECURITY DEFINER and is called only from other
--     SECURITY DEFINER functions and triggers, which run as the owner and do not need the caller to hold
--     EXECUTE. Left granted, each is also a public /rest/v1/rpc/<name> endpoint.
--
-- itp_signoff_counts() is left alone: it is SECURITY INVOKER (RLS applies) and meant for signed-in callers.
-- Revokes EXECUTE from PUBLIC, anon and authenticated; service_role keeps it. Idempotent; a name that
-- does not exist yet in an environment is skipped.
--
-- To find anything the files do not show (objects created from the dashboard), run in the SQL editor:
--   select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and p.prokind = 'f' and p.prorettype <> 'trigger'::regtype
--     and has_function_privilege('authenticated', p.oid, 'execute') order by 1;

do $$
declare
  r record;
  internal_only text[] := array[
    'auth_user_is_usable', 'background_jobs_resolve_org_id', 'can_close_ncr', 'can_execute_itp_item',
    'can_work_ncr', 'compute_itp_phase', 'data_book_gate_failures', 'inspection_completion_blocker',
    'inspection_record_is_completed', 'is_party_user', 'is_team_lead_for_project', 'item_has_open_hold',
    'itp_item_project_id', 'project_is_writable', 'seed_default_intervention_levels'
  ];
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = any (internal_only)
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;
end
$$;
