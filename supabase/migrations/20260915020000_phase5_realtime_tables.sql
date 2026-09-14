-- Phase 5: enables Realtime broadcast (Supabase's Postgres Changes feature) on the tables the new
-- RealtimeRefresh client component subscribes to (apps/web/components/domain/realtime-refresh.tsx).
-- Row-level security still applies to what a subscribed client actually receives — enabling this
-- only makes CHANGE EVENTS available to broadcast; it does not bypass a table's existing RLS
-- policies for who can read which rows.
--
-- Scoped to what the app's pages actually subscribe to: the ITP detail page (sign-off progress and
-- the ITP's own status), and NCR/checklist-response activity, which are the other places multiple
-- parties are looking at the same record at the same time.
alter publication supabase_realtime add table public.activity_signoff_progress;
alter publication supabase_realtime add table public.itps;
alter publication supabase_realtime add table public.ncrs;
alter publication supabase_realtime add table public.checklist_responses;
