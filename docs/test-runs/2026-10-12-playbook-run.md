# Real-World Test Playbook run, 2026-10-12

- **Environment:** dev, https://jags-qmp-client-dev.vercel.app (build `63515af`)
- **Method:** automated, with Playwright and the seeded demo logins.
- **Fixes:** the fixes below are on branch `claude/loving-planck-32yzrn` and are **not deployed yet**.

## 1. What was run

| Playbook | How | Result |
|---|---|---|
| A1, M5 to M8 (logins, landing pages) | `e2e/tests/01-login.spec.ts`, all 7 roles | 13 / 13 pass |
| M1 to M7 (what each role must NOT reach) | `e2e/tests/02-access.spec.ts` | 47 / 47 pass |
| K, L4 (every list page, every role) | `e2e/tests/03-list-pages.spec.ts` | 100 / 100 pass |
| Read-only walk, per role (project > ITP > checklist > inspection > NCR > vault > handover) | `e2e/tests/04-walk.spec.ts` | Admin 10/10 on re-run. Other roles had failures caused by dev slowness, see 3.3 |
| A2 create org, A2 AI consent, A4 create project | `e2e/scripts/itp-generation-run.mjs` | Pass |
| B1 upload sample documents, script refusal | same script | Pass. All 5 files filed; `.sh` refused with the right message |
| B1 text extraction ("Ready" for AI) | same script | **Fail**: both PDFs "Could not be read" (bug 1) |
| B2 Generate draft | same script | **Fail**: page crashes, "Something went wrong" (bug 2) |
| B3 to J, L1 to L3 | not run | Blocked by bug 2 until it is deployed (ITP actions); they also need multi-role writes |

Data created on dev:
- organisation **Test Harbour Power** (AI consent given)
- project **THP-2026-001**
- vault documents THP-2026-001-JAGS-VAULT_DOCUMENT-001 to 005

Cleanup is per playbook section 4.

## 2. Bugs found and fixed

### Bug 1: every PDF upload "Could not be read", so no PDF can feed the AI ITP draft

- **Cause:** in the deployed bundle, pdf-parse's pdfjs-dist cannot load `pdf.worker.mjs`. The error is "Setting up fake worker failed: Cannot find module .next/server/chunks/pdf.worker.mjs".
- **Reproduced:** in a local production build. DOCX and TXT were not affected.
- **Fix:** `apps/web/next.config.ts`
  - `serverExternalPackages: ["pdf-parse", "pdfjs-dist"]`
  - `outputFileTracingIncludes` for the worker file
- **Verified locally:** after the fix the same PDF extracts (`done`), and the worker is in the deploy trace of the vault upload page and the email-inbound route.
- **After deploy:** re-upload the PDFs, or upload a new revision. Already-failed documents are not re-extracted.

### Bug 2: "Generate draft" crashes the New ITP page (Error ID `...@E352`)

- **Cause:** `apps/web/lib/itps/actions.ts` is a `"use server"` file and exported a constant array (`TRANSLATION_LANGUAGES`). Next.js only allows async-function exports there. It throws E352 when the page's actions load, so the action failed with HTTP 500 after about 4 s.
- **Introduced:** 2026-10-07, commit `bcfab11`.
- **Impact:** 11 app files import this module, so other ITP actions on those pages are likely affected too.
- **Fix:** the constant is no longer exported.
- **Guard:** a new check in `lib/__tests__/client-boundary.test.ts` fails on any non-function export from a `"use server"` file. It fails on the old code and passes with the fix.

### Also fixed

- A typo in the ITP-draft AI prompt: "checklist he inspector".

## 3. Other findings (not code changes)

1. **Playbook B2 is out of date.** A project whose organisation has no AI consent is simply not listed under "Generate from vault documents". No "AI is not available" message is shown for it. Testers must do the optional "Give AI consent" in A2 first. This is now noted in `docs/sample-itp-sources/README.md`.
2. **Playbook 1.5:** the sample-documents folder now exists (`docs/sample-itp-sources/`).
3. **Dev is slow.** Checklist pages took 35 to 45 s for every role, and one sign-in probe hit a network timeout. When a walk step passes the 45 s probe limit, the next steps in that role fail in under 100 ms as a cascade. On re-run the same steps passed (Admin 10/10), and `/api/health` answered in about 1 s with all checks ok. Worth a look at checklist page performance.

## 4. Re-test after deploying the fixes

```bash
cd apps/web
ITP_RUN_CONFIRM=1 node e2e/scripts/itp-generation-run.mjs   # B1 extraction + B2 + draft scoring
```

1. Re-upload the two PDFs first (new revisions), or delete and re-upload them, so they extract.
2. Then score the draft:

   ```bash
   node ../../docs/sample-itp-sources/verify-draft.mjs e2e/.state/itp-generation/draft.json
   ```

3. Then continue the playbook by hand from B3.
