# UI review, stage 2: detail pages (ITP detail and sign-off grid, NCR, inspection, project hub and tabs, ITP master)

Method: code reading only (no browser, no database, no commit). After the fixes: `npx tsc --noEmit` clean, `npx vitest run` 179 files / 1370 tests pass.
Scope read in depth: `activity-signoff-grid.tsx`, `scroll-region.tsx`, `signoff-cell.tsx`, `cell-menu.tsx`, `item-controls.tsx`, `intervention-select.tsx`, `view-header.tsx`, the jump-to-section bar in `itp-detail-view.tsx`. The rest of the area (NCR, inspection, project hub and tabs, itp-master) was checked by diffing against 346c29e for behaviour changes only, not line by line for layout.

Functionality regression check: every permission gate (`canSubmitForReview`, `canApproveItp`, `canAccept`, `canPropose`, `session.isJagsStaff`, `canEditContent`), hidden input (`itp_id`, `item_id`, `revision_reason`) and server action in the diff was moved, not changed. SignoffCell's handlers were extracted (`doNotify`, `doSignOff`, `confirmReason`) with identical logic. One observation, not a regression: `add-project-party-form.tsx` has +171 lines (the "reuse parties already used in the organisation" feature). That is new behaviour from an earlier commit and was not reviewed for layout here.

## Findings

### Blocker
None.

### Major
1. FIXED. Sticky activity column painted over the sticky "Jump to section" bar. `activity-signoff-grid.tsx:148,164` used `z-10`, the jump bar (`itp-detail-view.tsx:1031`) is also `z-10` and earlier in the DOM, so on tablet and desktop the activity cells scrolled up through the bar and drew on top of it. Cells are now `z-[1]` (enough to beat the non-positioned party cells).
2. FIXED. Scroll was undiscoverable at desktop widths. Fade and hint were `xl:hidden`, but the grid needs 260 + 156 x N px: N=6 needs 1196 px (overflows a 1280 screen with the rail sidebar, about 1150 px of content), N=10 needs 1820 px (overflows 1440 and probably 1920). Users saw clipped columns with no cue. The fade and hint are now driven by actual overflow at every width from md up (`scroll-region.tsx`; the hint line moved into the client wrapper as a `hint` prop).
3. FIXED. Menu actions could double-fire. In compact SignoffCell the primary button was `disabled={isPending}` but the "..." menu items were not, so Sign off could be clicked from the menu while Notify was in flight (the old stacked layout disabled every button). Items now get `disabled: isPending`.
4. FIXED. Focus handling in `CellMenu`: (a) focus was moved into the panel while it was still `visibility:hidden` (before the position was computed), so it silently failed and focus stayed on the trigger. It now moves once positioned. (b) Choosing an item left focus on `body`; it now returns to the trigger when the trigger still exists. (c) Tab now closes the menu (the panel sits at the end of `<body>`, so Tab used to leave the page). (d) Panel top is clamped to the viewport so it never runs off a short landscape phone (375 px tall, 3 or more items).
5. FIXED. Choosing Reject, Sign with comment, Proceed or Request correction from the menu unmounts the button row and shows a textarea, so keyboard and screen-reader focus was lost. The compact reason textarea now takes focus when it appears (`autoFocus`).

### Minor
6. OPEN. Long status chips wrap inside a pill in a 156 px column ("Proceeded (no response)" is about 150 px of content in a 132 px cell). Wrapped `rounded-full` looks lumpy. Suggest `rounded-2xl` plus `leading-tight`, or shorten the label to "Proceeded" with the full text in `title`.
7. OPEN. `ItemControls` edit form (`item-controls.tsx:168-279`) sits inside the 260 px sticky activity cell. Fields are `text-xs py-1` (about 28 px high, below 44 px on touch) with `border-border` rather than `border-control-border`. It works, since fields wrap, but it is dense on a tablet and the form scrolls with the pinned column. Suggest the standard Input scale on coarse pointers, or a dialog or drawer for editing.
8. OPEN. `role="table"` semantics: the body cells of the first column are `cell`, not `rowheader`; the header row is outside any `rowgroup` (valid, but a `rowgroup` wrapper would be tidier). On phones the header row is `display:none`, so screen readers get a table with no column headers (party name is the visible label in each card cell, which is acceptable).
9. OPEN. The scroll region is a `role="region"` tab stop only while overflowing now (previously it was always a tab stop, including on phones where it never scrolls). Arrow-key scrolling after Tab works natively.
10. OPEN. `CellMenu` has no Home/End and no typeahead; ArrowUp and ArrowDown wrap. Acceptable for 2 to 7 items.
11. OPEN. Menu panel position uses `estHeight = items * 44 + 8` (the item is 40 px on desktop), so on desktop it flips up slightly earlier than necessary. Harmless.
12. OPEN. Sticky column has no shadow when scrolled; only the `border-s` of the next cell separates it. Fine in light mode, low contrast on tinted (blocking) cells. Suggest a small end-edge shadow only while `scrollLeft > 0`.

### Suggestion
13. A "Compact" or "Mobile card" toggle at md would let tablet users with 6 or more parties use the card layout instead of sideways scrolling.
14. Make party column headers sticky vertically (needs the region to scroll vertically as well, or a viewport-sticky header outside the scroll region); long sections lose the party names after one screen.
15. Print: the ITP detail page has no `.print-area`, so the browser Print command prints the whole app shell (the supported route is the PDF button). Pages that opt in (punch list, walkdown, itps/print) are unaffected. The `.overflow-x-auto` print override only applies inside `.print-area`, so a printed grid would be clipped; not relevant today.

## Verified OK (no change)
- One DOM, CSS-only breakpoints: the table, cards and cells are the same elements, so there are no duplicate ids, no duplicated 30 s timers and no double-fire. `labelId` uses the first row id, unique per section. The only `display:none` pieces are the header row and the read-only no-level party cells on phones.
- Mobile parity: every action is reachable. Activity title, Details, checklist, discipline, planned and notice badges, then one block per party with level select, status, countdown or warning, one primary action plus the "..." menu. Editors see all parties; read-only viewers do not see parties with no level.
- Column math (content width: 768 about 736; 1024 about 900 with the rail; 1280 about 1150; 1440 about 1310; 1920 about 1700 or the layout max). Needed width = 260 + 156 x N: N=3 is 728 (fits from 768, no scroll); N=6 is 1196 (scrolls at 768, 1024 and 1280, fits at 1440 and 1920); N=10 is 1820 (scrolls everywhere, with the activity column pinned and the hint and fade now shown). Below the floor the grid never collapses or overlaps; it scrolls.
- Portal menu: `fixed`, `z-30`, `role=menu` and `menuitem`, `aria-haspopup="menu"`, `aria-expanded`, Esc (stops propagation, refocuses the trigger), outside pointerdown, scroll (capture) and resize all close it. The confirm dialog is a `z-[60]` portal, so it is not capped by the sticky z-index.
- Jump bar: `top: calc(var(--header-h) + safe-area)`, section `scroll-mt` is header + 5rem, enough for a 44 px touch bar. Workspace tabs bar sticks at the same offset with `z-[5]`.
- Client boundaries are sensible: only `ScrollRegion`, `SignoffCell`, `CellMenu`, `ItemControls` and `InterventionSelect` are client; the grid itself is a server component.

## MANUAL DEVICE CHECKLIST

Use an ITP with at least 6 parties and 2 sections, as a JAGS staff user (and once as a read-only party user).

1. ITP detail, 375 x 812 (phone portrait)
   - Each activity is its own card: title and badges on top, then one block per party. Tap Details, the evidence pill and the "..." menu; every control is about 44 px tall.
   - Tap "..." on a party block: a menu appears right under the button, stays inside the screen and closes on tapping outside or scrolling. Pick Reject: a text box appears and the keyboard opens at once.
   - No sideways scroll anywhere on the page. As a read-only party user, parties with no level on an activity are absent.
2. ITP detail, 768 x 1024 (tablet portrait)
   - Grid shows with a sideways-scroll hint line above it and a soft fade on the right edge. Scroll sideways: the Activity column stays pinned, party cells slide under it with no see-through, and the fade vanishes at the far end.
   - Scroll the page down: the "Jump to" bar stays under the header and the activity cells must NOT draw over it.
3. ITP detail, 1024 x 768 and 1280 x 800
   - With 6 parties the grid scrolls sideways and shows the hint and fade; with 3 parties it fits with no hint and no fade.
   - Press Tab through one row: Edit, order buttons, level selects, primary action, "..." (Enter opens, focus lands on the first item, ArrowDown and ArrowUp move, Esc closes and returns to the "..." button, Tab closes).
4. ITP detail, 1440 x 900 and 1920 x 1080
   - 6 parties fit without scrolling and no hint is shown; 10 parties scroll with the hint. Party names are truncated with a tooltip, never overlapping.
5. Menu positioning: on the last row at the bottom of a short window (for example 1024 x 500) open "..." and confirm the menu flips above the button or stays fully on screen. Rotate a phone to landscape while the menu is open: it closes.
6. Sign-off behaviour (staff): Notify a pending cell, then click quickly on the menu's Sign off while it is saving. The menu items must be greyed out while the action runs. Sign off on behalf of another party: the reason dialog appears above everything, including the jump bar.
7. NCR detail, inspection record, project hub and every tab (Guide, Activity, Reports, Audit log, KPIs, Punch list, Registers), 375 and 768: header, badges and action buttons wrap without overlap; the tabs bar stays under the header; register tables show as cards below 768 and as tables from 768.
8. ITP master library, proposals and template pages at 375 and 1280: lists readable, buttons about 44 px on phones.
9. Print: use the PDF button on an ITP (not the browser's Print command). Open the punch list and use its Print button: only the heading and table print.

## Fix pass (builder F2)

Items 6-12 and suggestions 14-15 above are addressed; tsc clean, vitest 179 files / 1370 tests pass.
- Status chips: compact chip shows a short label ("Proceeded"); full label in `title` and `aria-label` (signoff-cell.tsx).
- ItemControls edit form now opens in a Sheet (portal, focus trap) on all sizes, 44px fields with control-border, two columns from sm, Save/Cancel in the sheet footer via `form=`; same fields and action.
- Grid semantics: activity cell is `rowheader`; table has aria-colcount/rowcount, rows aria-rowindex; mobile party blocks get a hidden "Party:" prefix.
- Sticky party header: sticks below app header + jump bar (`--jump-h`, set by the grid, `jumpBar` prop) when the grid fits; when it overflows sideways the region scrolls both ways (max height viewport minus header/jump bar) and the header sticks at its top.
- Sticky first column gets a right shadow only while the region is scrolled horizontally (`data-scrolled` on ScrollRegion).
- Print: `.print-area.print-itp` on the ITP detail root and a `/* PRINT: ITP detail */` block appended to globals.css (black on white, no sticky/overflow, rows kept whole, buttons/nav/action forms hidden; intervention selects kept as text). Not browser-verified.
- Row summaries (hwrs by-party, status-view activity rows, revision/review/version history, checklist preview) have a consistent rotating chevron, control border, 44px min height. Project-overview delete summary left as is (already 44px with chevron).
- Punch edit/resolve/verify/reopen forms are padded card forms, two columns from md, StickyActionBar inCard; add-punch, walkdown and four register add forms now pass inCard.
- hover:bg-off-white replaced with hover:bg-surface-subtle in my areas; no StatCard in my areas. Register edit dialog and CellMenu Esc now use useEscapeLayer.

Not done: breakpoint="xl" for ResponsiveTable/DataTable and the usage page flip (tool permission denied; outside my ownership). itp-master other summaries not present beyond version-history.
