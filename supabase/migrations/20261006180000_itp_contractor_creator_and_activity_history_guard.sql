-- 1. Restore the contractor branch of is_client_itp_creator that the client_managed migration dropped:
--    with allow_contractor_itp_creation on, the page admitted subcontractors/main contractors but the
--    itps / itp_sections / itp_items insert policies (which use this function) refused them.
create or replace function public.is_client_itp_creator(target_project_id uuid, itp_status text default null)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select
    (itp_status is null or itp_status = 'draft')
    and exists (
      select 1 from public.projects p
      join public.organizations o on o.id = p.organization_id
      join public.project_parties pp on pp.project_id = p.id
      where p.id = target_project_id
        and pp.is_active
        and pp.user_id = auth.uid()
        and (
          (pp.party_type = 'client' and (p.allow_client_itp_creation or o.engagement_scope in ('self_managed', 'client_managed')))
          or (pp.party_type in ('subcontractor', 'main_contractor') and p.allow_contractor_itp_creation)
        )
    );
$$;

-- 2. An activity with inspection, sign-off, measurement or evidence history must never be deleted
--    directly: the FKs cascade, so one DELETE would wipe signed Hold/Witness points and inspection
--    records. Direct deletes are blocked; deleting a whole ITP/project (a cascade from a parent,
--    trigger depth > 1) is left to those parents' own rules.
create or replace function public.itp_items_protect_history()
returns trigger language plpgsql as $$
begin
  if pg_trigger_depth() > 1 then
    return old;
  end if;
  if exists (select 1 from public.inspection_records r where r.itp_item_id = old.id)
     or exists (select 1 from public.activity_signoff_progress s where s.itp_item_id = old.id and s.status in ('signed_off', 'proceeded_no_response'))
     or exists (select 1 from public.itp_item_measurements m where m.itp_item_id = old.id and m.actual_value is not null)
     or exists (select 1 from public.itp_item_evidence_documents e where e.itp_item_id = old.id)
     or exists (select 1 from public.activity_expected_records x where x.itp_item_id = old.id and x.received_at is not null) then
    raise exception 'This activity has inspection, sign-off or evidence history and cannot be deleted' using errcode = 'P0001';
  end if;
  return old;
end;
$$;
drop trigger if exists itp_items_protect_history on public.itp_items;
create trigger itp_items_protect_history before delete on public.itp_items
  for each row execute function public.itp_items_protect_history();
