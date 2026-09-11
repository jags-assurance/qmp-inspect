-- Phase 4: sixth and last of this pass's AI assists (R111 — "suggest likely root causes for an
-- NCR"). No schema change beyond the usage-log feature value: the suggestion is drafted from the
-- NCR's own existing description/requirement_not_met/severity and dropped into the already-
-- editable root_cause textarea on the close-out form — nothing new to store.

alter table public.ai_usage_log drop constraint ai_usage_log_feature_check;
alter table public.ai_usage_log add constraint ai_usage_log_feature_check
  check (feature in (
    'itp_draft',
    'ncr_description_draft',
    'checklist_consistency_check',
    'checklist_generation',
    'report_narrative_draft',
    'ncr_root_cause_suggestion'
  ));
