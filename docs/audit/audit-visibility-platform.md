# Audit: visibility and platform services (read-only, 2026-10-14)

Scope: dashboards, KPIs, reports hub, activity/audit, notifications and email, search, API routes, AI, data requests, observability, security headers, performance, automation. Method: code trace plus read-only SQL on project qbappyddqdnbwbhbzwei. This was a time-boxed pass; anything not traced is marked UNVERIFIED.

## What works (verified)
- Every app/api route that returns data checks the session and applies a per-user rate limit: itps/export, itps/[id]/export-docx and export-xlsx, registers/export, registers/certificate, registers/usage-export, checklist-library/[id]/export, vault/[projectId]/download-all, offline-sync (apps/web/lib/api/rate-limit.ts, buckets export 20/min, bulkDownload 5/10min, offlineSync 240/min). Offline-sync adds an origin check, a wrong-user check and an idempotency key (app/api/offline-sync/route.ts:40-75).
- vault/email-inbound rejects anything without the shared secret, and rejects every request if the secret is unset (route.ts:85).
- /api/health does real DB, storage and worker-liveness probes with timeouts and leaks no detail (app/api/health/route.ts).
- Security headers and an enforced CSP are applied to all routes; the stricter no-eval CSP runs in report-only (next.config.ts, lib/security/headers.ts). /inspect/* is sent no-store.
- KPI loaders page past the 1000-row cap and throw on error rather than showing 0% (lib/kpis/queries.ts). Live cross-check: open NCRs per project match the `status <> 'closed'` filter in compute.ts:549-551 (Switchroom Electrical Fit-out: 6 open NCRs, 2 ITPs, 1 client_accepted). Only the NCR and ITP counts were verified, not the full KPI set.
- Notification pipeline exists end to end: notifications (836 rows) -> email_outbox -> worker sweepNotificationOutbox (worker/src/emailOutbox.ts), with retry/attempt caps for transmittals, an undeliverable-address filter and a "test/demo recipient" skip.
- AI is gated by tier, per-org ai_consent and a per-org rate cap (lib/ai/gate.ts); ai_usage_log has 98 rows and ai_consent_history has 1, so logging is live.
- Data subject anonymisation is JAGS-Admin only, needs a reason, refuses the last admin and self, writes audit, and mirrors the ban in Auth (lib/data-requests/actions.ts).
- Search is a server action behind requireSession with per-kind limits and RLS-scoped reads (lib/search/actions.ts).
- Worker sweeps (automation, retention, orphan photos, transmittal and notification email) run behind a lease so only one replica runs them (worker/src/index.ts:245-284). Automation: 60 rules, 187 log rows, so it has fired.
- Advisors (performance): the latest run reports only multiple_permissive_policies and unused_index. Unindexed foreign keys and initplan warnings were fixed by migration 20261203000100.

## PENDING / BROKEN

### Critical
- C1. Production email is not actually deliverable. Of 576 outbox rows: 1 sent, 573 skipped, 1 failed. The failed row is Resend 403 "You can only send testing emails to your own email address (harish.varri@hrud.ai)", which means the sending domain is not verified. No external user receives email today. SQL: `select status,last_error,count(*) from email_outbox group by 1,2`. Fix: verify a domain in Resend, set RESEND_API_KEY and the from-address in both web and worker (S, but it is an ops task).
  - Related: that failed row is not retried by notification sweeps visibly. UNVERIFIED whether notification rows (as opposed to transmittal rows) honour attempt caps; I read only the transmittal path, worker/src/emailOutbox.ts:58-93.

### High
- H1. Silent feature disablement. With no RESEND_API_KEY, notifications return early with no log and no UI warning (lib/notifications/helpers.ts:66, lib/handover/actions.ts:70, lib/projects/party-provisioning.ts:313). Sentry is off unless SENTRY_DSN is set (instrumentation.ts, next.config.ts); docs say "not-yet-active", so production errors are unobserved. Gemini is gated by GEMINI_API_KEY and AI_TIER. There is no startup or admin "configuration health" page that lists missing env vars. UNVERIFIED which of these are set in the Vercel/worker environments. Fix: add env checks to /api/health or an admin banner (M).
- H2. Rate limiting is in-memory per serverless instance (rate-limit.ts header says so). The effective limit is limit times instances, so the bulk ZIP (5 per 10 min) and export caps can be exceeded. Fix: DB- or Redis-backed counter (M).
- H3. Unread notifications pile up: 749 of 836 are unread, in a project with 787 rows total. No retention or auto-archive was found for notifications (retention sweep scope UNVERIFIED). The bell badge count and list at 10x data need a count query plus paging. Fix: check unread.ts uses count(head) and an index on (recipient_user_id, is_read) (S).

### Medium
- M1. No Power BI "API": only SQL views granted to authenticated (migrations 20260910120000, 20260915040000, 20260916140000), surfaced in the reporting UI. No token, service account or REST route exists for an external BI tool, and no app/api route covers it. If the owner expects an external Power BI feed, it is not built. Check docs scope (S to M).
- M2. 333 of 1033 audit_log rows have organization_id NULL. They will not show in org-scoped audit/activity views, and may appear only to staff. Verify which actions write them (S).
- M3. Connectors for Aconex, Procore and ProjectWise are explicit stubs that throw (lib/connectors/*.ts, shown in vault/connectors-panel.tsx). Documented as stubs, so not a regression, but a visible dead end for users. Fix: hide in production or mark "coming soon" (S).
- M4. CSP keeps 'unsafe-inline' for scripts and 'unsafe-eval' unless the report-only candidate is promoted (lib/security/headers.ts:19, 54-56). Fix: nonce-based CSP (L).
- M5. Search uses `ilike '%x%'` on several tables with `.or()` (lib/search/actions.ts:33-54). Fine at current size; at 10x it is a sequential scan per keystroke. Fix: pg_trgm indexes or an FTS column, plus a client debounce (M). UNVERIFIED whether pg_trgm indexes already exist.
- M6. Dashboards and KPIs load all ITPs, sections, items and responses into memory in the app, in chunks (lib/kpis/queries.ts, compute.ts). Correct but O(project size) per page view, and no caching. At 10x data the KPI page will be slow. Fix: SQL views or RPCs for the aggregates (L).

### Low
- L1. pg_stat_statements shows the slowest app-relevant statements are Supabase storage lookups (storage.objects by name: 58 to 284 ms mean, 2015 and 312 calls) and auth session insert (150 ms). No slow application query was seen. Probably storage-signed-URL or exists-checks in loops; trace where (S).
- L2. Advisors still list multiple_permissive_policies and unused_index warnings (S to M, cleanup).
- L3. Rate-limit and origin guards exist on offline-sync, but the other server actions (search, AI) rely only on session and consent. AI has a per-org cap; search has no throttle (S).
- L4. Test and demo data pollute production counts: "[UI-TEST]" projects, 364+120 emails skipped as test addresses, 87 skipped as old test notifications. Clean before launch so KPIs and dashboards reflect real work (S).

## UNVERIFIED
- Live env vars (Resend, Sentry, Gemini, CRON/worker secrets) on Vercel and the worker host.
- Reports/documents hub and PDF job pipeline end to end.
- Notification triggers: whether every workflow event (HOLD/WITNESS notice, NCR, punch, approval) enqueues a notification.
- Admin, inspector and external-party dashboard numbers beyond NCR/ITP counts.
- EXPLAIN on specific hot queries was not run.
- Realtime bell subscription (supabase/RUN_ONCE_phase5_notifications_realtime.sql): whether it has been applied.
