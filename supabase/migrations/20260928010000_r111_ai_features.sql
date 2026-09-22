-- R111: widens ai_usage_log's feature check constraint (20260920040000_register_extraction_ai_feature.sql)
-- to cover the four AI-assist features that were missing from this build: content translation (an
-- ITP's title/scope translated for display, original never overwritten), the project Q&A assistant
-- (answers grounded in one project's real, assembled context), free-text grammar/clarity clean-up
-- (accept-or-discard, never auto-applied), and the monthly report pack's AI executive summary
-- (computed web-side from the pack's own real aggregated numbers — see apps/web/lib/reports/
-- report-summary.ts's doc comment for why this stays web-side rather than moving into the worker).
-- Same reuse-ai_usage_log pattern as every prior AI feature migration: no new table.

alter table public.ai_usage_log drop constraint ai_usage_log_feature_check;
alter table public.ai_usage_log add constraint ai_usage_log_feature_check
  check (feature in (
    'itp_draft',
    'ncr_description_draft',
    'checklist_consistency_check',
    'checklist_generation',
    'report_narrative_draft',
    'ncr_root_cause_suggestion',
    'standalone_measurement_suggestion',
    'calibration_register_extraction',
    'welder_register_extraction',
    'material_register_extraction',
    'content_translation',
    'project_qa',
    'text_cleanup',
    'report_pack_summary'
  ));
