-- Phase 5: real in-app notifications, replacing the "Notify" button's previous behavior of only
-- recording a timestamp (see the pre-existing comment on notifyPartyAction in
-- lib/signoff/actions.ts: "Real notification delivery ... is a future integration point"). This is
-- that integration: a durable row per recipient, pushed live via Supabase Realtime so another
-- party's browser updates without a manual reload — the actual mechanism multi-party sign-off needs
-- to feel real rather than "click Notify and hope they check back later".

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  -- Denormalized alongside recipient_user_id (not derived via a join) so the RLS insert policy can
  -- check org access without needing to already know who the recipient is scoped to — matches the
  -- has_org_access(organization_id) pattern used everywhere else in this schema.
  organization_id uuid not null references public.organizations (id) on delete cascade,
  project_id uuid references public.projects (id) on delete cascade,
  recipient_user_id uuid not null references public.users (id) on delete cascade,
  title text not null,
  body text,
  -- App-relative path the notification should navigate to when clicked, e.g. "/inspect/itps/{id}".
  link text,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create index notifications_recipient_idx on public.notifications (recipient_user_id, is_read, created_at desc);

alter table public.notifications enable row level security;

-- A user only ever sees their own notifications — this is the one place in the schema where
-- "recipient" rather than "organization access" is the isolation boundary, since two people with
-- access to the same org/project should not see each other's personal notification feed.
create policy notifications_select on public.notifications
  for select using (recipient_user_id = auth.uid());

-- Deliberately not "insert your own row only": the whole point is one user (the one clicking
-- Notify, or a server action reacting to a status change) creating a notification FOR a different
-- user. The safety boundary is org access to the notification's own organization_id, same as every
-- other write policy in this schema keyed off has_org_access() — a caller can only ever notify
-- someone within an organization they themselves can already see.
create policy notifications_insert on public.notifications
  for insert to authenticated
  with check (public.has_org_access(organization_id));

-- A recipient can mark their own notification read - nothing else about it is editable by anyone.
create policy notifications_update on public.notifications
  for update using (recipient_user_id = auth.uid())
  with check (recipient_user_id = auth.uid());

-- Makes this table's inserts/updates push to subscribed clients in real time (Supabase's Realtime
-- Postgres Changes feature) - without this, the table would work but rows would only ever appear on
-- the next manual page load, defeating the purpose.
alter publication supabase_realtime add table public.notifications;
