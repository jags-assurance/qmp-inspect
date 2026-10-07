-- S7-26: email transmittals. Staff email a link to an ISSUED document (an approved vault document or an
-- issued Data Book) to people outside the app, and every send is logged. Idempotent; additive.
--
--  1. document_transmittals: one row per (send, recipient) - who sent what to whom, when, and whether
--     the email went out. JAGS staff with access to the project can read and insert (the insert policy
--     also checks the document really belongs to the project and is issued/approved). There is no
--     update or delete policy: delivery status is written by the service role (the web app's after()
--     path and the worker) only, so a log row cannot be edited or removed through the API.
--  2. email_outbox (20261104000300) was notification-only (notification_id + recipient_user_id NOT
--     NULL). It now also carries transmittals: both columns become nullable, and recipient_email,
--     subject, body_html and transmittal_id are added. A check keeps every row either a notification
--     or a transmittal. The existing notification flow is unchanged.
--
-- Requires has_project_access() / is_jags_staff() and email_outbox. Does not edit earlier migrations.

create table if not exists public.document_transmittals (
  id uuid primary key default gen_random_uuid(),
  -- All rows created by one "send" share a batch id.
  batch_id uuid not null,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  entity_type text not null check (entity_type in ('vault_document', 'data_book')),
  entity_id uuid not null,
  -- What the recipient was told (frozen at send time).
  entity_label text not null check (length(entity_label) between 1 and 300),
  link_path text not null check (link_path like '/%' and link_path not like '//%'),
  recipient_email text not null check (length(recipient_email) between 3 and 254 and recipient_email ~* '^[^@\s<>,;]+@[^@\s<>,;]+\.[^@\s<>,;]+$'),
  subject text not null check (length(subject) between 1 and 300),
  message text check (message is null or length(message) <= 2000),
  status text not null default 'queued' check (status in ('queued', 'sent', 'failed')),
  last_error text,
  sent_by uuid not null references public.users (id),
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create index if not exists document_transmittals_entity_idx on public.document_transmittals (entity_type, entity_id, created_at desc);
create index if not exists document_transmittals_project_idx on public.document_transmittals (project_id, created_at desc);
create index if not exists document_transmittals_batch_idx on public.document_transmittals (batch_id);

alter table public.document_transmittals enable row level security;

drop policy if exists document_transmittals_select on public.document_transmittals;
create policy document_transmittals_select on public.document_transmittals for select using (
  public.is_jags_staff() and public.has_project_access(project_id, organization_id)
);

drop policy if exists document_transmittals_insert on public.document_transmittals;
create policy document_transmittals_insert on public.document_transmittals for insert with check (
  sent_by = auth.uid()
  and status = 'queued'
  and public.is_jags_staff()
  and public.has_project_access(project_id, organization_id)
  and exists (select 1 from public.projects p where p.id = project_id and p.organization_id = document_transmittals.organization_id)
  and (
    (
      entity_type = 'vault_document'
      and exists (
        select 1 from public.vault_documents d join public.vault_folders f on f.id = d.folder_id
        where d.id = entity_id and f.project_id = document_transmittals.project_id and d.status = 'approved'
      )
    )
    or (
      entity_type = 'data_book'
      and exists (
        select 1 from public.data_books b
        where b.id = entity_id and b.project_id = document_transmittals.project_id and b.status = 'issued'
      )
    )
  )
);

-- ===== email_outbox: transmittal rows =====
alter table public.email_outbox alter column notification_id drop not null;
alter table public.email_outbox alter column recipient_user_id drop not null;

alter table public.email_outbox
  add column if not exists recipient_email text,
  add column if not exists subject text,
  add column if not exists body_html text,
  add column if not exists transmittal_id uuid references public.document_transmittals (id) on delete cascade;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.email_outbox'::regclass and conname = 'email_outbox_kind_check'
  ) then
    alter table public.email_outbox
      add constraint email_outbox_kind_check
      check (
        (notification_id is not null and recipient_user_id is not null)
        or (transmittal_id is not null and recipient_email is not null and subject is not null and body_html is not null)
      );
  end if;
end
$$;

create unique index if not exists email_outbox_transmittal_uidx on public.email_outbox (transmittal_id) where transmittal_id is not null;
create index if not exists email_outbox_transmittal_due_idx on public.email_outbox (next_attempt_at)
  where status = 'pending' and transmittal_id is not null;

comment on table public.document_transmittals is
  'Log of issued documents / Data Books emailed to external recipients (S7-26). One row per recipient.';
