# Real-World Test Playbook run, 12–13 October 2026

- **Environment:** dev, https://jags-qmp-client-dev.vercel.app. Build `63515af` for most of the run; `b56b6f6` from 13 Oct.
- **Method:** Playwright, driven by 6+ parallel agents using the seeded demo logins (one signed-in browser per role).
- **Fixes:** all on branch `claude/loving-planck-32yzrn` (merged with `origin/main`). **None is deployed to dev yet**, so every "blocked by bug" below should be re-tested after a deploy.
- **Raw evidence:** per-step rows with screenshots' names are in `docs/test-runs/raw/`.

## 1. Result by section

| Sec. | Result | Notes |
|---|---|---|
| A Admin setup | **Pass** | Branding, numbering, H/W/R/S levels, 5 parties and logins, a brand-new login forced to set a password, review chain, teams, staff access. |
| B ITP from documents | **Blocked** | Vault uploads, extraction and the script refusal pass. Generate draft and every ITP-page action crash on dev (bug 2). New-revision numbering was wrong (fixed). |
| C Party sign-off | **Blocked** | Needs an approved ITP on THP; ITP-page actions crash (bug 2). |
| D Site execution | **Pass / partial** | Start work, assign, hold-blocks-start, register soft-stop, photos, signature and complete all pass. D4 (waive notice) and the ITP side of D8 blocked by bug 2. |
| E NCR, punch, observations | **Pass** | Raise, respond, CAPA, close by a second person, withdraw, re-open, punch resolve/close/reopen, walk-down, observation with photo. |
| F IRN and reports | **Partial** | F1, F4, F5 pass. F2 "Issue IRN" fails on the MER record; F3 bulk IRN blocked by an empty Inspections list (fixed; migration needed for F2). |
| G Comments | **Pass** (G2 blocked) | G2 needs the ITP page. |
| H Vault approvals | **Pass** | Two-approver flow, reject with reason, revisions, search/filter/zip. Transmittal log shows but the email fails on dev (config). |
| I Registers | **Pass** | One minor gap (counts not on tabs), plus a contractor-approval issue (fixed). |
| J Reports, Data Book, handover | **Pass / partial** | Compile with override, withdraw, issue handover, client acknowledges, certificate PDF with QR. Clean compile and final book blocked by open items. |
| K Dashboards, KPIs | **Pass** with KPI definition differences | Every role's cards match their lists, except the in-progress inspections list (fixed). |
| L Notifications, audit, search | **Partial** | Audit log and Ctrl+K pass. Bell click fails on the dashboard (bug 2 family). Emails not verifiable. |
| M Negative checks | **Partial** | Menus and blocked addresses pass for all 7 roles. Inspector can open `/inspect/settings` (decision below). Button-level checks blocked by dev load. |

## 2. Bugs found and fixed (on the branch)

| Commit | Bug |
|---|---|
| `38edf0d` | **Every PDF upload "Could not be read"**: `pdf.worker.mjs` missing from the server bundle (`next.config.ts`). |
| `38edf0d` | **Generate draft / every ITP-page action crashed (E352)**: a "use server" file exported a constant. A new test fails on any non-function export from such a file. Probably also the cause of the bell-click failure (L1). |
| `0d04e19` | New revision of an existing document was saved as Rev 0 instead of Rev B. |
| `0d04e19` | Start work showed activities as ready that a Hold still blocked. |
| `8e2615a`, `860dfb0` | Checklist page showed "no items yet" when a read failed; page needed about 25 sequential database steps (now about 7) and reloaded on every answer anywhere. |
| `de1f96f` | "On hold" saved immediately with no confirmation; Reports & Documents Reset kept old filters; Download opened the file in the tab. |
| `075a9ff` | Observation register showed "none raised" under load; "Raise NCR" button label on an observation. |
| `67a134e` | Valid users bounced to "session ended" when the database was slow; a sign-in service outage showed "Invalid email or password" and counted toward the 5-attempt lockout. |
| `1800d97` | **Inspections list showed no rows for anyone** (page-size constant arrived empty) and ITP status chips had no labels. Boundary test now rejects ALL_CAPS constant imports from client files. |
| `368f0c8` | A contractor's new material entry showed "A — Approved" before any JAGS review. |
| `62befc9` | **"Issue IRN" fails on MER-JAGS-ITP-001-INSP-2**. Likely cause: the IRN counter is behind an existing IRN, so every attempt collides. New migration `20261202000100_issue_irn_skip_used_numbers.sql` (**must be applied**). Not confirmed without database access. |

All commits: typecheck clean, lint 0 errors, 1,220 web + 215 worker tests, production build.

## 3. Decisions for you

1. **Inspector can open `/inspect/settings`** (Teams and Client Teams sections). Code says deliberate (`settings/page.tsx:141`); playbook M5 says it must redirect.
2. **Clients can't see their monthly report packs.** The database limits them to JAGS staff (`20260927010000_ncr_closeout_certificate_pdf_job.sql`). Opening them up would also expose organisation-wide packs to subcontractors, main contractors and TPIs of that organisation.
3. **Punch items:** only a JAGS Admin or a "close punch item" permission can verify and close. The playbook says the Inspector.
4. **KPI definitions** differ from the playbook table: "ITP completion" counts client-accepted ITPs / all ITPs (playbook: activities passed / activities in approved ITPs); "Inspections completed" counts records, not items; the monthly trend buckets by creation date, so an inspection completed in October can land in September; "NCR close-out time" includes withdrawn NCRs.
5. **Activity feed** is built from current row state, not history, so re-opens, status changes and withdrawals are missing or shown as "closed" (the audit log has them all).

## 4. Still open / not verified

- **Dev must be redeployed** from this branch, and migration `20261202000100` applied, then re-test B2–B7, C, D4, D8 (ITP side), F2, F3 and M's button-level checks, and run `docs/sample-itp-sources` through `verify-draft.mjs`.
- **AI draft quality is still unscored**: Generate draft has not produced a draft yet (the crash fixed in `38edf0d`). Run `ITP_RUN_CONFIRM=1 node apps/web/e2e/scripts/itp-generation-run.mjs`.
- **Emails:** dev's email provider is in testing mode (only one address can receive); transmittals to fake addresses still fail rather than skip (`lib/transmittals/actions.ts`).
- Not run: J Reject package / on-behalf acknowledgement, M wrong-password lockout (code: 5 per email per 15 min), D4, live bell updates without reload.
- **Dev is slow under load**: checklist pages took 30–45 s before the speed fix; several agents were signed out or hit "Something went wrong". Measure again after the deploy.

## 5. Playbook corrections

Wording in the playbook that doesn't match the app: D4 (the waive-notice form appears only for a Witness that has **not** been notified); M1 (`/inspect/itp-master` sends the client to the ITP register, not the dashboard); K2 (no "Today's schedule" or "New inspection" on the Inspector dashboard); L3 (client cannot open the Audit Log); I (field names: "Cert number", "Qualified WPS", "Awaiting JAGS verification"); I2 (counts are in the banner, not on tabs); E6 (Admin, not Inspector, closes); F5 (re-open takes a reason of 15+ characters, no confirm dialog); NCR numbers include "-JAGS-".

## 6. Test data left on dev (remove per playbook section 4)

Organisation **Test Harbour Power** (AI consent given); project **THP-2026-001** (Active) with 6 parties, a team, 3 NCRs, punch items and walk-down, vault documents 001–008, registers (PB-*), Data Book DB-QA-J01 and handover HC-QA-J01 (acknowledged), a login `thp.vendor@example.test`; extra photos on MER checklist CHK-1; inspection MER-JAGS-ITP-001-INSP-2; UITEST-001 INSP-4 left **in progress** with its IRN voided; one Meridian monthly report pack.
