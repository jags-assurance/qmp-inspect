-- Which single project an AI call was made in service of, when the feature has exactly one — see
-- apps/web/lib/ai/log.ts's LogAiUsageParams.projectId doc comment for why this is passed explicitly
-- by each caller rather than parsed out of the free-form source_ref jsonb. Powers the per-project
-- cost filter on the Usage & Cost page (apps/web/app/inspect/organisation/usage/page.tsx).
alter table ai_usage_log
  add column if not exists project_id uuid references projects(id) on delete set null;

create index if not exists ai_usage_log_project_id_idx on ai_usage_log (project_id);

comment on column ai_usage_log.project_id is 'Which project this AI call was made in service of, when the feature has exactly one (null for an org-wide/portfolio-wide feature like report_pack_summary or a feature that predates this column). Powers the per-project cost filter on the Usage & Cost page.';
