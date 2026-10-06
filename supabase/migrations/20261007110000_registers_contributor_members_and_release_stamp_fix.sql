-- A party can have several people (project_party_members), not just the primary contact.
create or replace function public.is_register_contributor(target_project_id uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from public.project_parties pp
    where pp.project_id = target_project_id
      and pp.is_active
      and pp.party_type in ('main_contractor', 'subcontractor', 'tpi_lab')
      and (
        pp.user_id = auth.uid()
        or exists (select 1 from public.project_party_members m where m.project_party_id = pp.id and m.user_id = auth.uid())
      )
  );
$$;

-- Release stamp: set when a material becomes released (insert or update), cleared when it stops being released.
create or replace function public.material_register_guard_release()
returns trigger language plpgsql as $$
begin
  if auth.uid() is not null and not public.is_jags_staff() then
    if tg_op = 'INSERT' then
      new.receipt_status := 'received_pending_inspection';
    elsif new.receipt_status is distinct from old.receipt_status then
      raise exception 'Only JAGS staff can change a material''s receipt status' using errcode = '42501';
    end if;
  end if;

  if new.receipt_status = 'released' and (tg_op = 'INSERT' or old.receipt_status is distinct from 'released') then
    new.released_by := coalesce(auth.uid(), new.released_by);
    new.released_at := now();
  elsif new.receipt_status <> 'released' then
    new.released_by := null;
    new.released_at := null;
  end if;
  return new;
end;
$$;
