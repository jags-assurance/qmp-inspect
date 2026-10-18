# ITP generation from vault documents: review

Scope: code, prompt and schema review plus offline tests. No real specification was available and no live AI call was made, so output quality on real documents is unverified (see "Needs a real spec" at the end).

## 1. How the pipeline works today

1. **Entry.** `app/inspect/itps/new/new-itp-from-ai-form.tsx` (third tab beside manual and master-template). The user picks a project, ticks vault documents (only those with `extraction_status = done` are usable), optionally adds free-text scope and an activity-count mode (concise/standard/detailed/custom, which is just an extra instruction line).
2. **Draft action.** `generateItpDraftAction` in `lib/itps/ai-draft-actions.ts`:
   - checks the AI consent/tier gate (`assertAiAllowed`);
   - loads active project parties, active master disciplines and the org's `intervention_level_types`;
   - loads the selected `vault_documents` rows (scoped by RLS, must belong to the project, must have extracted text);
   - hashes the input and returns a cached response if the same inputs and prompt version were seen (`lib/ai/cache.ts`);
   - otherwise calls `geminiProvider.generateItpDraft` (heavy tier, JSON output);
   - logs usage and the raw response (`logAiUsage`), suggests an ITP number (preview only, released straight back);
   - **new:** runs `validateItpDraft` and returns the validated draft plus notices.
   Nothing is written to ITP tables at this point.
3. **Prompt/parse.** `GeminiProvider.generateItpDraft` (`lib/ai/gemini-provider.ts`, prompt `itp-draft-v3`). Each document is wrapped in an untrusted-data block headed `DOC-REF | TITLE | CATEGORY`; combined text is capped at 300k chars (per-document extraction already caps at 120k). The prompt fixes four sections (Submittals & Materials, Installation/Execution, Testing & Commissioning, Handover), demands short text, requires `reference_spec` as "doc number Rev, clause", and asks for per-party intervention suggestions with Holds limited to roughly 10-20% of activities. The parse step caps sections (12) and items per section (40), sanitises text, drops unknown discipline codes, and drops interventions with a level outside H/W/R/S or an unknown party.
4. **Review UI.** The draft lives in React state; every field is editable, items can be added or removed, a per-party level grid uses the org's levels, and the user can regenerate with feedback.
5. **Confirm.** `createItpFromDraftAction` re-normalises the posted JSON (`normaliseSubmittedDraft`), creates the ITP, sections, items, then `activity_party_intervention` rows (filtered to real project parties and org level codes), closes the AI audit row, generates checklists (staff only) and audits creation.

## 2. What the output schema captures per activity

| Requirement | Field | Notes |
|---|---|---|
| Activity | `activity` (600 chars; prompt asks for at most 12 words) | |
| Acceptance criteria | `acceptanceCriteria` (1200; prompt asks for at most 25 words) | Free text; no structured value/unit/tolerance |
| Spec clause | `referenceSpec` (300) | Free text "DOC-REF Rev, clause"; one string, no structured link to the vault document |
| Method | `method` | |
| Frequency | `frequency` | Free text, not machine-readable |
| Evidence type | `evidenceType` 1 checklist / 2 document upload (3 is legacy) | |
| Intervention per party | `suggestedInterventions[{projectPartyId, intervention, reason}]` | `reason` is shown only as a tooltip and is not saved |
| Discipline | `disciplineCode` | Validated against master disciplines |
| Numbering | `itemNumber`, section number | |

Not captured: source document id, page, source excerpt/quote, confidence, hold-point sequence/dependency (what must be signed before what), responsible party, records/form references, whether the item is a hold for a specific event (cover-up, energisation).

## 3. Weaknesses found

Severity: H = affects trust in the core feature, M = quality/effort, L = polish.

1. **(H) No clause traceability.** `referenceSpec` is model-written free text. Nothing checks it cites a real attached document or that the clause exists. The source document id and text excerpt are not stored on the item, so a reviewer must hunt through the PDF to verify each line. (`generateChecklistItems` accepts a "source excerpt" input but the ITP draft never captures one.)
2. **(H) No confidence or needs-review signal.** Every line looks equally authoritative, so field staff must re-read everything. Addressed in part below (rule-based flags only; the model does not self-report uncertainty).
3. **(H) Intervention levels validated against the wrong set at parse time.** The provider accepts only H/W/R/S (hardcoded), while the org may have custom levels or may have removed some. Mismatches were only filtered at insert time, silently, after the reviewer had approved. The prompt also hardcodes the H/W/R/S meanings. Addressed below for validation; custom-level semantics in the prompt remain open.
4. **(H) Long documents are truncated silently.** Extraction is capped at 120k chars per document and 300k combined; later documents are replaced by an "omitted" marker. The user is never told a document was cut or skipped, so a spec's later clauses (often testing and handover) can be missing from the ITP with no warning. There is no chunking or multi-pass strategy, and one large JSON response can also hit the output-token limit and fail or truncate.
5. **(M) Fixed four-section layout.** Forced into Submittals / Installation / Testing / Handover regardless of the spec's structure. This suits many ITPs but may not match the client's ITP template layout (phases, work-front or system based). The layout is the heart of the execution flow, so it needs confirmation with the client's real sample ITPs.
6. **(M) Duplicates.** With several documents (spec plus method statement plus standard) the same check is often restated; nothing de-duplicated. Addressed below (conservative merge).
7. **(M) Numbering.** Model numbers could repeat or be blank; only the confirm step patched this, after review. Now normalised before display.
8. **(M) Per-section cap of 40 and the "4-8 per section" instruction** conflict with real multi-discipline specs; items beyond 40 are silently dropped at parse time with no notice.
9. **(M) Multi-document conflicts** are handled only by prompt wording (state both values). There is no structured conflict flag for the UI.
10. **(M) Holds quota in the prompt (10-20%)** is a statistical instruction, not a rule derived from the spec. Genuine hold points defined by a method statement or the contract could be under-assigned. Needs real-spec evaluation.
11. **(M) Cache** keys include the full source text and parties, which is correct, but a cached raw draft was returned without re-validating against the org's current level types. Now validated after the cache lookup, so a changed level configuration is honoured.
12. **(L) Evidence type** is binary (checklist vs document); measurements are modelled as documents. Fine for now.
13. **(L) Interventions `reason` is dropped on save**, losing the AI's rationale for the audit trail (the raw draft is in the AI log, so it is recoverable).
14. **(L) Sanitiser is generic** (`sanitizeAiText`); it strips HTML-like text such as `<5 mm> tolerances` written with angle brackets. Worth a fixture test with real spec phrasing.

## 4. What was implemented (offline, tested)

- `apps/web/lib/itps/draft-validation.ts` (pure, no network/DB):
  - `validateItpDraft(draft, {levelCodes, partyIds, disciplineCodes})`: rebuilds each field with length limits and sanitising; drops interventions whose level code is not in the org's `intervention_level_types` (case-insensitive match to the org's spelling, so custom codes survive) or whose party is not on the project; one intervention per party; clears unknown discipline codes; drops empty activities; merges near-duplicate activities (same section: token similarity at least 0.85 with a compatible reference; across sections: near-exact text and identical non-empty reference), carrying over missing party sign-offs; guarantees unique non-empty item numbers; returns plain-language notices.
  - `computeItemReviewFlags(item)`: an activity "needs review" if acceptance criteria are empty, say the value is unconfirmed (TBC / "project-specific value not yet confirmed", which is the wording the prompt already instructs), or the reference is empty or has no clause number. Pure, so the UI recomputes it after every edit and the marker disappears when the reviewer fixes the field.
- `generateItpDraftAction` validates after both cache hit and fresh generation; the audit log keeps the model's raw answer. `GenerateItpDraftState` gained `draftNotices`.
- Review UI (`new-itp-from-ai-form.tsx`): amber "Needs review: <reason>" badge and border on flagged activities, a summary badge ("N of M activities need review"), a "Show only activities that need review" filter, and the validation notices.
- Tests: `lib/itps/__tests__/draft-validation.test.ts` (fixture drafts, no network).
- No prompt, schema or database change. The flag is UI-only and is not persisted onto the ITP.

## 5. Prioritised improvements (not yet done)

**P0, needs the real spec to design and verify**
1. Source traceability: add `source_document_id` plus a short `source_quote` to the draft item (and an optional column or note on `itp_items`), validate that the cited DOC-REF matches an attached document, and show the quote beside the item. Prompt change: add `source_doc_ref` and `source_quote` to the JSON shape.
2. Run the prompt on 2-3 of the client's real specs and compare against their hand-written ITPs: layout, hold-point choices, completeness. Add golden fixtures from that.
3. Confirm the target ITP layout with the client (sections, columns, phases) and make the section scheme configurable or derived from the spec.

**P1**
4. Long documents: tell the user which documents were truncated or omitted (carry `truncateWithNotice` and the omitted marker back to the UI), then chunk by heading, generate per chunk and merge (reusing the de-duplication added here). Needs a retry or continue strategy for oversized JSON.
5. Per-item model confidence or a `needs_review_reason` field (e.g. "value assumed from standard", "conflicting documents") in the prompt and schema, merged with the rule-based flags.
6. Build the intervention-level legend in the prompt from the org's `intervention_level_types` (code, label, meaning) instead of hardcoded H/W/R/S, and widen `ItpDraftIntervention.intervention` from the literal union to string.
7. Persist the draft's flags and the intervention `reason` on the created ITP so approvers see what was uncertain.

**P2**
8. Hold-point logic from method-statement sequence (cover-up, energisation) rather than a percentage; dependency between items.
9. Structured frequency and acceptance values (value, unit, tolerance) for checklist pre-filling.
10. Raise or paginate the 40-items-per-section cap, and report when it is hit.
11. Regression tests for sanitiser behaviour on spec punctuation (`<`, `>`, `±`, `≥`).

## 6. Needs a real spec to validate

- Whether acceptance criteria, clause citations and tolerances are correct and complete, and whether the "TBC" wording is actually emitted when a standard supplies no project value.
- Hold/witness assignment quality, and whether 10-20% Holds is reasonable.
- Behaviour on scanned or noisy extraction, multi-discipline documents and documents beyond the truncation limit.
- Whether the fixed four-section layout and the deduplication thresholds (0.85 / 0.95) suit real ITPs; the thresholds are tuned on synthetic fixtures only.
- Output size/latency on large documents.
