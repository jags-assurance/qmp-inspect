-- Turns the minimal ai_usage_log (20260910060000_phase3_ai_usage_log.sql — deliberately "not an
-- audit trail of prompts/responses", by its own comment) into a real one, per a client-provided
-- sample pack's explicit requirement: "store prompt version, model ID, generation time, source
-- document revision/hash, response JSON, reviewer edits, reviewer identity, timestamps and
-- approvals... do not overwrite an AI draft with the reviewed record; keep both for auditability."
--
-- Two real, pre-existing bugs fixed along the way:
-- 1. feature check constraint only ever allowed ('itp_draft', 'ncr_description_draft',
--    'checklist_consistency_check') but apps/web/lib/ai/log.ts's AiFeature type has long since grown
--    to 7 values — every logAiUsage() call for 'checklist_generation', 'report_narrative_draft',
--    'ncr_root_cause_suggestion', or 'standalone_measurement_suggestion' has been silently failing
--    this constraint (caught and swallowed by logAiUsage's own best-effort error handling) since
--    those features were added. Widened to match the real type.
-- 2. RLS was is_jags_staff()-only for ALL operations (select/insert/update), but assertAiAllowed()
--    (lib/ai/gate.ts) is deliberately not staff-gated — any org member with ai_consent can trigger
--    an AI feature — so every AI-usage insert triggered by a non-staff user (e.g. a client drafting
--    an NCR) has also been silently failing RLS this whole time. Widened insert/update to tenant
--    isolation (has_org_access), matching every other shared-work table in this schema (ncrs_write,
--    inspection_records_write, etc.); select stays visible to staff (existing admin usage screen)
--    OR the row's own organisation (so a client can eventually see their own org's AI-assist history).
--
-- New columns:
--   model_id, prompt_version   - which model/prompt template produced this draft
--   source_ref                 - jsonb, feature-specific grounding reference (e.g. vault document
--                                 ids/revisions for an ITP draft) — free-form since "the source" means
--                                 something different per feature
--   ai_response                 - the raw AI draft output, exactly as returned — never edited, this
--                                 is what makes "keep both" possible
--   target_type, target_id     - what entity this draft became, once the human confirms it (null
--                                 until then; some drafts like an ITP don't have a target until
--                                 creation)
--   reviewed_by, reviewed_at   - who confirmed/edited the draft into a real record, and when
--   reviewed_response          - the final, human-approved version (jsonb) — kept SEPARATE from
--                                 ai_response, never overwriting it
--   decision                   - 'accepted_as_is' | 'edited_and_accepted' | 'discarded'

alter table public.ai_usage_log
  add column model_id text,
  add column prompt_version text,
  add column source_ref jsonb,
  add column ai_response jsonb,
  add column target_type text,
  add column target_id uuid,
  add column reviewed_by uuid references public.users (id),
  add column reviewed_at timestamptz,
  add column reviewed_response jsonb,
  add column decision text check (decision in ('accepted_as_is', 'edited_and_accepted', 'discarded'));

alter table public.ai_usage_log drop constraint ai_usage_log_feature_check;
alter table public.ai_usage_log add constraint ai_usage_log_feature_check
  check (feature in (
    'itp_draft',
    'ncr_description_draft',
    'checklist_consistency_check',
    'checklist_generation',
    'report_narrative_draft',
    'ncr_root_cause_suggestion',
    'standalone_measurement_suggestion'
  ));

drop policy ai_usage_log_staff_all on public.ai_usage_log;

create policy ai_usage_log_select on public.ai_usage_log
  for select using (public.is_jags_staff() or public.has_org_access(organization_id));

create policy ai_usage_log_insert on public.ai_usage_log
  for insert with check (public.has_org_access(organization_id));

-- Update is how the review/confirm step attaches reviewed_by/reviewed_at/reviewed_response/decision
-- to the same row the draft was logged on — done by whichever org member confirms the draft, not
-- necessarily the same person who generated it.
create policy ai_usage_log_update on public.ai_usage_log
  for update using (public.has_org_access(organization_id)) with check (public.has_org_access(organization_id));
