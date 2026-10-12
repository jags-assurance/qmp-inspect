# Sample ITP source documents (THP-2026-001)

Source documents for **Section B** of the QMP Real-World Test Playbook: upload them to the
Document Vault of project **THP-2026-001 Switchroom Electrical Fit-out** (client Test Harbour
Power), then use **ITPs > New ITP > Generate from vault documents**.

All content is original and written for this test. IEC numbers are cited by number only.
To rebuild the files: `python3 docs/sample-itp-sources/build_samples.py` (needs `python-docx`, `reportlab`).

## 1. Which file goes in which Vault folder

| File | Vault folder | Title | Document reference | Rev |
|---|---|---|---|---|
| `THP-SPEC-E-001_RevA_LV_Switchroom_Specification.docx` | Specifications | LV Switchroom Specification | THP-SPEC-E-001 | A |
| `THP-ES-200_Rev1_Client_Electrical_Standard.pdf` | Standards & Codes | Client Electrical Installation Standard | THP-ES-200 | A |
| `THP-MS-E-003_RevA_Method_Statement.docx` | Method Statements | Method Statement LV Switchboard | THP-MS-E-003 | A |
| `THP-DWG-E-101_RevA_SLD_and_Cable_Schedule.pdf` | Drawings | SLD and Cable Schedule | THP-DWG-E-101 | A |
| `THP-MAT-E-002_RevA_Material_Submittal_Schedule.txt` | Material Submittals | Material Submittal Schedule | THP-MAT-E-002 | A |

The set covers the three extraction paths: Word (.docx), PDF with a text layer, and plain text.
After upload each one must show **Ready** in the New ITP document picker. "Could not be read" on a
PDF is the bug fixed in `apps/web/next.config.ts` (pdf.worker.mjs missing on the server).

### Negative tests (`negative-tests/`)

| File | Use it in | Expected |
|---|---|---|
| `refuse-me.sh` | B1, any folder | Refused: "Executable/script files can't be stored in the vault" |
| `scanned-no-text-layer.pdf` | B1, General Reference | Uploads, but is **not** selectable for AI (no text to read) |
| `unrelated-canteen-menu.txt` | B2, tick it with the real set | The AI must not invent activities from it |
| `bad-draft.example.json` | verifier self-test | `verify-draft.mjs` reports FAIL |

Revision test (B1, last step): upload the specification again with the same document reference
`THP-SPEC-E-001`. Accept the "Possible duplicate or new revision" notice. Expect revision B; A is
marked Superseded; nothing is deleted.

## 2. What a good ITP draft must contain

`expected-itp.json` is the answer key: 15 required + 3 optional activities. In short:

| # | Activity | Must say (acceptance) | Reference | Intervention |
|---|---|---|---|---|
| A01 | Receiving inspection of MSB-04 vs submittal | 1600 A nameplate | SPEC 3.1 / MAT Item 1 | R |
| A02 | Cable drums, mill certificate (CoC) | CoC per drum | SPEC 3.2 | R |
| A03 | Switchboard levelling and anchoring | 2 mm per metre | SPEC 5.1 / DWG note 1 | S |
| A04 | Cable tray | supports <= 1.5 m, fill <= 40 % | SPEC 4.1 | S |
| A05 | Cable pulling | bend radius 12 x D, 300 mm segregation | SPEC 4.2 | S |
| A07 | Terminations | torque to manufacturer value, torque-marked | SPEC 5.2 | W |
| A08 | Earth electrode | <= 1 ohm, before backfill | SPEC 6.2 / ES-200 4.3 | **H** |
| A09 | Protective conductor continuity | <= 0.5 ohm | SPEC 6.3 | R |
| A10 | Insulation resistance F1-F4 | 1000 V DC, >= 100 Mohm | SPEC 7.1 | **H** |
| A11 | Polarity and phase rotation | L1-L2-L3 | SPEC 7.2 | R |
| A12 | Earth fault loop impedance | ES-200 Table 2 (0.16-0.40 ohm) | SPEC 7.3 | R |
| A13 | RCD trip times | <= 300 ms, <= 40 ms at 5x | SPEC 7.4 | R |
| A14 | Protection settings, secondary injection | per THP-PCS-001 | SPEC 7.5 | **W** (client, TPI) |
| A15 | Functional test | breakers, interlocks, indication | SPEC 7.6 | **W** (client) |
| A16 | First energisation | 415 V +/- 6 %, imbalance < 2 % | SPEC 7.7 | **H** |
| A06, A17, A18 | Cable ID, labelling, handover dossier | optional | SPEC 4.3, 8.1, 8.2 | — |

Evidence type: the tests (A08-A16) should be **Measurement record**; submittal checks **Document
upload**; installation checks **Checklist**.

Red flags (fail the draft): a cited THP document number that does not exist (only THP-SPEC-E-001,
THP-ES-200, THP-MS-E-003, THP-DWG-E-101, THP-MAT-E-002 and THP-PCS-001 exist); an IEC standard other
than 61439 / 60364; a changed limit (e.g. 10 ohm instead of 1 ohm); insulation resistance or first
energisation without a Hold; anything taken from the canteen menu.

## 3. How to verify a generated draft

**By hand:** compare the draft page with the table above, activity by activity.

**Automatically:**

1. On the "AI-assisted draft" page open DevTools > Elements, search `draft_json`, copy its `value`.
2. Save it as `draft.json`.
3. `node docs/sample-itp-sources/verify-draft.mjs draft.json`

It prints OK / PARTIAL / MISSING per activity and any grounding issues, then `RESULT: PASS` (exit 0)
when required coverage >= 90 %, detail accuracy >= 75 % and nothing is hallucinated.
`reference-draft.example.json` is a hand-written draft that passes, for comparison.

**End to end on dev (writes data):**

```bash
cd apps/web
ITP_RUN_CONFIRM=1 node e2e/scripts/itp-generation-run.mjs
```

Signs in as the demo Admin and runs playbook A2 (organisation + AI consent), A4 (project), B1
(uploads + script refusal + extraction) and B2 (Generate draft), then scores the draft. Steps that
are already done are skipped. It refuses to run against the live address. Results and screenshots go
to `apps/web/e2e/.state/itp-generation/` (git-ignored).

Note for B2: a project only appears in "Generate from vault documents" when its organisation has
**AI consent** (Settings > Client Organisations > Give AI consent). Without consent the project is
simply missing from the list; there is no "not available" message for it.
