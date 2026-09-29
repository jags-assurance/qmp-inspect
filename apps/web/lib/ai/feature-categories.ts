import type { AiFeature } from "@/lib/ai/log";

// Groups the 14 AI features into the categories a cost review actually reasons about — "why is
// this org's AI spend high" is answered at this level ("mostly ITP drafting"), not at the level of
// 14 individual feature names. Used only for display grouping on the Usage & Cost page; every
// feature still keeps its own row in the underlying ai_usage_log data.
export type AiFeatureCategory = "Drafting & Generation" | "Extraction" | "Review & Suggestions" | "Translation & Cleanup";

export const FEATURE_CATEGORY: Record<AiFeature, AiFeatureCategory> = {
  itp_draft: "Drafting & Generation",
  checklist_generation: "Drafting & Generation",
  report_narrative_draft: "Drafting & Generation",
  report_pack_summary: "Drafting & Generation",
  ncr_description_draft: "Drafting & Generation",
  calibration_register_extraction: "Extraction",
  welder_register_extraction: "Extraction",
  material_register_extraction: "Extraction",
  checklist_consistency_check: "Review & Suggestions",
  ncr_root_cause_suggestion: "Review & Suggestions",
  standalone_measurement_suggestion: "Review & Suggestions",
  project_qa: "Review & Suggestions",
  content_translation: "Translation & Cleanup",
  text_cleanup: "Translation & Cleanup",
};

export const FEATURE_LABEL: Record<AiFeature, string> = {
  itp_draft: "ITP draft generation",
  checklist_generation: "Checklist generation",
  report_narrative_draft: "Report narrative draft",
  report_pack_summary: "Report pack executive summary",
  ncr_description_draft: "NCR description draft",
  calibration_register_extraction: "Calibration register extraction",
  welder_register_extraction: "Welder register extraction",
  material_register_extraction: "Material register extraction",
  checklist_consistency_check: "Checklist consistency check",
  ncr_root_cause_suggestion: "NCR root cause suggestion",
  standalone_measurement_suggestion: "Standalone measurement suggestions",
  project_qa: "Project Q&A",
  content_translation: "Content translation",
  text_cleanup: "Text clean-up",
};
