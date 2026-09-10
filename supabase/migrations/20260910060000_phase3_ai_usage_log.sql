-- Phase 3: minimal AI usage log (Reqs R34-R43, R82-R84, R108-R111).
--
-- One row per AI feature invocation, written from each AI-calling server action after a successful
-- call (apps/web/lib/ai/log.ts). This is deliberately not an audit trail of prompts/responses — just
-- enough for an ai_consent-gated admin screen (not part of this task) to show usage volume per
-- organisation later. No dashboard UI ships with this migration.
--
-- RLS: staff-only read (internal ops visibility only, matching itp_master_*'s is_jags_staff()-gated
-- pattern) via a single `for all` policy — there is no separate client-facing read path, since a
-- client has no reason to see JAGS's own AI usage accounting.

create table public.ai_usage_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid references public.users (id),
  feature text not null check (feature in ('itp_draft', 'ncr_description_draft', 'checklist_consistency_check')),
  created_at timestamptz not null default now()
);

create index ai_usage_log_organization_id_idx on public.ai_usage_log (organization_id);

alter table public.ai_usage_log enable row level security;

create policy ai_usage_log_staff_all on public.ai_usage_log
  for all using (public.is_jags_staff()) with check (public.is_jags_staff());
