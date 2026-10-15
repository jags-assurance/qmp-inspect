# UI stage 2, builder B4: field execution and closeout screens

Layout and presentation only. No handlers, server actions, queries, permissions or offline queue code changed.

## Screens migrated

- Checklist execution (`app/inspect/checklists/[templateId]`): `page.tsx`, `checklist-execution-panel.tsx`, `response-row.tsx`, `item-photo-upload.tsx`, `complete-inspection-form.tsx`.
- Start work (`app/inspect/start-work`): `page.tsx`, `scan-search-input.tsx`.
- Standalone assignment (`app/inspect/standalone/[id]`): `page.tsx` (PageHeader), `assignment-workspace.tsx` (tabs, clearance banner, facts card).
- Vault folder (`app/inspect/vault/[projectId]/[folderId]`): `page.tsx` (PageHeader), `upload-form.tsx`.
- Data book: `data-book-view.tsx` gates list, `readiness-panel.tsx`. Handover: `page.tsx` header and filter controls.

## Checklist execution design

- Phone (375): progress header sticks under the app header (answered x of y, percent, progress bar, mandatory remaining, saved/offline state, each with icon and text). Each item is its own card: question first, then a 3-column Yes / No / N/A grid (56px high, icon + text, selected state also announced to screen readers), then conditional blocks directly beneath (register warnings, measured value, comment-required, NCR, who-fixes, NCR reason), then evidence. A badge at the top right of each card shows Answered / Unanswered, or a warning badge with one reason (Not saved, Reason needed, Comment needed, Evidence needed); the card border turns warning-coloured for the latter. Item photos are two 48px buttons (Take photo using the camera input, From gallery), with 56px thumbnails and a "Queued" label for offline photos. The bottom `StickyActionBar` shows count plus a one-line reason ("3 mandatory items still to answer", "Add at least one photo or document first"), a "Next unanswered" button and "Complete inspection" (disabled until all answered; becomes "Add evidence" when only evidence is missing).
- Tablet (768/1024 landscape): same single column, content width up to 6xl; StickyActionBar becomes an inline row at md. Below lg the evidence and sign-off cards stack under the items.
- Laptop and desktop (lg+): two columns. Items on the left; right column (24rem, sticky, scrolls independently) holds Photo evidence, the Vault evidence picker and the sign-off or missing-evidence notice. The progress header becomes a bordered card and the bottom bar is hidden.
- Rationale: the field user needs to answer one-handed with a thumb, see what blocks completion without hunting, and on a laptop reviewers want summary and evidence beside the list instead of far below it.
- The sign-off form uses a full-width 48px Complete button. SignaturePad (shared `components/domain`) was not edited.

## Start work

Page uses PageHeader, FilterBar (search with scan stays visible; Filters sheet on mobile, wrapped in a single `<form method="get">` so submit and Enter still work), horizontally scrolling quick-filter pills (44px, icon + count), activity cards (2 columns from lg) with status, overdue, due soon, hold and assigned badges, due date, and one full-width 48px Start / Continue / View button.

## Uncertain or not done

- `Disclosure` from B0 did not exist when I worked, so I kept the existing `MoreDetails`/native `<details>` usage; swap later if desired.
- Not restyled (kept as-is, functional): standalone measurement/punch tables (horizontal scroll on phones), vault documents table (already a ResponsiveTable, filters inline), vault pending/document pages, markup viewer, compare view, standalone list/new pages, handover cards and acknowledge form, other data-book panels, loading skeletons. Time budget; they are layout-safe but not on the new design.
- SignaturePad canvas is fixed 480x160 scaled by CSS and has no Undo; adding Undo and a taller pad needs an edit of the shared component (not in my files).
- `capture="environment"` on the camera input in item photos matches what the inspection-level PhotoUpload already does.
- Repo-wide checks: `npx tsc --noEmit` showed errors only in other builders' in-flight files (sidebar-shell, external-party-dashboard) at the times I ran it, none in mine. `npx vitest run`: 1369 pass, 1 fails (`lib/__tests__/client-boundary.test.ts`: `app-shell.tsx` imports `SIDEBAR_PREF_KEY` from `sidebar-shell.tsx`), which is B0's shell work, not mine. No tests needed updating for my changes.

## Follow-up pass

- SignaturePad (`components/domain/signature-pad.tsx`): full-width canvas at fixed height (200px phone, 160px from sm), scaled for devicePixelRatio, strokes kept as vectors so rotation/resize redraws instead of wiping, `touch-action: none`, "Sign here" placeholder with a baseline, Undo and Clear (48px/44px on touch). Output is still a PNG data URL via `onChange(string | null)`. The standalone-assignment pad (`standalone/[id]/signature-pad.tsx`) now reuses it (same hidden `signature_data` field, offline queueing untouched); its dead canvas code was removed.
- Standalone measurements and punch list: `ResponsiveTable` (cards below md, delete/toggle actions kept on the card).
- Vault documents table: cards below md (`breakpoint="md"`, bordered). Pending approvals page: PageHeader + EmptyState. Document page: 44px back link, "Upload new revision" as a button, stronger superseded banner. Compare: PageHeader, 44px selects, full-width open button.
- Markup viewer: drawing in a scroll container with `touch-action: pan-x pan-y pinch-zoom` (max 75dvh), 44px pin targets on touch, full-size Drop pin / Cancel (stacked on phones), 44px pin list rows, usage hint.
- Handover: filter inputs 44px, certificate action links are buttons, Acknowledge and Reject/Reopen forms use larger inputs, 20px checkboxes, lg buttons inside `StickyActionBar`.
- Data book: structure panel renders a card list below md (no sideways scroll) and a sticky mini-nav under the app header with 44px pills; compile, issue, create, withdraw forms and PDF button use 44px inputs, larger buttons, StickyActionBar for compile and issue; done-activities tab pills 44px.
- Loading: vault, checklists, standalone, handover now have their own skeleton components (no more hand-rolled or re-exported skeleton).

### Still not done
- `done-activities-panel.tsx` and `updates-panel.tsx` tables still scroll horizontally inside their bordered container (shared `Table` helper across five tabs; converting needs a per-tab card design).
- `Disclosure` exists now but I kept `MoreDetails` in untouched spots; not migrated.
- Signature pad is still not verified in a browser (rules: no browser).
