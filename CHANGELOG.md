# Changelog

All notable changes to QMP Inspect. Newest first. The same entries are shown in the app under What's new
(`apps/web/lib/release/notes.ts`); edit both together. Derived from `git log` on `dev` and `docs/fixes/REMAINING.md`.
Nothing here has been run against the live database or in a browser; see `docs/fixes/REMAINING.md` section A for what the owner must do
before and after deploying.

## October 2026 release (on `dev`, not yet tagged) - 2026-10-08

Version number: [OWNER TO FILL: release version once tagged]

Reviewer comments, bulk IRN issue, audit-trail export, per-project report packs, an Arabic interface for the main screens, and a round
of security and reliability fixes.

### New
- Reviewer comment threads on completed inspections: post, reply and resolve.
- Bulk IRN issue: up to 50 release notices at once, with a result for each.
- Project audit-trail export as CSV or PDF.
- Per-project weekly and monthly report packs, filed into each project's vault.
- Admin alert when a background job fails for good (sent once per job).
- Optional two-step sign-in with an authenticator app (`NEXT_PUBLIC_ENABLE_MFA=1`).
- Arabic interface for sign-in, dashboards, the project list and shared tables, with right-to-left layout.
- iPhone HEIC photos converted to JPEG in the browser when the browser cannot show them.
- Orphaned photo review screen, seat-limit overrides with a reason, PDF integrity seal on certificates and IRNs.
- Document retention rules that flag old documents for review (nothing is deleted).
- Privacy notice (`/privacy`), terms of use (`/terms`) with a one-time acceptance banner, Help and support page, What's new page, footer links.
- Operations and compliance documents: rollback plan, incident response with severity levels and contacts, privacy notice,
  subprocessors (now including Resend and Sentry), data subject requests, risk acceptance register.

### Improved
- Faster pages: fewer database round trips per request, lighter statistics on the NCR and Observation registers, calmer live refresh.
- Long lists load in windows with a Load more link; phone-friendly card layout for plain tables.
- Loading skeletons on detail, list and form pages.
- Closed projects show a Closed badge in the project list.
- Clearer messages for seat limits and failed loads.

### Fixed and secured
- Inspectors can no longer update projects; non-admins are limited to the project details fields.
- Duplicate NCRs and observations from an offline retry are blocked in the database (`request_id` unique index).
- One approved vault copy per document reference; approving a new revision retires the old one in one step.
- Database limit on active parties per type, matching the app.
- Offline checklist answers: three conflict cases fixed.
- Internal-only database helper functions are no longer callable by signed-in users.
- Content security policy enforced (`CSP_REPORT_ONLY=1` reverts without a code change).
- Next.js 16.3.8 and patched transitive dependencies: 22 audit findings reduced to 2 (the open `extract-zip` findings are in
  `docs/RISK_ACCEPTANCE.md`, unsigned).

### For administrators
- New migrations, apply one at a time in order (all idempotent, forward-only): `20261118000100` to `20261124000100` as listed in
  `docs/fixes/REMAINING.md`, and `20261128000100_users_terms_acceptance` (adds nullable `users.terms_accepted_at` and
  `users.terms_version`). The app works before each is applied.
- Redeploy the Railway worker (failed-job alerts, per-project packs, audit-trail PDF).
- Set `NEXT_PUBLIC_SUPPORT_EMAIL` so Help and support shows a real contact.
- Complete every `[OWNER TO FILL: ...]` placeholder in the new documents and pages before relying on them.

## Earlier work

Everything before this release (phases 0 to 8: tenancy and RLS, ITPs, checklists and inspections, NCRs, observations, punch list,
Data Book and handover, document vault, registers, notifications, offline mode, AI drafting, audit log, worker PDFs) is in the git
history and in `docs/PROJECT_AUDIT_AND_PHASE_STATUS.md`. No earlier version was tagged, so there is nothing to diff against.
