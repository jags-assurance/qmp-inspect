# UI review, stage 2: field execution and closeout screens

Scope: checklist execution, start-work, standalone assignment, vault, data book, handover, shared signature pad.
Method: code reading only (no browser). Heights below are computed, not measured.

## Logic regression check
`git diff 346c29e HEAD` on every file in scope. Presentation-only in the redesign commit (39912d3), with two exceptions that are NOT redesign work:
- Vault `approve-document-button.tsx` (approval comment step) comes from commit 6c89c11; `upload-form.tsx` (org upload limit, title from filename, next-revision hint) from 6c89c11 and 8bece0a. They were earlier feature commits inside the diff range.
- `item-photo-upload.tsx` gained a second hidden file input (camera, `capture="environment"`) sharing the same `handleFileChange` and offline helper. New UI path, same logic. Both inputs reset after upload.
- `response-row.tsx`: `attentionReason` is derived display state only. Radio buttons, `save()` calls, form data, hidden inputs unchanged. Standalone `signature-pad.tsx` keeps the same `signature_data` field, action and outbox calls; only the canvas moved to the shared pad.
No offline queue or lib change found.

## Findings (ranked)

### Major
1. **Segmented Yes/No/N/A is not keyboard-correct.** `response-row.tsx:~520-545`: `role="radiogroup"` with `role="radio"` buttons, all three are Tab stops, no arrow-key handling, no roving tabindex. Screen-reader and keyboard users get a radio role without radio behaviour. OPEN (needs a key handler; left alone as it touches interaction logic). Suggested: roving tabindex plus Left/Right/Up/Down selecting.
2. **Sticky bottom bar disappeared at tablet width** (was md:static via StickyActionBar), and the two-column layout started at 1024. On a 1024x768 landscape tablet the items column was only about 480px (rail 72 + padding 64 + 24rem aside + gap), and "Next unanswered" / "Complete" were hidden. FIXED in `checklist-execution-panel.tsx`: breakpoint raised lg to xl (1280), and the bar is now an explicit sticky div (the shared component's md reset cannot be overridden because `cn` is clsx only, no tailwind-merge). 768 and 1024 now keep the sticky bar and a single column.
3. **Short landscape phones (e.g. 812x375) lost most of the viewport.** Sticky progress (about 105px) + header 56 + bar about 72 = 233 of 375, leaving about 140px. FIXED for the progress header: sticky only when viewport height >= 520px. The bottom bar still sticks (72px); acceptable.
4. **Phone portrait budget (375x667):** header 56 + progress about 105 + bar about 116 (plus notice height) = about 277, leaving about 390px (58%). Usable, not generous. OPEN suggestion: collapse the sync line into the progress row, or hide the progress card's sync text when the bar already shows state.

### Minor
5. `checklist-execution-panel.tsx` `jumpToNextUnanswered`: smooth scroll ignores `prefers-reduced-motion`, and does not move focus to the item. OPEN.
6. Per-card badge uses `role="status"` on every card needing attention; on load a long checklist can announce many live regions. The whole sticky progress block is also `aria-live="polite"` including the progressbar, so each answer re-reads it. OPEN.
7. `response-row.tsx`: `attentionReason ? "border-warning" : result ? "border-border" : "border-border"` has a redundant branch (harmless dead code). OPEN.
8. Badge contrast checked: warning #8a6100 on 10% tint about 4.7:1, success #1a6b42 and muted pass AA. "Unanswered" muted on sunken passes. OK.
9. `structure-panel.tsx` nav pill classes `block ... inline-flex` conflict (inline-flex wins by CSS order). Remove `block`. OPEN.
10. Signature pad: second simultaneous touch (palm) starts a new stroke and overwrites `current`; `pointerup` does not check the pointer id; a single accidental tap counts as a signature (one-dot stroke enables Complete). OPEN, suggest ignoring strokes under about 3 points total length.
11. Signature pad canvas had no accessible name. FIXED: `role="img"` and `aria-label` added (canvas still needs a typed name as the accessible alternative, which the forms already require).
12. Signature export is a transparent PNG; fine on white PDFs, would be invisible on a dark background. Same as before. Note only.
13. Handover accept/reject forms: Reject submit is `primary` next to Cancel in the sticky bar; no destructive-colour variant. Suggest `danger` styling for Reject. OPEN.
14. Pad redraw: `fit()` resets bitmap on every ResizeObserver tick and redraws vectors with correct dpr transform; incremental drawing between ticks uses the stroke style set by the last redraw. Correct. No hydration risk (all client, effects only).

### Suggestions
- Add a visible "Retry" count or time to the "Not saved" badge; persist offline queue count in the progress card.
- 56px Yes/No/N/A grid is good with gloves; consider 3-column grid also for numeric items' N/A (currently full width, fine).
- `Disclosure` could replace remaining `MoreDetails` later.

Counts: Blocker 0, Major 4 (2 fixed, 1 partly fixed, 1 open budget note plus the keyboard issue open; see list), Minor 10 (2 fixed incl. aria label), Suggestion 3.

## Fixed in this pass
- `app/inspect/checklists/[templateId]/checklist-execution-panel.tsx`: all `lg:` layout classes to `xl:`; progress header sticky only when height >= 520px; StickyActionBar replaced by an identical sticky div that no longer turns static at md (so the bar stays at 768 and 1024); import removed.
- `components/domain/signature-pad.tsx`: canvas `role="img"` and aria-label.
- Verified: `npx tsc --noEmit` clean; `npx vitest run` 179 files, 1370 tests pass.

## MANUAL DEVICE CHECKLIST (plain language)

Use a draft inspection with about 10 items, at least one mandatory, one needing a comment on No.

**Phone 375x812 and short phone 375x667 (touch)**
1. Open a checklist. The progress strip sits just under the top header and stays there while scrolling; it shows "x of y answered", percent, a bar, and a saved or offline line with an icon.
2. Tap Yes, No, N/A on an item: each button is tall (about 56px), full width in thirds, selected one is solid with a tick; the card badge changes to Answered. Tap No: a red "Comment needed" badge and a warning border appear until you type a comment.
3. Tap "Take photo": camera opens. Tap "From gallery": photo picker opens. Thumbnails are 56px; a queued (offline) photo says Queued.
4. The bottom bar shows count and the reason ("3 mandatory items still to answer"), plus "Next unanswered" and "Complete inspection" (greyed until all answered). Tap Next unanswered: page scrolls so that item is centred and not hidden under the strip. On 667px height, at least half the screen must still show the item.
5. Answer everything: button turns "Add evidence" if no photo; with a photo it scrolls to the sign-off card. Sign with a finger: page must not scroll while drawing; Undo removes the last stroke; Clear empties. Rotate the phone mid-signature: signature stays (redraws). Complete button is full width.
6. Switch to airplane mode: the line changes to the offline wording with a warning icon; answers still tick.

**Landscape phone 812x375**: progress strip should NOT stick (it scrolls); the bottom bar is a single row. Check an item is still readable between header and bar.

**Tablet 768x1024 and 1024x768**: single column, items as cards; sticky bottom bar visible at both sizes with Next unanswered and Complete inspection; evidence and sign-off cards sit under the items. Buttons all 48px+. Signature pad is full width, 160px high.

**Laptop 1280x800, 1440x900, 1920x1080**: two columns: items left, right column (evidence, sign-off) stays in view and scrolls on its own; bottom bar gone; progress becomes a bordered card pinned under the header and does not overlap the right column's top. 1280 has the left column about 700px wide.

**Other pages (at 375, 768, 1280)**
- Start work: search with scan stays visible; Filters opens a sheet on phone; Enter submits; quick-filter pills scroll sideways; one full-width Start/Continue/View button per card.
- Standalone assignment: sign a witness, role and name fields are 44px+, one column on phone; tables become cards under 768.
- Vault folder: upload one file, title fills from the filename; approve asks for a comment; cards under 768.
- Data book: structure list as cards on phone with 44px Jump/Open links; section pills stick under the header without covering the first heading.
- Handover: Acknowledge and Reject open inline, checkbox is 20px with a large tap row, bottom bar sticks on phone; make sure Reject cannot be hit by accident next to Cancel (large gap).

Also check with a floating notice showing (offline banner): the bottom bar must sit above it, not under it.
