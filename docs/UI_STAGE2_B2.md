# UI stage 2, builder B2: detail pages

Verification: `npx tsc --noEmit` clean, `npx vitest run` 179 files / 1370 tests pass. No browser, no database, nothing committed.

## Migrated
- ITP detail (`itps/[id]/itp-detail-view.tsx`): `PageHeader` (back link, ITP number, guide, status/phase/rev/AI badges, title as subtitle, org/project/standard as meta, PDF button as primary action). Sub-page links (Checklists, Completion roadmap, Approval roadmap, Project guide) are one outline row under the header. A `Card` holds the progress bar (party sign-offs, `role="progressbar"`) and the status stepper (icon + text, `aria-current`). A separate brand-tinted "Next step" card holds the existing action forms (full width buttons on phones). Warnings and notices follow. Jump-to-section bar now sticks below the header (was `top-0`, hidden under the z-20 header). Section cards have a subtle header band.
- Embedded ITP pane (register split) keeps an `h2`, same badges and the PDF button, no PageHeader.
- Section header: reorder and delete moved into a "..." overflow menu (`section-controls.tsx`), same server actions and the same issued-ITP reason prompt.
- NCR detail: `PageHeader`; the next status step (Start work / Send for verification) is the primary button; timeline plus report buttons in one card; Details facts via `DescriptionList`; cards get `shadow-xs`.
- Inspection record: `PageHeader`, result banner with icon, facts `DescriptionList` card, widened to `max-w-5xl`.
- Project hub: `PageHeader` on the overview and on every tab; KPI tiles are `StatGrid`/`StatTile`; project status control is the primary action.
- NCR scorecard, Master ITP library, library proposals, master template page: `PageHeader`; library KPIs via `StatGrid`; scorecard cards at `md` with a title.
- Project punch list and the four registers: `DataTable breakpoint="md"` so tablets get cards below 768.

## Sign-off grid design (`activity-signoff-grid.tsx`)
One DOM, CSS only (a `role="table"` of divs), so each cell's state, timers and confirm dialogs exist once.
- Columns: `minmax(260px,1.6fr)` activity plus `repeat(n, minmax(156px,1fr))`; the table has `min-width` equal to the floors.
- Desktop (>= 1280): grid fits without scrolling up to about 5 parties at 1280 with the rail sidebar. Activity column sticky (`z-10`), party headers truncate with `title`. Each cell: level badge/select, status chip (icon + text), countdown or warning, ONE primary action (Notify while pending, Sign off while notified, else Proceed/Request correction/Withdraw/Re-notify) and a "..." menu with the rest (Notify/Sign off alternatives, Re-notify, Sign with comment, Reject).
- Tablet (768-1279): same grid in a keyboard-focusable horizontal scroll region, activity column pinned, right-edge fade and a hint line when 3+ parties.
- Mobile (< 768): each activity is a card. Title, Details toggle, checklist/discipline badges, then one block per party (name, level, status chip, primary action + menu). Read-only viewers do not see parties with no level.
- Menu (`components/domain/cell-menu.tsx`, new): portalled to `body`, fixed-position from the trigger rect, `z-30`, Esc/outside/scroll/resize close, arrow keys, 44px items on touch. Needed because the scroll wrapper would clip an absolute panel.
- `SignoffCell` got `layout="compact"` (default "stacked" is unchanged, still used by the external-party dashboard). Handlers were extracted (`doNotify`, `doSignOff`, `confirmReason`) with identical logic and permission gates.
- `InterventionSelect`: control-border, 44px on touch. Details/checklist/evidence toggles: control-border, 44px on touch.

## Follow-up pass
- ItpPdfButton no longer stretches on phones: it left the PageHeader primary slot and sits inline at the end of the sub-page link row (and under the title when embedded). NcrStatusButton stays the primary action.
- Sign-off grid scroll fade now disappears at scroll end or when nothing overflows (`itps/[id]/scroll-region.tsx`, client wrapper that tracks scrollLeft/scrollWidth with a ResizeObserver; only the affordance is client code).
- `ItemControls`: Edit stays inline; Move up / Move down / Delete are inline buttons from `sm`, and a portalled `CellMenu` ("...", 44px items on touch) below `sm`. The menu calls `requestSubmit()` on the same hidden-in-place forms, so the revision-reason dialog and server actions are unchanged.
- KPIs: `StatCard` replaced by `StatGrid`/`StatTile`.
- Loading skeletons: project hub `loading.tsx` now uses PageHeaderSkeleton + StatGridSkeleton + TableSkeleton; added `itps/[id]/loading.tsx` (DetailSkeleton). Others already used `components/ui/skeletons`.
- New `components/domain/view-header.tsx` (`ViewHeader`): PageHeader on a full page, a compact h2 row when embedded in a tab. Used by guide, activity, reports, audit-log, kpis and the ITP checklists, completion and approval roadmap views (back link, guide, badges, subtitle).
- Approval roadmap: stages are now a vertical stepper with a connector line and a text chip (Done / Current stage / Upcoming). The four H/W/R/S tables (summary, blockers, by party, by activity) are `ResponsiveTable` at `md` (cards below), same data.
- Disclosure adopted for every pill/inline `<details>` in my folders (codemod; open/closed state kept): ITP detail legend and checklist card, activity details, accept-on-behalf, external approval, translate, exit controls, revision/review history, approval roadmap, status view, NCR page and extra panels, inspection page and its forms, master template change log, project overview, punch list, walk-downs, registers, CSV tools, guide (replaced MoreDetails).
- Forms: punch-item form, four register add forms and the walk-down form are a 1-column / 2-column from `md` grid with `StickyActionBar` for the submit.
- NCR detail and inspection record side cards are `Section`s (title in the header, consistent padding and shadow).

## Still not done
- `<summary>` row-cards with rich content were left as native summaries (by-party rows in hwrs-section, status-view activity rows, revision/review history rows, version history rows, checklists-view "Checklist preview", project overview line ~649): they are card rows, not pills.
- Edit forms for single punch items (edit/resolve/verify/reopen) still use their existing stacked layout (already single-column); no sticky bar.
- `ItemControls` edit form inputs unchanged. Status view cards unchanged beyond Disclosure.
- Nothing visually verified.
