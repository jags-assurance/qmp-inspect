-- Audit DB fixes (docs/audit: documents-closeout H1, setup-access H1, itp-lifecycle H2).
-- ROLLBACK NOTE: (1) restore verify_document from 20261206000100's predecessor (status case without 'rejected');
--   (2) re-create numbering_configs_i/u/d and custom_roles_i/u/d with the old has_org_access() self_managed branch
--       (see pg_policies history / earlier migrations) - NOT recommended, it re-opens the hole;
--   (3) drop trigger activity_party_intervention_block_terminal and function itp_intervention_block_terminal().
-- Idempotent: safe to re-run.

-- ---------------------------------------------------------------------------------------------
-- (1) A client-rejected handover certificate must never verify as genuine.
-- Same JSON shape as before; for a rejected certificate valid=false and status='rejected'
-- (rejected wins over superseded/acknowledged). number is kept so the page can name the document.
-- ---------------------------------------------------------------------------------------------
create or replace function public.verify_document(p_kind text, p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v jsonb;
begin
  if p_token is null or length(p_token) < 32 or length(p_token) > 128 or p_token !~ '^[0-9a-f]+$' then
    return jsonb_build_object('valid', false);
  end if;
  if p_kind = 'certificate' then
    select jsonb_build_object(
             'valid', hc.rejected_at is null, 'kind', 'handover_certificate',
             'number', hc.certificate_number,
             'status', case when hc.rejected_at is not null then 'rejected'
                            when hc.superseded_at is not null then 'superseded'
                            when hc.acknowledged_at is not null then 'acknowledged' else 'issued' end,
             'issued_date', hc.issued_date,
             'conditional', coalesce(hc.is_conditional, false),
             'package_sha256', hc.package_sha256,
             'data_book_sha256', hc.rendered_book_sha256,
             'pdf_sha256s', to_jsonb(hc.rendered_pdf_sha256s))
      into v
      from public.handover_certificates hc where hc.verification_token = p_token;
  elsif p_kind = 'irn' then
    select jsonb_build_object(
             'valid', true, 'kind', 'irn',
             'number', i.irn_number,
             'status', case when i.voided_at is not null then 'void' else 'live' end,
             'issued_date', i.release_date,
             'voided_at', i.voided_at,
             'pdf_sha256s', to_jsonb(i.rendered_pdf_sha256s))
      into v
      from public.irns i where i.verification_token = p_token;
  end if;
  return coalesce(v, jsonb_build_object('valid', false));
end;
$function$;

-- ---------------------------------------------------------------------------------------------
-- (2) numbering_configs / custom_roles: the legacy *_i/_u/_d policies let any has_org_access() user
-- (including project-scoped subcontractor/vendor/TPI grants) write in self-managed orgs; permissive
-- policies OR together, defeating *_self_managed_write (has_org_wide_access, migration
-- 20261005090000_org_settings_require_org_wide_grant). Keep the legacy names but remove the
-- self-managed branch, leaving only the JAGS staff branch (so staff on full_service orgs still work).
-- Org-wide self-managed/client-managed users are covered by *_self_managed_write.
-- ---------------------------------------------------------------------------------------------
drop policy if exists custom_roles_i on public.custom_roles;
drop policy if exists custom_roles_u on public.custom_roles;
drop policy if exists custom_roles_d on public.custom_roles;
create policy custom_roles_i on public.custom_roles for insert to public with check (is_admin_staff());
create policy custom_roles_u on public.custom_roles for update to public using (is_admin_staff()) with check (is_admin_staff());
create policy custom_roles_d on public.custom_roles for delete to public using (is_admin_staff());

drop policy if exists numbering_configs_i on public.numbering_configs;
drop policy if exists numbering_configs_u on public.numbering_configs;
drop policy if exists numbering_configs_d on public.numbering_configs;
create policy numbering_configs_i on public.numbering_configs for insert to public
  with check (is_jags_staff() and has_org_access(organization_id));
create policy numbering_configs_u on public.numbering_configs for update to public
  using (is_jags_staff() and has_org_access(organization_id))
  with check (is_jags_staff() and has_org_access(organization_id));
create policy numbering_configs_d on public.numbering_configs for delete to public
  using (is_jags_staff() and has_org_access(organization_id));

-- ---------------------------------------------------------------------------------------------
-- (3) ITP read-only on the server. itp_sections and itp_items already carry
-- itp_*_block_terminal (migration 20261107000100). The only remaining content table is the
-- per-activity party intervention (H/W/R/S) table, which had no guard. Same rule: refuse when the
-- parent ITP is superseded/withdrawn; under_review is NOT locked (the app allows edits there);
-- cascades (pg_trigger_depth() > 1) and system callers pass. activity_signoff_progress and
-- execution tables (evidence, measurements, inspections) are deliberately not touched.
-- ---------------------------------------------------------------------------------------------
create or replace function public.itp_intervention_block_terminal()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_item uuid := coalesce(new.itp_item_id, old.itp_item_id);
  v_status text;
  v_number text;
begin
  if pg_trigger_depth() > 1 or public.is_system_caller() then
    return coalesce(new, old);
  end if;
  select p.status, p.itp_number into v_status, v_number
    from public.itp_items i
    join public.itp_sections s on s.id = i.section_id
    join public.itps p on p.id = s.itp_id
   where i.id = v_item;
  if v_status in ('superseded', 'withdrawn') then
    raise exception 'ITP % is % and is read-only', v_number, v_status using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end;
$$;
revoke all on function public.itp_intervention_block_terminal() from public, anon, authenticated;

drop trigger if exists activity_party_intervention_block_terminal on public.activity_party_intervention;
create trigger activity_party_intervention_block_terminal
  before insert or update or delete on public.activity_party_intervention
  for each row execute function public.itp_intervention_block_terminal();
