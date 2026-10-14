-- JAGS Admin accepts an approved ITP on the client's behalf (client has no party login, or accepted
-- by email / signed document). Requires an external reference and a reason; records who/when/why.
-- Idempotent. Rollback: drop function public.accept_itp_on_behalf(uuid, text, text);
--   alter table public.itps drop column accepted_on_behalf, drop column accepted_on_behalf_reference,
--   drop column accepted_on_behalf_reason, drop column accepted_on_behalf_by;
alter table public.itps
  add column if not exists accepted_on_behalf boolean not null default false,
  add column if not exists accepted_on_behalf_reference text,
  add column if not exists accepted_on_behalf_reason text,
  add column if not exists accepted_on_behalf_by uuid references public.users (id) on delete set null;

create or replace function public.accept_itp_on_behalf(target_itp_id uuid, p_reference text, p_reason text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  itp_org uuid;
  itp_project uuid;
  itp_no text;
  needs_approval boolean;
  ref text := btrim(coalesce(p_reference, ''));
  why text := btrim(coalesce(p_reason, ''));
begin
  if auth.uid() is null or not public.is_admin_staff() then
    raise exception 'Only a JAGS Admin can accept an ITP on the client''s behalf' using errcode = '42501';
  end if;
  if length(ref) < 5 then
    raise exception 'An external reference (email or signed document reference, at least 5 characters) is required';
  end if;
  if length(why) < 10 then
    raise exception 'A reason (at least 10 characters) is required';
  end if;

  select p.organization_id, p.id, i.itp_number, coalesce(i.revision_needs_approval, false)
    into itp_org, itp_project, itp_no, needs_approval
  from public.itps i join public.projects p on p.id = i.project_id
  where i.id = target_itp_id;

  if itp_org is null then
    raise exception 'ITP not found';
  end if;
  if needs_approval then
    raise exception 'This ITP has a revision awaiting approval — it can be accepted once that revision is approved';
  end if;

  update public.itps
  set status = 'client_accepted', client_accepted_by = auth.uid(), client_accepted_at = now(),
      client_accepted_revision = revision,
      accepted_on_behalf = true, accepted_on_behalf_reference = left(ref, 500),
      accepted_on_behalf_reason = left(why, 2000), accepted_on_behalf_by = auth.uid(),
      external_approval_reference = coalesce(external_approval_reference, left(ref, 500)),
      external_approval_recorded_by = coalesce(external_approval_recorded_by, auth.uid()),
      external_approval_recorded_at = coalesce(external_approval_recorded_at, now())
  where id = target_itp_id and status = 'approved';

  if not found then
    raise exception 'ITP must be approved before it can be accepted';
  end if;

  insert into public.audit_log (organization_id, project_id, entity_type, entity_id, action, actor_id, summary, changes)
  values (itp_org, itp_project, 'itp', target_itp_id, 'accepted_on_behalf', auth.uid(),
          left('ITP ' || itp_no || ' accepted on the client''s behalf (ref ' || ref || ')', 2000),
          jsonb_build_object('reference', ref, 'reason', why));
end;
$$;

revoke all on function public.accept_itp_on_behalf(uuid, text, text) from public, anon;
grant execute on function public.accept_itp_on_behalf(uuid, text, text) to authenticated;
