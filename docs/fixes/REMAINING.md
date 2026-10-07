# Audit fixes: what is live, what you must do, what is still open

Branch `dev` (all merged and pushed). Four fix batches were merged: Stage 7/6, Stage 5/4, Stage 3/2 (committed part), Stage 1 + cross-cutting (committed part). Typecheck + tests pass (web 290, worker 63). Live smoke test after the merge: admin, inspector, client and subcontractor can sign in and open dashboard, NCRs, project, ITP, inspections, vault, handover.

Per-item tables with exact files: `docs/fixes/stage-7-6.md`, `docs/fixes/stage-5-4.md`. Stage 3/2 and Stage 1/cross-cutting were stopped before their status docs were written; their migrations carry the finding IDs in their header comments.

## A. Things only you can do (in this order)

1. **Back up the database** (Supabase dashboard > Database > Backups, or take a manual backup).
2. **Pre-check the hand-applied migrations.** Several security guards live in migrations whose names the CLI ignores (e.g. `20261015S40001`, `20261016S50001`, `20261019S70001..4`). The new migrations call functions from them. In the SQL editor run:
   ```sql
   select proname from pg_proc where proname in ('is_system_caller','is_admin_staff','is_jags_staff','project_write_guard','close_project','issue_data_book_handover','acknowledge_handover');
   select version from supabase_migrations.schema_migrations order by version desc limit 30;
   ```
   If `is_system_caller` or `project_write_guard` is missing, apply the matching old file from `supabase/migrations/` by hand first.
3. **Apply the new migrations, one file at a time, in this order** (SQL editor or `supabase db push`; each is idempotent):
   - `20261020000100_handover_certificate_write_lock.sql`
   - `20261101000100_handover_access_and_issue_rpc.sql`, `20261101000200_vault_jobs_storage_hardening.sql`, `20261101000300_project_close_irn_reopen_verify.sql`
   - `20261102000100_offline_client_keys_and_capture_time.sql`, `20261102000200_ncr_punch_schema_and_helpers.sql`, `20261102000300_ncr_write_guards_v2.sql`, `20261102000400_punch_write_guards_v2.sql`, `20261102000500_execution_guards_v2.sql`
   - `20261103000100_registers_verification_lifecycle_guards.sql`, `20261103000200_itp_integrity_revisions_signoff_sync.sql`
   - `20261104000100_users_privilege_lockdown.sql` (**most important: closes "any user can make themselves Admin"**), `...200_access_grants_scoping_and_last_admin.sql`, `...300_audit_notifications_hardening_and_email_outbox.sql`, `...400_auth_attempts_throttle.sql`, `...500_project_and_org_timezone.sql`, `...600_project_close_guard_fixes.sql`, `...700_inbound_email_dedupe.sql`

   The web app works before these are applied (it falls back), but the security fixes only take effect once they are.
4. **After applying, re-test** with a staff login, a client login and a subcontractor login: sign in, edit your own profile name, raise an NCR, resolve a punch item, complete an inspection, issue/acknowledge a handover. If something is refused unexpectedly, send me the exact error.
5. **Environment variables** (Vercel and Railway): `SUPABASE_SERVICE_ROLE_KEY` on the web app (needed for non-staff recipient lookups, party provisioning, deactivation); `NEXT_PUBLIC_APP_URL` on the web app (reset-password links, QR codes); `PUBLIC_APP_URL` or `NEXT_PUBLIC_APP_URL` on the worker (QR codes on PDFs). Check `docs/fixes/stage-7-6.md` and `stage-5-4.md` for any others.
6. **Redeploy the Railway worker** (needs a rebuild: new fonts for Arabic/Chinese, `qrcode` package, escalation changes, handover certificate PDF).
7. **Supabase dashboard settings:**
   - Storage > buckets `inspection-evidence`, `generated-documents`: set allowed MIME types (images, PDF, Office, text) and a file size limit.
   - Auth: enable leaked-password protection, set rate limits / CAPTCHA, enable TOTP MFA if you want it.
   - Database: confirm PITR/daily backups; schedule the storage bucket export (nothing automates it yet).
   - Automation: each organisation needs an enabled `automation_rules` row for overdue-hold / NCR / expiry reminders to fire.
8. **Third-party:** set `SENTRY_DSN` (error tracking is currently off), confirm the Resend sender domain, and decide whether CI should run on every push (`.github/workflows/ci.yml` is manual-only by a past org decision).
9. **Migration history repair:** the repo still has 7 duplicate migration versions and 31 migrations with non-numeric names (`2026...S..`, `...A0..`, etc.), which `supabase db push` ignores or rejects. They were applied by hand. Run the `schema_migrations` query above, compare with `ls supabase/migrations`, and use `supabase migration repair --status applied <version>` for anything already applied. Do not rename existing files. All new migrations use pure numeric versions.
10. **Test data cleanup:** tell me when you want the `[UI-TEST]` organisation, projects, parties and probe records removed.

## B. Behaviour changes you will notice
- Data Book readiness now also requires every activity to be inspected and passed, and hold/witness points signed off. Many existing projects will show "not ready" until that is true.
- Compiling with an override, issuing a conditional handover, and withdrawing a compiled book need an Admin.
- Contractors/TPIs can no longer read Data Books, handover certificates or the handover package. Clients and staff can.
- Sending an NCR for verification needs evidence; resolving a punch item needs a fix photo; an un-notified Witness point blocks inspection completion.
- A non-admin assignee/CAPA author cannot close their own NCR; inspector-level staff cannot close NCRs, sign on behalf or withdraw sign-offs.
- Register rows added by contractors/TPIs are unverified until JAGS staff verify them.
- A recalibration creates a new calibration row (history kept). Sections with inspection history cannot be deleted.
- Users cannot edit their own staff flag/role; deactivated users are blocked; sign-in is throttled; passwords need 10+ characters.
- Security headers are added (CSP is report-only for now).

## C. Still open (not done or not verified)

**Stage 7/6 (partial):** S7-25 readiness caching; PDF digital signatures, bulk IRN issue, audit-trail export; S6-12 worker-side notification of permanently failed jobs. (S7-18 signature/evidence, S7-21 resumable upload, S7-26 email transmittals and S6-18 retention flagging are done in Phase 8, see below.)

**Done in Phase 8 (branch `feat/phase7-remaining-rtl-transmittal-retention`, not yet merged):** S7-18 acknowledgement signature pad + evidence upload, S7-21 resumable (TUS) upload, S7-26 email transmittals with a log, S6-18 retention flagging (never deletes), G-02 RTL support (language switch in the account menu sets `<html lang dir>`; logical Tailwind utilities in the shell), S1-12 scope-change impact summary (preview before confirming, written to the audit entry), S1-13 party-type limits (active parties per type, checked when a party is added). New migrations to apply in order, after the earlier lists: `20261112000101_handover_ack_signature_evidence.sql`, `20261112000102_document_transmittals.sql`, `20261112000103_document_retention.sql`. Redeploy the Railway worker (transmittal retries, retention sweep) and set `RESEND_API_KEY` on it as well as on the web app; transmittals also need `SUPABASE_SERVICE_ROLE_KEY` and `NEXT_PUBLIC_APP_URL` on the web app. Not done: translated UI strings (only the layout direction is switched), a database-level party limit (the cap is app-side only).

**Done in Phase 6/7 (branch `worktree-agent-ace478d5ab124f950`, not yet merged):** S7-10 server re-hash, S7-11 `issue_handover` permission, S7-18 reject + reminders, S6-07 photo downscaling, S6-12 persisted backoff, S6-14 stale markers; ESLint errors fixed; CI runs lint/typecheck/unit tests on push and PR; API rate limiting; deeper `/api/health`; `docs/MIGRATION_REPAIR.md` + migration-name CI check; README / USER_GUIDE / runbook refreshed. New migrations to apply (in order, after the list in section A): `20261108000101_issue_handover_permission.sql`, `20261108000102_handover_acknowledgement_reject_reminders.sql`, `20261108000103_background_jobs_retry_not_before.sql`. Redeploy the Railway worker (photo downscaling, persisted backoff, acknowledgement reminders).

**Stage 5/4 (partial/deferred):** S5-05 (part), S5-15, S5-22, S5-23, six Stage 4 items marked PARTIAL, S4-17 (location accuracy/geofence), S4-18 (sign-off comment/reject), photo markup editor, barcode/QR camera scanning, voice input. See the table in `stage-5-4.md`.

**Stage 3/2 (work stopped part-way; confirm each in the app before relying on it):** S3-06 explicit per-activity register requirements, S3-09 personnel certificates per person, S3-11 replace certificate file, S3-12 expiring-clearances widget on dashboards, S3-14 traceability report scope/export; S2-03 (app side of re-acceptance after revision), S2-04 checklist generation after client acceptance, S2-08 withdraw/supersede/delete ITP, S2-09 transactional offline xlsx re-upload, S2-11 approve_itp permission, S2-13 keep review history on return to draft, S2-15 AI draft number/checklist rules, S2-16 revision-approval notifications, S2-17 translation, S2-18 revision diff, S2-19..S2-21. An unfinished patch is saved at `docs/fixes/wip/stage-3-2-unfinished.patch` (not applied, not reviewed).

**Stage 1 and cross-cutting (work stopped part-way):** (F-01 migration repair guide + CI check, H-01 CI trigger, F-05 health depth, I-01/I-02 docs refresh and API rate limiting are done in Phase 7, see above), H-02/H-03 end-to-end and RLS test coverage, S1-16..S1-18 bulk deactivate / palette / enterprise features, MFA/SSO scaffolding (S1-10), D-03 proxy second query, D-04 realtime debounce, D-05 layout query waterfalls, D-07 reference-data caching, E-08 Sentry PII scrubbing activation, E-09 AI consent hardening, E-10 CSRF check on the offline route, F-04 worker multi-replica safety, F-05 health check depth, F-06 storage backup job, F-07 migration idempotency, I-01/I-02 documentation refresh (README, USER_GUIDE, runbook). A small unfinished patch is saved at `docs/fixes/wip/stage-1-cross-unfinished.patch`.

Ask me to continue any of these one stage at a time.
