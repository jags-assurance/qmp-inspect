-- Adds the register-extraction AI features to ai_usage_log's feature check constraint
-- (20260920030000_ai_audit_trail.sql) — closes the "register extraction" gap from the client's
-- sample pack: AI extracts calibration/welder/material register rows from source document text,
-- returning null for anything not stated, and a document controller reviews every row before it's
-- usable. No new table: this reuses ai_usage_log exactly like every other AI-assisted feature.

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
    'material_register_extraction'
  ));
