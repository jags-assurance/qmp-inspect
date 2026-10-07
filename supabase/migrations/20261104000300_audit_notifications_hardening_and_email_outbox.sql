-- S1-05 / E-01 (forgeable audit trail), S1-06 / E-02 / E-03 (spoofable notifications), F-02 (email
-- reliability), F-03 (audit_log indexes).
--
-- Audit: audit_log_insert only checked org access, so any user with a grant in an organisation could
-- insert rows with any actor_id / summary ("NCR closed by <staff member>"). Rows are now written
-- through record_audit_event(), a SECURITY DEFINER function that forces actor_id = auth.uid() and
-- checks project/org access itself; the direct-insert policy additionally requires
-- actor_id = auth.uid() so the old path can no longer impersonate anyone either.
--
-- Notifications: notifications_insert let any project member insert for ANY recipient with any title,
-- body and link (internal phishing; the bell does router.push(link)). The policy now requires that
-- the recipient actually has access to the same project/org, is active, and that the link is a
-- same-site path. sender_user_id records who created the row (forced by trigger).
--
-- Email outbox: every notification enqueues an email_outbox row (service role only). The web app
-- sends immediately via after() and marks the row sent; anything it could not send (function frozen,
-- no service key, provider error) and everything the worker writes itself (overdue nudges) is sent by
-- the worker with retries. next_attempt_at gives the immediate path a short head start.
-- Idempotent: safe to re-run.

-- ---------------------------------------------------------------------------------------------
-- Audit
-- ---------------------------------------------------------------------------------------------
create or replace function public.record_audit_event(
  p_organization_id uuid,
  p_project_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_action text,
  p_summary text,
  p_changes jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid := p_organization_id;
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'Audit events must be written by a signed-in user.' using errcode = '42501';
  end if;
  if p_entity_type is null or p_action is null or p_summary is null or p_entity_id is null then
    raise exception 'Audit event is missing required fields.' using errcode = '22023';
  end if;

  if p_project_id is not null then
    select organization_id into v_org from public.projects where id = p_project_id;
    if v_org is null then
      raise exception 'Unknown project for audit event.' using errcode = '22023';
    end if;
    if not public.has_project_access(p_project_id, v_org) then
      raise exception 'No access to that project.' using errcode = '42501';
    end if;
  elsif v_org is not null then
    if not public.has_org_access(v_org) then
      raise exception 'No access to that organisation.' using errcode = '42501';
    end if;
  else
    -- Platform-wide event: JAGS staff only, plus a user's own authentication events.
    if not (public.is_jags_staff() or (p_entity_type = 'auth' and p_entity_id = v_uid)) then
      raise exception 'Platform-wide audit events are staff-only.' using errcode = '42501';
    end if;
  end if;

  insert into public.audit_log (organization_id, project_id, entity_type, entity_id, action, actor_id, summary, changes)
  values (v_org, p_project_id, left(p_entity_type, 100), p_entity_id, left(p_action, 100), v_uid, left(p_summary, 2000), p_changes)
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.record_audit_event(uuid, uuid, text, uuid, text, text, jsonb) from public, anon;
grant execute on function public.record_audit_event(uuid, uuid, text, uuid, text, text, jsonb) to authenticated;

drop policy if exists audit_log_insert on public.audit_log;
create policy audit_log_insert on public.audit_log
  for insert to authenticated
  with check (
    actor_id = (select auth.uid())
    and (
      (organization_id is not null and public.has_org_access(organization_id))
      or (organization_id is null and public.is_jags_staff())
    )
  );

create index if not exists audit_log_project_created_idx on public.audit_log (project_id, created_at desc);
create index if not exists audit_log_org_created_idx on public.audit_log (organization_id, created_at desc);

-- ---------------------------------------------------------------------------------------------
-- Notifications
-- ---------------------------------------------------------------------------------------------
alter table public.notifications add column if not exists sender_user_id uuid default auth.uid();

create or replace function public.notifications_set_sender()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  new.sender_user_id := auth.uid();  -- null for the worker / service role
  return new;
end;
$$;

drop trigger if exists notifications_set_sender on public.notifications;
create trigger notifications_set_sender
  before insert on public.notifications
  for each row execute function public.notifications_set_sender();

revoke all on function public.notifications_set_sender() from public, anon, authenticated;

-- Same-site path only (a leading single "/", no protocol-relative "//" or "/\"). NOT VALID so a
-- historical row can never block the migration; every new row is checked.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'notifications_link_same_site') then
    alter table public.notifications
      add constraint notifications_link_same_site
      check (link is null or link ~ '^/([^/\\]|$)') not valid;
  end if;
end $$;

-- Does a given user (not the caller) have access to a project / organisation? SECURITY DEFINER so
-- the notification policy can ask about the recipient without reading their grants itself.
create or replace function public.user_has_project_access(target_user_id uuid, target_project_id uuid, target_org_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.users u where u.id = target_user_id and u.is_active)
    and exists (
      select 1 from public.access_grants
      where user_id = target_user_id
        and (
          scope_type = 'global'
          or (scope_type = 'organization' and organization_id = target_org_id)
          or (scope_type = 'project' and project_id = target_project_id)
        )
    );
$$;

revoke all on function public.user_has_project_access(uuid, uuid, uuid) from public, anon;
grant execute on function public.user_has_project_access(uuid, uuid, uuid) to authenticated;

drop policy if exists notifications_insert on public.notifications;
create policy notifications_insert on public.notifications
  for insert to authenticated
  with check (
    (link is null or link ~ '^/([^/\\]|$)')
    and (
      (project_id is null
        and public.has_org_access(organization_id)
        and public.user_has_org_access(recipient_user_id, organization_id)
        and exists (select 1 from public.users u where u.id = recipient_user_id and u.is_active))
      or
      (project_id is not null
        and exists (select 1 from public.projects p where p.id = project_id and p.organization_id = notifications.organization_id)
        and public.has_project_access(project_id, organization_id)
        and public.user_has_project_access(recipient_user_id, project_id, organization_id))
    )
  );

-- ---------------------------------------------------------------------------------------------
-- Email outbox
-- ---------------------------------------------------------------------------------------------
create table if not exists public.email_outbox (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null unique references public.notifications (id) on delete cascade,
  recipient_user_id uuid not null references public.users (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'skipped')),
  attempts integer not null default 0,
  last_error text,
  -- Head start for the immediate send from the web app (after()); the worker only picks the row up
  -- if it is still pending after this.
  next_attempt_at timestamptz not null default now() + interval '2 minutes',
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists email_outbox_due_idx on public.email_outbox (next_attempt_at) where status = 'pending';

-- No policies on purpose: only the service role (web after() path and the worker) touches this.
alter table public.email_outbox enable row level security;

create or replace function public.notifications_enqueue_email()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.email_outbox (notification_id, recipient_user_id)
  values (new.id, new.recipient_user_id)
  on conflict (notification_id) do nothing;
  return new;
end;
$$;

drop trigger if exists notifications_enqueue_email on public.notifications;
create trigger notifications_enqueue_email
  after insert on public.notifications
  for each row execute function public.notifications_enqueue_email();

revoke all on function public.notifications_enqueue_email() from public, anon, authenticated;
