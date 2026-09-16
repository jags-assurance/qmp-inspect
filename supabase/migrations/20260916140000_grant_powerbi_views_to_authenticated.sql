-- SUPERSEDED / SECURITY FIX: this migration originally granted SELECT on the vw_powerbi_* views to
-- `authenticated` so an in-app "Portfolio Insights" page could read them directly. That was wrong —
-- these views carry NO row-level filtering (see 20260910120000_phase3_powerbi_reporting_views.sql's
-- own header comment: "deliberately an all clients all projects rollup"), because a plain Postgres
-- view runs with `security_invoker = false` by default, meaning it evaluates the underlying tables'
-- RLS policies as the VIEW OWNER (effectively bypassing RLS), not as the querying role. Granting
-- `authenticated` SELECT on them means ANY logged-in user — a client, a subcontractor, anyone with a
-- session — could call `supabase.from('vw_powerbi_ncr_trends').select('*')` directly from the
-- browser and read every organisation's aggregate NCR/ITP/hold-point/FAT data, completely bypassing
-- both the admin-only Reporting page's isAdminStaff gate AND every RLS policy in this database. This
-- is the exact same "org-wide instead of scoped" bug class fixed everywhere else in this app —
-- Supabase's schema-wide default already grants `authenticated` blanket table privileges (confirmed:
-- `projects` itself carries the identical grant set), so on ordinary tables RLS is the real boundary;
-- these views have none, which is what made this genuinely exploitable rather than theoretical.
--
-- Fix: revoke the blanket grant, restoring the views to powerbi_reader-only (their original,
-- intentional design — a single trusted analytics credential, not a public read). The in-app
-- Portfolio Insights page (added alongside this same round-table pass) must NOT query these views;
-- it computes the same aggregates via ordinary has_project_access/has_org_access-scoped queries
-- against the base tables instead, going through RLS like every other page in this app.
revoke select, insert, update, delete, truncate, references, trigger on
  public.vw_powerbi_inspections_completed_vs_planned,
  public.vw_powerbi_itp_completion,
  public.vw_powerbi_hold_point_turnaround,
  public.vw_powerbi_first_time_pass_rate,
  public.vw_powerbi_ncr_trends,
  public.vw_powerbi_punch_list_and_fat
from authenticated, anon;
