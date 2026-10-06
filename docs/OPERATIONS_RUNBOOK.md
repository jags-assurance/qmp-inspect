# Operations Runbook

## 1. Architecture
- **Web app**: Next.js (`apps/web`) on Vercel. Server actions talk to Supabase with the user's session (RLS applies).
- **Worker**: Node service (`worker/`) on Railway. Polls `background_jobs` every 3 s, renders PDFs with Puppeteer (Chromium), uploads to storage, runs automation sweeps (about every 15 min).
- **Supabase**: one project holding Postgres (RLS on every table), Auth and Storage.
- **Storage buckets**: `generated-documents` (all rendered PDFs and report packs), `inspection-evidence` (photos, per-item documents, vault uploads), `org-branding` (logos).
- **Optional**: Resend (email), Sentry, Gemini (AI features), Aconex/Procore/ProjectWise/Microsoft Graph (cloud sync).

## 2. Environment variables
### Web (Vercel)
| Variable | Secret | Purpose |
|---|---|---|
| NEXT_PUBLIC_SUPABASE_URL | no | Supabase URL |
| NEXT_PUBLIC_SUPABASE_ANON_KEY | no | Public anon key |
| SUPABASE_SERVICE_ROLE_KEY | YES | Server-only admin client (party login provisioning, etc.) |
| NEXT_PUBLIC_APP_URL | no | Absolute links in emails/notifications |
| RESEND_API_KEY | YES | Email sending |
| NOTIFICATIONS_EMAIL_FROM | no | From address |
| VAULT_EMAIL_WEBHOOK_SECRET | YES | Inbound vault email webhook |
| GEMINI_API_KEY | YES | AI features |
| GEMINI_MODEL_LIGHT / GEMINI_MODEL_HEAVY / AI_TIER | no | AI model selection |
| FILE_ORG_PACKS_IN_PROJECT_VAULTS | no | `false` stops weekly/monthly org packs being filed into project vaults (default on) |
| ACONEX_API_KEY, PROCORE_CLIENT_ID/SECRET, PROJECTWISE_API_BASE_URL/KEY, MICROSOFT_GRAPH_CLIENT_ID/SECRET/TENANT_ID | YES (keys/secrets) | Cloud Folder Sync connectors, only if used |
| NEXT_PUBLIC_SENTRY_DSN / SENTRY_DSN | no | Error reporting |

### Worker (Railway)
| Variable | Secret | Purpose |
|---|---|---|
| SUPABASE_URL | no | Supabase URL |
| SUPABASE_SERVICE_ROLE_KEY | YES | Service role (bypasses RLS) |
| PUPPETEER_EXECUTABLE_PATH | no | Chromium path in the container |
| SENTRY_DSN | no | Error reporting |
| FILE_ORG_PACKS_IN_PROJECT_VAULTS | no | Same switch as web; the worker reads it when filing packs |

Never commit secrets; the service role key must exist only in Vercel server env and Railway.

## 3. Deploy checklist
1. Apply new SQL migrations from `supabase/migrations/` in filename order (oldest `20260909…` through latest `20261013N70001_itp_master_audit.sql`). All current migrations are applied on the live project. Never edit an applied migration; add a new one.
2. Merge to the deploy branch; Vercel builds the web app (`npx tsc --noEmit` should be clean first).
3. **Redeploy the Railway worker after any change under `worker/` or any PDF template/layout change** (the worker holds the PDF code, the web app does not).
4. Smoke test: log in, generate an ITP PDF, check the job reaches `completed`.

## 4. Background jobs
Table `background_jobs`; a job is queued by the web app (insert allowed by RLS only for a user with access to the target record), the worker claims it and writes `result_storage_path` or an error. Per-organisation rate limit trigger applies.
Job types: `render_itp_pdf`, `render_inspection_report_pdf`, `render_irn_pdf`, `render_fat_report_pdf`, `render_ncr_pdf`, `render_ncr_closeout_certificate`, `render_data_book_pdf`, `generate_weekly_report_pack` and `generate_monthly_report_pack` (admin staff only), `render_portfolio_summary_pdf` (admin staff only).

## 5. Automation worker rules
Configured per organisation under Settings > Automation Rules. Sweep roughly every 15 minutes.
- `hold_elapsed`: a hold/witness notice period has elapsed without a response.
- `ncr_overdue`: NCR past its target date.
- `punch_overdue`: punch item past its due date.
- `register_expiry`: calibration/welder/personnel/material certificates nearing expiry. On by default for every organisation unless a disabled row exists. Each (item, expiry date, threshold) notifies once (`register_expiry_notifications`), so a renewed certificate alerts again.

## 6. Storage layout
- `generated-documents`: `irns/<irn_id>/<irn_number>.pdf`, `databooks/<data_book_id>/<book_number>.pdf`, plus per-type folders for ITP, inspection report, FAT, NCR, close-out certificate, report packs, portfolio summary. PDFs are uploaded with upsert (a re-render overwrites).
- `inspection-evidence`: checklist photos, per-item documents and vault files, keyed by project/record ids.
- `org-branding`: logo per organisation.
Vault documents are controlled: once approved they are immutable; a new revision supersedes the old one.

## 7. Roles and permissions
| Role | Scope | Can do | Cannot do |
|---|---|---|---|
| JAGS admin | Org-wide | Everything: create projects, settings, staff access, numbering, branding, org packs, close NCR/punch, approve vault docs, provision party logins, Data Book override | - |
| JAGS staff / inspector | Org-wide or project grants | Build ITPs, Start work, run inspections, issue/void IRN, raise NCR, sign any party's cell, approve ITP, compile Data Book | Create projects, admin settings, org packs |
| Client | Project-scoped | Review/accept ITP (`approve_itp` if granted), sign own cells, acknowledge handover, observations | Sign other parties' cells, execute unless allowed on the project |
| Main contractor | Project-scoped | Execute own checklists, sign own cells, create ITPs if project toggle on | Release material (IRN), approve own work as client, create projects |
| Subcontractor | Project-scoped | Execute own scope, sign own cells, resolve punch/NCR actions | Same as above |
| TPI / lab | Project-scoped | Witness/verify, own cells | Execute checklist |
Custom-role permissions (per project or org-wide grant): `approve_vault_document` (admin-grantable only, plus client-managed orgs where allowed), `close_punch_item` (admin or permission holder; not grantable by client-managed orgs), `approve_itp`, `provision_party_login`. Register contributors: named project party members who may add/edit register rows (calibration, welder, personnel, material). Org settings need an org-wide grant, not a project-only one. Org-wide grants see all projects of the org; project-scoped grants see only the listed projects.

## 8. Backup and restore
- Supabase daily backups (and PITR if enabled) cover Postgres. Storage objects are NOT in a DB restore: export the three buckets periodically.
- Restore: restore to a new Supabase project, re-point env vars in Vercel and Railway, redeploy both.
- Do not hard-delete records; voided IRNs, superseded vault documents and audit log entries are intentional history.

## 9. Incident notes
- **PDF fails**: check `background_jobs` row (`status`, `error`). Check Railway logs (Chromium launch, memory, timeouts). Confirm the worker is running the latest deploy and `SUPABASE_SERVICE_ROLE_KEY` is valid. Re-queue by generating again from the app. Check the rate limit for the organisation.
- **Notification does not arrive**: check the `notifications` row exists for the user; for email check `RESEND_API_KEY`, `NOTIFICATIONS_EMAIL_FROM`, Resend dashboard; for automation alerts check the rule is enabled and the worker sweep ran (worker logs).
- **User cannot see a project**: check their grant (org-wide vs project-scoped), that the party is active on the project (`project_parties.is_active`), the party login is provisioned/linked to their user, and the module is licensed for the org (Module Licensing).
- See also `docs/INCIDENT_RESPONSE.md`.
