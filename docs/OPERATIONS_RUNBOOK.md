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
| NEXT_PUBLIC_APP_URL | no | Absolute links in emails/notifications, reset-password links, QR codes |
| VAULT_EMAIL_ALLOWED_SENDERS | no | Optional allow-list of inbound vault email senders |
| NEXT_PUBLIC_SITE_TIMEZONE | no | Site timezone for date logic (default `Asia/Dubai`) |
| RESEND_API_KEY | YES | Email sending |
| NOTIFICATIONS_EMAIL_FROM | no | From address |
| VAULT_EMAIL_WEBHOOK_SECRET | YES | Inbound vault email webhook |
| GEMINI_API_KEY | YES | AI features |
| GEMINI_MODEL_LIGHT / GEMINI_MODEL_HEAVY / AI_TIER | no | AI model selection |
| ACONEX_API_KEY, PROCORE_CLIENT_ID/SECRET, PROJECTWISE_API_BASE_URL/KEY, MICROSOFT_GRAPH_CLIENT_ID/SECRET/TENANT_ID | YES (keys/secrets) | Cloud Folder Sync connectors, only if used |
| NEXT_PUBLIC_SENTRY_DSN / SENTRY_DSN | no | Error reporting |

### Worker (Railway)
| Variable | Secret | Purpose |
|---|---|---|
| SUPABASE_URL | no | Supabase URL |
| SUPABASE_SERVICE_ROLE_KEY | YES | Service role (bypasses RLS) |
| PUPPETEER_EXECUTABLE_PATH | no | Chromium path in the container |
| NEXT_PUBLIC_APP_URL or PUBLIC_APP_URL | no | Public app URL used for QR codes on PDFs |
| SITE_UTC_OFFSET_HOURS | no | Site UTC offset for calendar-day escalation logic (default 4) |
| SENTRY_DSN | no | Error reporting (currently off until set) |
| FILE_ORG_PACKS_IN_PROJECT_VAULTS | no | `false` stops weekly/monthly org packs being filed into project vaults (default on); read by the worker |

Never commit secrets; the service role key must exist only in Vercel server env and Railway.

## 3. Deploy checklist
1. Apply new SQL migrations from `supabase/migrations/` in filename order, one file at a time, each idempotent. The ordered list of recent migrations still to apply (through `20261105…`, plus any `20261108…` from the Phase 6/7 batch) is in `docs/fixes/REMAINING.md` section A. The repo has 7 duplicate versions and 30 non-numeric names that `supabase db push` ignores or rejects; reconcile history with `docs/MIGRATION_REPAIR.md` before using `db push`. Never edit an applied migration; add a new one with a 14-digit numeric version (CI enforces this).
2. Merge to the deploy branch. CI (`.github/workflows/ci.yml`) runs lint, typecheck, unit tests, the migration-name check and the build on every push to `main`/`dev` and every pull request; it should be green before Vercel promotes. Locally: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`.
3. **Redeploy the Railway worker after any change under `worker/` or any PDF template/layout change** (the worker holds the PDF code, fonts and the `qrcode` package; the web app does not).
4. Smoke test: `GET /api/health` returns `status: ok`; log in, generate an ITP PDF, check the job reaches `completed`.

## 4. Background jobs
Table `background_jobs`; a job is queued by the web app (insert allowed by RLS only for a user with access to the target record), the worker claims it and writes `result_storage_path` or an error. Per-organisation rate limit trigger applies.
**Running more than one worker replica (F-04).** Safe once migration `20261111000103_worker_multi_replica_safety.sql` is applied. The worker claims a job with the database function `claim_next_background_job()`: one atomic `UPDATE ... WHERE id = (SELECT ... FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`, so two replicas polling together each get a different job (or none), `attempts` is incremented in SQL, and retry backoff (`retry_not_before`) is enforced in the database. The once-per-15-minutes automation sweep takes a lease (`try_acquire_worker_lease`, table `worker_leases`) so only one replica runs it per interval. Before the migration is applied the worker falls back to its previous compare-and-swap claim (now also conditioned on `attempts`), which is correct but makes extra replicas mostly idle; the log line `claim_next_background_job() is not installed` shows which mode a replica is in. Orphan reclaim after a restart is idempotent and safe on every replica. Scale replicas in the Railway dashboard; each replica launches its own Chromium, so size memory per replica (PDF jobs are the heavy ones).
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

### Large vault uploads (up to 500 MB)
The vault upload form and `uploadVaultDocumentCore` accept files up to **500 MB** (`lib/vault/limits.ts`). Files over 6 MB go up through the resumable (TUS) endpoint `<supabase>/storage/v1/upload/resumable` in 6 MB chunks and carry on from the server's offset after a dropped connection; if that endpoint is unreachable the form falls back to a plain upload (which is far less reliable for very large files). Files over 50 MB are stored but not downloaded for text extraction (they cannot be used as AI source text). For this to work in production the owner must check:
1. **Global upload limit** (Supabase Dashboard > Storage > Settings > "Upload file size limit") is at least 500 MB. This is plan-dependent (the Free plan caps at 50 MB) and cannot be changed from SQL or from the app. Without it, large uploads are refused by Storage whatever the app allows.
2. **Bucket limit**: migration `20261127000400_inspection_evidence_file_size_limit.sql` raises a lower `inspection-evidence` bucket limit to 500 MB; a bucket with no limit follows the global one.
3. Optional `NEXT_PUBLIC_SUPABASE_RESUMABLE_URL` overrides the resumable endpoint (e.g. a direct storage hostname) if the default is blocked by a proxy/CORS.
Test: upload a ~150 MB file, switch the network off for 10-20 seconds mid-upload and back on; the progress bar should carry on rather than restart.

## 7. Roles and permissions
| Role | Scope | Can do | Cannot do |
|---|---|---|---|
| JAGS admin | Org-wide | Everything: create projects, settings, staff access, numbering, branding, org packs, close NCR/punch, approve vault docs, provision party logins, Data Book override | - |
| JAGS staff / inspector | Org-wide or project grants | Build ITPs, Start work, run inspections, issue/void IRN, raise NCR, sign any party's cell, approve ITP, compile Data Book | Create projects, admin settings, org packs |
| Client | Project-scoped | Review/accept ITP (`approve_itp` if granted), sign own cells, acknowledge handover, observations | Sign other parties' cells, execute unless allowed on the project |
| Main contractor | Project-scoped | Execute own checklists, sign own cells, create ITPs if project toggle on | Release material (IRN), approve own work as client, create projects |
| Subcontractor | Project-scoped | Execute own scope, sign own cells, resolve punch/NCR actions | Same as above |
| TPI / lab | Project-scoped | Witness/verify, own cells | Execute checklist |
Custom-role permissions (per project or org-wide grant, scoped to the grantee's organisation): `issue_handover` (JAGS staff only, admin-grantable only: lets named staff issue a conditional handover, otherwise Admin-only), `approve_vault_document` (admin-grantable only, plus client-managed orgs where allowed), `close_punch_item` (admin or permission holder; not grantable by client-managed orgs), `approve_itp`, `provision_party_login`. Register contributors: named project party members who may add/edit register rows (calibration, welder, personnel, material). Org settings need an org-wide grant, not a project-only one. Org-wide grants see all projects of the org; project-scoped grants see only the listed projects.

## 8. Backup and restore
- Supabase daily backups (and PITR if enabled) cover Postgres. Storage objects are NOT in a DB restore: export the three buckets periodically with the script below.
- Restore: restore to a new Supabase project, re-point env vars in Vercel and Railway, redeploy both, then re-upload the storage export (see "Restoring storage").
- Do not hard-delete records; voided IRNs, superseded vault documents and audit log entries are intentional history.

### Storage bucket export (`scripts/export-storage.mjs`)
Copies every object of `generated-documents`, `inspection-evidence` and `org-branding` to a local folder through the Storage REST API. Node 18+, no npm install needed, read-only against Supabase.
```
SUPABASE_URL=https://<project-ref>.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<service role key> \
  node scripts/export-storage.mjs --out /backups/jags/$(date -u +%Y-%m-%d)
```
(or `pnpm backup:storage -- --out <dir>`). The key is read from the environment only (never a flag) and is never printed; run it from a trusted machine or CI secret store, not from a shared shell.

| Option | Meaning |
|---|---|
| `--out <dir>` | Destination. Default `./storage-backup-<UTC timestamp>`. Files land at `<dir>/<bucket>/<object path>`. |
| `--buckets a,b` | Only these buckets (a bucket named here that does not exist is an error). |
| `--since <ISO date>` | Incremental: only objects changed at or after this time. Combine with a full export weekly. |
| `--concurrency <n>` | Parallel downloads, 1-16 (default 4). |
| `--dry-run` | Lists object count and total size per bucket; downloads nothing. Run this first to size the disk. |
| `--no-verify` | Skip the check that each downloaded size matches the listing. |

Behaviour to rely on:
- **Resumable.** A file already on disk with the expected size is skipped, so re-running after an interruption (or into the same folder the next day) only fetches what is missing or changed. Partial downloads are written as `*.part` and only renamed when complete.
- **Manifest.** Each run writes `<dir>/manifest-<UTC stamp>.json` with, per object: bucket, path, status (`downloaded`/`skipped`/`failed`), size, SHA-256 (for objects downloaded in that run) and the Storage `updated_at`, plus totals. Keep manifests with the backup; they are how you prove what was copied.
- **Exit code.** 0 = everything copied; 1 = at least one object failed (listed on stderr and in the manifest); 2 = bad usage or missing credentials. Wire the non-zero exit to an alert.
- **Unsafe object keys** (`..`, absolute paths, backslashes) are refused and reported as failed rather than written outside the backup folder.
- Transient errors (network, HTTP 429/5xx) are retried 4 times with backoff.

Suggested schedule: a full export weekly, `--since <yesterday>` nightly, to storage that is NOT the Supabase project being backed up (another cloud account or an offline disk), retained at least as long as your Postgres backups. Encrypt the destination at rest: it holds client documents and photos.

Verify a backup periodically: pick a few objects from the manifest, compare `sha256sum <file>` with the manifest value, and open one PDF.

### Restoring storage
1. Restore Postgres first (Supabase restore or a new project), so the `storage.buckets` rows exist (migrations create them) and `background_jobs` / `vault_documents` rows point at the paths you are about to restore.
2. Re-upload each `<dir>/<bucket>/<path>` to the same bucket and the same object path (the paths are stored in the database, so they must not change). Upload with the service role key, e.g. a small script using `supabase.storage.from(bucket).upload(path, file, { upsert: true })`, or the Supabase dashboard for a handful of files.
3. Check `GET /api/health` (`storage: ok`), open a recent IRN/Data Book PDF and a vault document, and re-run any generation that was in flight (generated PDFs can also simply be regenerated from the app).

## 9. Health check and rate limits
- `GET /api/health` (public): `checks` has `database`, `schema`, `storage`, `worker` as `ok`/`error`/`skipped`, `latencyMs` has the per-check round trip, plus `build` (short commit id) and `timestamp`. Each probe times out after 5 s. 503 = database or storage failing; `degraded` (HTTP 200) = a background job has been pending for over 15 minutes (worker stalled). Needs `SUPABASE_SERVICE_ROLE_KEY`; without it only an anonymous database round trip runs. It never returns error text, keys or hostnames; details are in the server log.
- Sign-in and password-reset attempts are throttled in the database (`auth_attempts`, 5 failed sign-ins per email / 30 per IP per 15 min; resets 3 per email / 15 per IP per hour).
- Handover acknowledgement: the client can acknowledge or reject (with a reason) an issued certificate. A rejection is final for that certificate (the issuer is notified and issues a new revision; an Admin can reopen a rejection made in error). The worker's automation sweep reminds the client 3 days after issue, then weekly, at most 4 times (the issuer is told on the last), using `handover_certificates.ack_reminder_count` / `last_ack_reminder_at`.
- Background-job retries: a transiently failed job is retried up to 3 times with 30 s / 2 min / 8 min backoff, persisted in `background_jobs.retry_not_before` so restarts and replicas respect it.
- PDF photos: inspection and FAT reports downscale photos (longest edge 1600 px, JPEG) in the worker's Chromium before embedding; if that fails the original is embedded.
- Export and sync API routes are rate-limited per user, in memory per server instance (`apps/web/lib/api/rate-limit.ts`): exports 20/min, offline-sync replay 240/min, vault download-all 5 per 10 min. A limited request gets HTTP 429 with `Retry-After`; the offline queue treats 429 as a transient failure and retries without spending its retry budget.

### Performance behaviour worth knowing (D-03/D-04/D-05/D-07, S7-25)
- **Sign-in gate (proxy):** the forced-password-change decision reads `app_metadata.must_change_password` from the auth user the proxy already loaded; migration `20261111000101_auth_must_change_password_claim.sql` backfills it for every existing account and defaults it for new ones, so the extra `users` query is only a safety net.
- **Realtime refresh:** pages that live-update debounce bursts of changes into one refresh (1.5 s after the last event, never later than 6 s after the first), and do nothing while the browser tab is hidden. A change made by another user can therefore take up to a few seconds to appear.
- **Cached reference data:** module licences (per organisation, 60 s) and the organisation chrome (engagement mode/scope, brand colours, signed logo URL; 2 min) are cached and invalidated immediately when an admin changes them (`revalidateTag`). If you change those tables directly in SQL, expect up to 60 s / 2 min before the app shows it. `master_disciplines` is cached 5 min (tag `master-disciplines`).
- **Data Book readiness (display only):** the readiness figure shown on the Data Book page and the KPI tab is memoised for 15 s per viewer and project. Compiling a Data Book and issuing a handover always recompute it live.
- **Long lists:** the punch list (closed items), registers, vault folder documents and project audit log are windowed with a "Load more" link (`?limit=`); open punch items, documents awaiting review and the stat/KPI counts are always complete. Inspections, NCRs, observations and notifications use numbered pages.
- **Error reporting:** when `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` are set, events from the web app and the worker pass through `scrubEvent` (apps/web/lib/observability/scrub.ts, copied to worker/src/observability/scrub.ts): no user, cookies, headers, request bodies, breadcrumbs or stack-frame variables are sent; emails, bearer tokens, JWTs, `token=`/`password=`-style parameters and `/verify/<kind>/<token>` links are masked in message text, URLs, transaction names and spans.

## 10. Incident notes
- **PDF shows a 'generated before the latest change' warning**: the NCR/inspection changed after that PDF was queued; click Regenerate.
- **PDF fails**: check `background_jobs` row (`status`, `error`). Check Railway logs (Chromium launch, memory, timeouts). Confirm the worker is running the latest deploy and `SUPABASE_SERVICE_ROLE_KEY` is valid. Re-queue by generating again from the app. Check the rate limit for the organisation.
- **Notification does not arrive**: check the `notifications` row exists for the user; for email check `RESEND_API_KEY`, `NOTIFICATIONS_EMAIL_FROM`, Resend dashboard; for automation alerts check the rule is enabled and the worker sweep ran (worker logs).
- **Users report 'Too many requests'**: a per-user API limit (see section 9) was hit; it clears within the `Retry-After` interval. Persistent cases usually mean a client retry loop; check the offline outbox on that device.
- **User cannot see a project**: check their grant (org-wide vs project-scoped), that the party is active on the project (`project_parties.is_active`), the party login is provisioned/linked to their user, and the module is licensed for the org (Module Licensing).
- See also `docs/INCIDENT_RESPONSE.md`.

## PDF integrity seal, seat overrides and orphan photos (migrations 20261115000101 and 20261115000102)

- **Integrity seal, not a digital signature.** After the worker renders a handover certificate or IRN it stores the SHA-256 of the exact PDF bytes (`rendered_pdf_sha256s`, append-only; Data Books keep `rendered_book_sha256`). The public page `/verify/<kind>/<token>` has a "Check a file you hold" box: the file is hashed in the browser (never uploaded) and compared with the recorded hashes. A PDF cannot contain its own final hash, so the footer prints a short *content seal* (hash of the source data); the bytes hash lives in the database. A match proves the file is unchanged since the system produced it. It does NOT identify a signer and is not a PAdES/X.509 signature; a true cryptographic signature needs a signing certificate (and ideally an HSM or a trust-service provider), which this deployment does not have. Documents rendered before the migration have no recorded hash until they are regenerated.
- **Seat limits.** The `access_grants_org_seat_limit` trigger blocks a new login over the limit. A JAGS Admin can tick "Override seat limit" with a reason (5+ characters) when adding staff access or provisioning a party login; a single-use row in `seat_limit_overrides` (valid 10 minutes) lets that one insert through and an audit event `seat_limit_overridden` is written. No limit set means no change. The Plans page shows usage against the limit.
- **Orphaned photos** (Settings, Orphaned Photos): an Admin can Keep, Mark removed, or Remove file. Remove file deletes the stored object only for a row still flagged, with nothing referencing it, after typing REMOVE FILE; the decision is recorded through `review_orphan_photo` and audited.
