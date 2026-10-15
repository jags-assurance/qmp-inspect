# UI stage 2 review: app shell, cross-cutting system, dashboards and list pages

Method: code reading only (no browser, no database). Contrast computed with a script (WCAG formula). After my fixes `npx tsc --noEmit` is clean and `npx vitest run` passes (179 files, 1370 tests, includes `client-boundary.test.ts`).
Other reviewers have uncommitted edits in the tree (cell-menu, sticky-action-bar, settings-nav, ...); my edits to `cell-menu.tsx` and `dropdown-menu.tsx` sit next to theirs.

Counts: Blocker 1 (fixed), Major 4 (4 fixed), Minor 14 (8 fixed, 6 open), Suggestion 8 (all open).
No change to queries, permission gates, form wiring or actions. The diff since 346c29e for the list pages shows only presentational changes plus intentional gate re-expression (`x && <A/>` to `x ? <A/> : undefined` on ITP, Projects and Standalone `primaryAction`; same booleans `canCreateItp`, `canCreateProject`, `canRunStandaloneAssignment`).

## Blocker
1. **Fixed: "Quick observation" vanished on phones (inspector dashboard).** `inspector-dashboard.tsx` passed `<QuickRaiseObservation/>` as `secondaryActions`. Below 640px PageHeader folds those into `PageActionsMenu` (`DropdownMenu`), whose panel children are only mounted while open and unmount on the deferred close after any click. The button set `open=true`, the menu closed one tick later, and the side panel, form and toast unmounted with it. The main offline field action (raise an observation) could not be used on a phone. Fix: Start work and Quick observation now sit together in `primaryAction` (stacked full width on phones, side by side from sm), so both are always visible and the component never lives inside a menu. Rule for the future: never put a component that owns a panel, dialog or toast into `secondaryActions`; links, anchors and plain forms are fine.

## Major
1. **Fixed: Esc closed the wrong layer.** `DropdownMenu`, `CellMenu`, `ConfirmTypeDialog` and the command palette listened for Escape on the bubble phase, while Sheet / SidePanel / ConfirmDialog / PopoverPanel use the capture-phase `useEscapeLayer` and stop propagation. A menu inside a side panel or sheet never saw Esc; Esc closed the whole panel (and the menu with it). The docs claimed the opposite. All four now use `useEscapeLayer`.
2. **Fixed: "Clear filter / Clear all" did nothing when a header project is selected.** Since the header project selector, `withActiveProject` re-applies the remembered project whenever `?project=` is missing. ITP "Clear filter", and the FilterBar `clearHref` on Inspections, NCRs and Standalone pointed at the bare path, so the project came straight back (and "Filters (1)" stayed). They now point at `?project=` (an explicit empty value means All projects, which beats the default). `itps/page.tsx`, `inspections/page.tsx`, `ncrs/page.tsx`, `standalone/page.tsx`.
3. **Fixed: generic loading skeleton was invisible.** `app/inspect/loading.tsx` (fallback for every route without its own `loading.tsx`), `itps/loading.tsx`, `ncrs/loading.tsx` and the ITP detail skeleton used `bg-off-white` pulse blocks on a `bg-background` page, which is the same colour (#f9f7f4). Users saw an empty page. Now `bg-surface-sunken`.
4. **Fixed: sticky bulk-action bar in the vault folder list hid under the header** (`vault-documents-table.tsx:350`, `sticky top-0` under a z-20 header). Now uses the standard `top-[calc(var(--header-h)+env(safe-area-inset-top))]`.

## Minor
Fixed:
1. **Nested `Disclosure` chevrons lied.** `group-open:` matches ANY open ancestor `.group`, so a Disclosure inside an open `Section collapsible` always showed its chevron (and rounding) as open. Now a named group, `group/disclosure` + `group-open/disclosure:` (`components/ui/disclosure.tsx`). Hand-rolled `<details class="group">` elsewhere is unaffected.
2. **Header crowding at 640-1279px.** The 176-288px search field took the width the breadcrumb needs (at 1024 with rail and org + project selects the title had about 80px). Search field now starts at md (768) instead of sm, and is 176px at md/lg, 240px at xl, 288px from desk; the icon button covers phones and small tablets (`command-palette.tsx`).
3. **Header selects were 36px on touch laptops/tablets** (iPad landscape = 1024, `lg`, coarse pointer). Org and project selects and the context skeleton now go to 44px on `pointer: coarse`.
4. **Command palette:** Esc only worked while the input had focus, and the page scrolled behind it. Now an escape layer plus `useScrollLock`.
5. **`ConfirmTypeDialog` was z-50** (same as Sheet). It is a confirmation, so now z-60 like `ConfirmDialog`; also uses the scroll lock.
6. **`hover:bg-off-white` is invisible** (off-white on white/surface). Replaced with `hover:bg-surface-subtle` in `dropdown-menu`, `side-panel`, `split-layout`, `barcode-scan-button`, `admin-dashboard` (2), `itps-table`, `expiring-clearances-card`.
7. **Offline banner actions** (Sync now, Retry, Keep mine, Discard, Export queue, Sign in, Reload) were bare underlined text, about 20px tall. They are now 32px, 44px on touch (`offline-banner.tsx`). These are the controls a field user needs when signal returns.
8. Skeletons `itps/loading.tsx` and `ncrs/loading.tsx` still do not mirror PageHeader + chips (open, see below).

Open:
9. `offline-banner.tsx`: the banner is not sticky, so the "You're offline / n queued" status scrolls away. On a field page the inspector loses the signal indicator after the first scroll. Suggest sticky below the header (`top-[calc(var(--header-h)+env(safe-area-inset-top))] z-10`).
10. `notice-stack.tsx` publishes `--notice-h` as `offsetHeight`. From sm the stack is `bottom-4`, and the 16px is not counted, so the sticky action bar overlaps the notice by 16px (the notice wins at z-30). Add 16px on sm.
11. `sidebar-shell.tsx`: the drawer stays open on browser Back / route change by anything other than a nav link (only `NavLink.onClick` closes it). Close it in an effect on `pathname`.
12. `use-scroll-lock.ts`: `overflow:hidden` on body removes the scrollbar on Windows desktops (Sheet, SidePanel, ConfirmDialog, palette), so the page shifts about 15px sideways. Add `scrollbar-gutter: stable` on `html`.
13. `data-table.tsx:150` sticky `thead` is inert (its scroll container is `.table-scroll`, `overflow-x:auto`), and every table region is labelled the same "Data table" unless `caption` is passed.
14. `user-menu.tsx`: panel has `role="menu"` + `menuitem` children but no arrow-key navigation or focus move on open (the standard menu contract). Either add roving focus or drop the role to a plain labelled group.

## Suggestions
1. `docs/UI_DESIGN_SYSTEM.md` is stale: it says `--color-border` is #ddd6c8 (1.45:1) but `globals.css` has #c4bba6 (1.9:1 on white; still below 3:1, acceptable only for decorative card edges that also carry `shadow-xs`). It also says tablets (640-1023) get the search field; now icon until 768.
2. Sidebar: make the `<nav>` the scroller (`min-h-0 flex-1 overflow-y-auto`) so the user block and rail toggle stay pinned; today they scroll away on short laptops.
3. Inspector dashboard shows overdue holds three times (Today queue, Section, KPI tile). Consider dropping the Section when the queue already lists them, to cut length on a phone.
4. `admin-dashboard.tsx` and `external-party-dashboard.tsx` are whole client trees (they need `useUrlPanel` / translate). The tables and watchlists could be server children with only the side panel as a client island. Medium win for first load on the admin page.
5. `app/inspect/layout.tsx` selects up to 400 projects with organisation joins on every navigation to feed the header picker. With the Supabase log budget, cache per session (cookie-keyed `unstable_cache` or a short revalidate) and past 400 show a search instead of a truncated list.
6. `photo-markup.tsx:166` uses `z-[70]`, `workspace-tabs.tsx:44` uses `z-[5]`: off the documented scale. `page-guide.tsx:53` and `registers/register-cells.tsx:236` use absolute `z-20`, which ties with the header and paints over it when scrolled; move to `z-30` and portal if clipped.
7. Bare `rounded` still has 96 uses in 48 files; harmless (6px) but mixed with 8px controls.
8. `ncrs/page.tsx` observations `clearHref` only offers Clear when a discipline is set; project/search/owner filters have no Clear.

## Verified OK (no action)
- **Sidebar cookie / SSR:** `AppShell` reads `jags-sidebar-pref` with `cookies()`; `SidebarShell` uses `useSyncExternalStore(subscribe, readPref, () => initialRailPref)`, so hydration uses the server value and no mismatch or flash occurs. Rail visuals are CSS only (`lg:max-desk:`), so first paint is right at every width. Residual: a user with a localStorage value but no cookie sees one snap on first load (then the cookie is written on next toggle).
- **Breakpoints:** JS `64rem` / `90rem` equal CSS `lg` / `desk`. 1023: drawer + hamburger; 1024: sticky 72px rail (default), toggle shown; 1439: rail or expanded per choice; 1440: always 256px, toggle hidden. Drawer width `min(16rem, 88vw)`.
- **Layers:** z-scale actually used: sticky 10, header 20, popovers/CellMenu/notices 30, drawer, side panel, filter backdrop 40, Sheet / palette / filter sheet / toasts / route bar 50, ConfirmDialog and ConfirmTypeDialog 60. Sheet, palette, popovers, tooltips and ConfirmDialog are portalled (header z-20 no longer caps them). Scroll lock is reference counted; Esc is topmost-only for every layer after my fix (the legacy `data-book-pdf-button`, `register-cells` dialog and `photo-thumbnail` still have their own Esc handlers, see manual checklist).
- **Skip link, landmarks:** skip link to `#main-content` (`tabIndex -1`), one `main`, `header`, `footer`, labelled `aside` ("Sidebar"), `nav` "Main" and "Breadcrumb". Dashboards, Platform Home and all list pages in my list have exactly one `h1` via `PageHeader`; Section headings are `h2`.
- **Reduced motion:** global rule disables animation/transition durations and `.animate-pulse/.animate-spin`; drawer uses `motion-reduce:transition-none`.
- **client-boundary test:** passes; `Disclosure`, `PageHeader`, `Section`, `StatGrid`, `FilterChips`, `EmptyState` are server-safe, `StatTile` and `FilterBar` are client.
- **Contrast (computed):**

| Pair | Ratio | Verdict |
|---|---|---|
| muted on white / off-white / surface-subtle / sunken / brand-soft | 7.29 / 6.82 / 6.47 / 6.14 / 6.36 | ok |
| brand on brand-soft / surface-subtle | 9.91 / 10.09 | ok |
| success, danger, warning, info on white | 6.51, 6.54, 5.54, 6.26 | ok |
| same on their `-soft` tint | 5.72, 5.58, 4.93, 5.44 | ok |
| warning / danger / info / success text on its `/10` banner over off-white (offline banner) | 4.54, 5.21, 5.10, 5.27 | ok, warning is the tightest (do not lighten) |
| white at 85 / 80 / 75 / 70 / 60 percent on burgundy | 8.61 / 7.79 / 7.03 / 6.32 / 5.04 | ok |
| white/70 on the active nav row (white/15 on burgundy) | 4.64 | ok, minimum |
| gold on burgundy, burgundy-dark on gold | 6.97, 8.70 | ok |
| white on brand, danger, success, info, warning | 11.4, 6.5, 6.5, 6.3, 5.5 | ok |
| control border on white / off-white / surface-subtle | 4.18 / 3.91 / 3.71 | ok (>= 3:1) |
| decorative border on white / off-white | 1.91 / 1.78 | decorative only |

## Pages still on the old pattern (not in my area unless noted)
`StatCard` (legacy alias, 8 pages): `organisation/{automation,checklist-library,insights,retention,roles,staff-access,teams}` views, `organisation/usage/page.tsx`, `standalone/[id]/assignment-workspace.tsx`.
`hover:bg-off-white` (invisible hover): `checklists/[templateId]/{item-documents,response-row,start-inspection-form}`, `itps/new/itp-creation-tabs`, `itps/[id]/{advance-status-form,checklists/checklists-view}`, `ncrs/[id]/ncr-documents`, `projects/[projectId]/{add-project-party-form,audit-log/audit-trail-pdf-button,data-book/done-activities-panel,data-book/updates-panel,workspace/project-record-lists}`, `vault/.../{vault-document-view,set-approvers-form,vault-documents-table}`, `components/domain/{signoff-cell,vault-file-picker}`.
Hand-styled `<summary>` (should be `Disclosure`): `checklists/[templateId]/{page.tsx x3,response-row}`, `itp-master/[id]/version-history-panel`, `itps/[id]/{approval-roadmap/hwrs-section,checklists/checklists-view,review-history-panel,revision-history-panel,status/status-view}`, `projects/[projectId]/data-book/{data-book-view x2,done-activities-panel,updates-panel}`, `project-overview-view`, `start-work/page`, `vault/.../{vault-document-view x3,set-approvers-form,upload-form}`, `components/domain/itp-checklist-preview`.
Loading skeletons not mirroring the new header: `itps/loading.tsx`, `ncrs/loading.tsx`, `app/inspect/loading.tsx` (visible now, but old shape); `organisation/clients` has no `loading.tsx`.
Own Esc listener, outside the layer stack: `data-book/data-book-pdf-button.tsx`, `registers/register-cells.tsx` dialog, `photo-thumbnail.tsx` dialog, `photo-markup.tsx`, `barcode-scan-button.tsx`.
Routes where no `PageHeader` / `h1` is in the route folder (check they get one from an embedded Settings/tab host or a shared view): `itps/[id]`, `itps/[id]/{approval-roadmap,checklists,status}`, `ncrs/[id]`, `inspections/[id]`, `checklists/[templateId]`, `standalone/[id]`, `projects/[projectId]` and its `{activity,audit-log,data-book,guide,kpis,punch-list,registers,reports}` children, `vault/.../{document,pending,compare}`, the `organisation/*` settings pages. Detail reviewers own these.

## Dashboard hierarchy (senior designer view)
- **Admin:** title, one primary (New project), then six KPI tiles ordered by urgency (overdue holds, open NCRs, library proposals, in-progress, then reference counts), then expiring clearances, then a 3-up of watchlists (holds, NCRs, activity), then proposals and organisations tables. Correct order for someone who opens it to see what is on fire. Density is high at 1440+ (6 tiles + 3 columns) but each pane scrolls on its own. Empty states exist per watchlist. One gap: the first screen at 1024 is all tiles; the watchlists start below the fold.
- **Inspector (phone first):** now Start work + Quick observation, then Today queue, assigned to me, clearances, overdue holds, NCRs, then KPIs, then the full pending-actions list. Attention first, KPIs after: right for a field user. Risk: KPIs sit below up to five lists on a phone; acceptable because the queue already summarises.
- **External party:** widget order is role-driven (`widgetOrderFor`), unchanged; acceptance table becomes cards with a full-width action on phones.
- **Platform Home:** orbit from lg (fixed 410px ring fits 1024x768), 2-column cards below. Loading skeleton mirrors both.
- Loading skeletons exist for every list page in scope; error boundaries exist only at `/inspect` and `/platform` (nested routes fall back to them, so a list-page failure replaces the whole content area, shell stays).

## Manual device checklist (plain language)
Use a real phone (375 wide), a tablet (768 portrait and 1024 landscape), a laptop at 1280 and a desktop at 1440 and 1920. Log in as the role named.

**A. Inspector dashboard on a phone (Blocker fix)** Log in as an Inspector at 375x812, open `/inspect`.
- Under the title you must see two full-width buttons: "Start work" (burgundy) and "Quick observation" (outline). There is no "..." menu on this page.
- Tap "Quick observation": a panel slides in from the right with Project, What did you see, Due date, Photo. It must stay open. Fill it with airplane mode on, save: the page shows "Saved on this device" and the offline banner shows "1 change queued". Turn signal back on: it syncs.
- At 768 and wider the two buttons sit side by side to the right of the title.

**B. Header at each width** Open `/inspect/itps` as JAGS Admin (has org and project selectors).
- 375: hamburger, current page name (truncated with "..."), folder icon, magnifier icon, bell, avatar. Nothing wraps, header stays one row about 56px tall, every icon at least 44px.
- 768: breadcrumb, folder button with the project number, magnifier ICON (not the search box), bell, avatar.
- 1024: sidebar is a 72px icon rail; header shows the two selects, a 176px search box with no "Ctrl K" crowding the title; the breadcrumb still shows "QMP Inspect / ITP Register" (may truncate the last word, never disappears).
- 1280: search box about 240px; 1440 and 1920: about 288px, selects wider, sidebar full 256px.
- On a touch laptop or iPad landscape (1024x768) the selects are 44px tall.

**C. Sidebar rail and drawer boundaries** Resize or rotate through 1023, 1024, 1439, 1440.
- 1023: no sidebar, hamburger visible; tap it: drawer slides in with a dark overlay, focus moves into it, Esc closes it, page behind does not scroll, tapping a nav item closes it. Browser Back while open (known open item 11): drawer may stay open.
- 1024 to 1439: icon rail. Hover or Tab onto an icon: a dark tooltip with the name appears to the right. Click "Collapse/Expand" at the bottom: it toggles, then reload: the same state shows with no visible jump (this is the cookie). Clear cookies, reload at 1280: rail shows immediately, no flash of the wide sidebar.
- 1440 and up: always the full sidebar, no collapse button.

**D. Overlays stacking and Esc** (Keyboard on a laptop.)
- On `/inspect` (admin) open an NCR row to open the side panel, then open any "..." menu inside it (or the page's dropdown). Press Esc once: only the menu closes. Press Esc again: the panel closes.
- Press Ctrl+K: search opens; Esc closes it even after clicking in the dimmed area; the page behind does not scroll.
- Open the bell, then the account menu: bell closes (outside press). Both panels sit above the bottom-right notices if any show.
- On a phone open the folder (project) button: a bottom sheet opens above everything including notices; Esc/overlay/Close dismisses and focus returns to the button.
- On `/inspect/inspections` at 375, tap "Filters": bottom sheet with the filters; tapping outside closes it; applying a filter closes it.

**E. Clear filters with a header project (Major 2 fix)** Pick a project in the header, open `/inspect/ncrs` (or Inspections, Standalone, ITPs). Add a second filter (for example severity). Tap "Clear all" (or on ITPs, "Clear filter" next to "Filtered to one project"). The list must show ALL projects and no filter count; the header selector may still show the project (that is expected).

**F. Loading states** With DevTools network throttling "Slow 3G", navigate to a page that has no own skeleton (for example Guide or Support): grey pulsing blocks must be visible (not a blank page). Same for ITP Register and NCR Register.

**G. Nested disclosure** Open any page that has a collapsible section (NCR register "Ageing", observations "Ageing") containing a "Details" pill: with the section open and the pill closed, the pill chevron points right; opening the pill rotates it down.

**H. Dashboards** Admin at 375, 768, 1280, 1920: six tiles in 2, 3, 4, 6 columns respectively; tiles equal height; watchlists 1, 1, 2, 3 columns; proposals and organisations become cards below 768. Inspector: order Today queue then Assigned then lists then four KPI tiles then pending actions; the "Overdue hold points" tile jumps to the holds section. External party: acceptance table becomes cards on a phone with a full-width "Review and accept". Platform Home at 1024x768: the orbit fits without scrolling; at 768x1024: cards in two columns.

**I. Lists on a phone (375)** ITPs, NCRs, Observations, Inspections, Standalone, Projects, Vault landing, Reports and documents, Notifications, Manage: each shows PageHeader (primary button full width, other actions in "..." which holds only links/exports), chips scroll sideways with no page-level sideways scroll, rows are cards with 44px targets, empty state explains what to do. Notifications show a "New" badge on unread rows.

**J. Offline banner** In DevTools set offline: banner "You're offline" appears under the header. Every button in it ("Sync now", "Retry", "Export queue", "Discard") measures at least 44px tall on a phone (open item 9: it scrolls away with the page).

**K. Keyboard and screen reader quick pass** Tab from page load: first stop is "Skip to main content" (visible, top-left); Enter lands in main. Each page has one h1. Focus ring is burgundy on white, gold inside the sidebar. With "Reduce motion" on in the OS, the drawer, chevrons and skeletons stop animating.

## Fix pass (builder F3)

Done:
1. Offline banner status bar is sticky under the header (`top-[calc(var(--header-h)+env(safe-area-inset-top))]`, z-10, opaque surface, slim text, 2-line clamp on phones); queue/review lists scroll normally.
2. Drawer closes on any pathname change (incl. browser Back/Forward); the existing effect cleanup releases scroll lock, inert and focus.
3. `--notice-h` = stack height + computed bottom offset (updates on resize), so `StickyActionBar` and main padding clear notices.
4. `html { scrollbar-gutter: stable }` stops the body-scroll-lock shift.
5. `PopoverPanel role="menu"` gives arrow/Home/End/Tab/Esc navigation and focus-in on open; account menu items and wrappers have correct roles, trigger opens on ArrowDown; terms section controls are menuitems. Esc returns focus to the trigger for all popovers. `DropdownMenu` intentionally stays a disclosure (not role=menu).
6. `docs/UI_DESIGN_SYSTEM.md` corrected (border colour, search behaviour, z-scale, sticky offsets) with layer APIs and a page-builder checklist.
7. Header project picker: `lib/ui/header-projects.ts` (React `cache()` per request, same columns/limit). No `unstable_cache`: per-user RLS data and project create/rename do not revalidate any tag (those actions are outside the shell's files), so a cache could hide new projects.
8. `ListPageSkeleton` (+ `FilterChipsSkeleton`) used by itps/ncrs loading; `/inspect/loading.tsx` rebuilt on PageHeader/StatGrid skeletons.
9. Command palette Escape now only via `useEscapeLayer`.
10. Focus ring: removed ad-hoc ring/outline overrides on the palette and confirm-type inputs; no `hover:bg-off-white` remained in scope.

Not done (outside the files this builder owns): own Escape listeners remain in `components/domain/cell-menu.tsx`, `app/inspect/projects/[projectId]/data-book/data-book-pdf-button.tsx`, `.../registers/register-cells.tsx`, `app/inspect/reports-documents/documents-section.tsx`, `app/inspect/vault/.../drawing-markup-viewer.tsx` (confirm-type-dialog already uses the layer).
