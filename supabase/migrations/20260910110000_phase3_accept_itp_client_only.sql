-- Closes the gap surfaced during the end-to-end walkthrough: accept_itp() only checked
-- has_org_access(), so any non-staff login with access to the project's organisation (a
-- subcontractor, main contractor, or TPI/lab — not just the client) could technically call it, even
-- though the app's own UI only ever showed the "Accept ITP" button to non-staff users in general.
-- Client acceptance is the client's own action on their own party's ITP, the same principle already
-- enforced for intervention-grid sign-off (see canSignOffForParty in lib/signoff/actions.ts) — this
-- makes accept_itp() enforce the equivalent restriction at the database layer: only a login linked
-- via project_parties.user_id to that specific project's 'client' party row can accept.
create or replace function public.accept_itp(target_itp_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  itp_org uuid;
  itp_project uuid;
  is_linked_client boolean;
begin
  select o.id, p.id into itp_org, itp_project
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

  select exists (
    select 1 from public.project_parties
    where project_id = itp_project
      and party_type = 'client'
      and user_id = auth.uid()
  ) into is_linked_client;

  if not is_linked_client then
    raise exception 'Only the client party''s own login can accept this ITP';
  end if;

  update public.itps
  set status = 'client_accepted', client_accepted_by = auth.uid(), client_accepted_at = now()
  where id = target_itp_id and status = 'approved';

  if not found then
    raise exception 'ITP must be approved before it can be accepted';
  end if;
end;
$$;
