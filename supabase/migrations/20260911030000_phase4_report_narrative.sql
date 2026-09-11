-- Phase 4: report-narrative drafting (R111 — "draft inspection narratives... and report
-- conclusions", one of several AI assists the requirements call for that this build hadn't wired
-- up yet). A `narrative` column on the two report-bearing tables holds the human-approved text;
-- the PDF templates use it as the report's conclusion paragraph when present, falling back to
-- their own deterministic, template-built sentence otherwise (never AI text with no human review
-- between generation and issue).

alter table public.inspection_records add column narrative text;
alter table public.standalone_assignments add column narrative text;

comment on column public.inspection_records.narrative is
  'Optional AI-drafted (or hand-written), human-approved executive summary used as the Inspection Report PDF''s conclusion. Null falls back to the template''s own factual sentence.';
comment on column public.standalone_assignments.narrative is
  'Optional AI-drafted (or hand-written), human-approved executive summary used as the FAT Report PDF''s conclusion. Null falls back to the template''s own factual sentence.';

-- New ai_usage_log feature value alongside the four already tracked (itp_draft,
-- ncr_description_draft, checklist_consistency_check, checklist_generation).
alter table public.ai_usage_log drop constraint ai_usage_log_feature_check;
alter table public.ai_usage_log add constraint ai_usage_log_feature_check
  check (feature in (
    'itp_draft',
    'ncr_description_draft',
    'checklist_consistency_check',
    'checklist_generation',
    'report_narrative_draft'
  ));
