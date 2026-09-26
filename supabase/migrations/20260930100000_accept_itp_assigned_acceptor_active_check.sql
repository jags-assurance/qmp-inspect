-- Real gap found in audit: accept_itp()'s assigned-acceptor branch (20260930040000) only checked
-- auth.uid() = assigned_acceptor plus org access — it never re-checked that this login is STILL an
-- active client party on the project. If a client reviewer is later deactivated or removed from the
-- project but a JAGS Admin forgets to clear itps.assigned_acceptor_user_id, that person keeps a live
-- "accept this ITP" credential indefinitely. Mirrors the same is_active check the no-assignment
-- branch already implies through project_parties existence.
create or replace function public.accept_itp(target_itp_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  itp_org uuid;
  itp_project uuid;
  assigned_acceptor uuid;
  is_linked_client boolean;
  acceptor_still_active boolean;
begin
  select o.id, p.id, i.assigned_acceptor_user_id into itp_org, itp_project, assigned_acceptor
  from public.itps i
  join public.projects p on p.id = i.project_id
  join public.organizations o on o.id = p.organization_id
  where i.id = target_itp_id;

  if itp_org is null then
    raise exception 'ITP not found';
  end if;

  if not public.has_org_access(itp_org) then
    raise exception 'Not authorized for this organisation';
  end if;

  if assigned_acceptor is not null then
    if auth.uid() != assigned_acceptor then
      raise exception 'Only this ITP''s assigned acceptor can accept it';
    end if;

    select exists (
      select 1 from public.project_parties
      where project_id = itp_project
        and party_type = 'client'
        and user_id = assigned_acceptor
        and is_active
    ) into acceptor_still_active;

    if not acceptor_still_active then
      raise exception 'The assigned acceptor is no longer an active client party on this project — a JAGS Admin must reassign or clear the acceptor before this ITP can be accepted';
    end if;
  else
    select exists (
      select 1 from public.project_parties
      where project_id = itp_project
        and party_type = 'client'
        and user_id = auth.uid()
        and is_active
    ) into is_linked_client;

    if not is_linked_client then
      raise exception 'Only the client party''s own login can accept this ITP';
    end if;
  end if;

  update public.itps
  set status = 'client_accepted', client_accepted_by = auth.uid(), client_accepted_at = now()
  where id = target_itp_id and status = 'approved';

  if not found then
    raise exception 'ITP must be approved before it can be accepted';
  end if;
end;
$$;
