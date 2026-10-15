# UI stage 2, builder B1: dashboards, lists and hubs

Method: code only (no browser, no database). `npx tsc --noEmit` clean; `npx vitest run` 179 files / 1370 tests pass.
No query, permission, link, action or data change; layout and presentation only.

## Pages migrated
| Page | Files | What changed |
|---|---|---|
| Inspector dashboard | `app/inspect/inspector-dashboard.tsx` | PageHeader (Start work primary, Quick-raise in secondary); order is now attention first (Today queue, assigned to me, clearances, overdue holds, NCRs assigned), KPI `StatGrid` next, full "My pending actions" last; `Section` cards; StatCard -> StatTile with tone; hover token. |
| External-party dashboard | `app/inspect/external-party-dashboard.tsx` | PageHeader; every panel is a `Section`; StatGrid max 6; acceptance `DataTable breakpoint="md"` + card with full-width "Review and accept"; list rows stack on phones; 44px link targets; disclosure pill uses `control-border`. Role widget order (`widgetOrderFor`) untouched. |
| Platform Home | `app/platform/page.tsx`, `loading.tsx` | PageHeader; orbit now from `lg` (was `md`) because it is fixed-pixel; card grid (2 cols from sm) below lg with outline "Open" buttons; skeleton mirrors both. |
| Manage hub | `app/inspect/manage/page.tsx`, `loading.tsx` | PageHeader, `Section`s, ResponsiveTable `breakpoint="md"`, EmptyState, settings link cards with control border. |
| Observation register | `observations/page.tsx`, `loading.tsx` | PageHeader (raise panel as primary), StatGrid/StatTile, FilterBar around discipline filter (already uses `useSetFilterParam`), ageing chart in collapsible Section, NcrsTable (cards already). |
| Inspections | `inspections/page.tsx`, `inspections-table.tsx`, `loading.tsx` | PageHeader, result `FilterChips` (keep every other param), `FilterBar` + `FilterField`, EmptyState, `DataTable md` + designed card incl. bulk-IRN checkbox (24px on touch). |
| Standalone list | `standalone/page.tsx`, `standalone-table.tsx` | PageHeader, FilterChips with counts, FilterBar, card renderer. |
| Projects list | `projects/page.tsx`, `projects-table.tsx`, `org-filter.tsx` | PageHeader, open/closed `FilterChips` with counts, org select in FilterBar (control style), EmptyState, card with NCR/punch/hold badges as 44px links. |
| Vault landing | `vault/page.tsx`, `add-category-form.tsx`, `project-picker-form.tsx` | PageHeader (pending approvals primary, zip download secondary), StatGrid (documents, awaiting approval, folders), folders and recents in Sections, project picker in the FilterBar search slot (always visible), `Disclosure` pill. |
| Reports and documents | `reports-documents/page.tsx`, `documents-section.tsx`, `loading.tsx` | Attention first, picker, project report cards, then Generated documents (FilterBar + Badge status/type + outline sm buttons). Picker no longer sits below the list. |
| Notifications | `notifications/page.tsx`, `loading.tsx` | PageHeader, FilterChips, EmptyState, unread has a "New" badge (not only a dot/bold). |
| Client organisations | `organisation/clients/clients-view.tsx` | PageHeader (plain h2 when `embedded`), Card per org, `Disclosure` instead of hand-styled details. |
| Master ITP library | `itp-master/page.tsx` (unchanged), `templates-table.tsx`, `proposals/page.tsx` | FilterBar + FilterField, card renderer, Disclosure. |
| Shared dashboard bits | `admin-overdue-holds.tsx`, `app/inspect/page.tsx` | StatCard -> StatTile, hover token, 44px row. |

New loading skeletons (PageHeaderSkeleton + StatGridSkeleton + list/card blocks) for inspections, observations, reports-documents, notifications, manage, platform.

## Patterns used
PageHeader -> notices -> StatGrid -> FilterChips -> FilterBar -> DataTable (`breakpoint="md"`, `renderCard`: number link + status badge, 2-line description, key facts, 44px action). Section/Card for panels, EmptyState for empties, Disclosure for show/hide, `title` on every truncated cell, `border-control-border` on link-cards, `hover:bg-surface-subtle` only.

## For the reviewer / uncertain
1. `PendingActionsTable`, `TodayQueue`, `AssignedToMe`, `QuickRaiseObservation` (components/domain) are rendered by the Inspector dashboard but are shared domain components outside my file list, so they keep their old look. They are the next biggest visible gap on that page.
2. `standalone/discipline-filter-form.tsx` is dead code (the page uses one combined form). Left as is; delete or migrate to `useSetFilterParam`.
3. `inspections`, `standalone`, `reports-documents` filters are single GET forms (one form, so no param loss); they were not moved to `useSetFilterParam` because there is nothing to drop. `reports-documents` picker still resets other doc filters on change (existing behaviour).
4. Aging chart on the observation register is now collapsed by default, as on the NCR register (presentation only).
5. Platform Home orbit moved from md to lg; a 768-1023 tablet now sees the card grid.
6. External dashboard "stats" widget and others keep stable ids (`#today-queue-title`, `#overdue-holds`, `#pending-actions`).
7. Not touched (owned by others or not in my list): `itp-master/[id]/page.tsx` summary pill (B2), `organisation/*` settings views (B3), checklists/start-work/handover/standalone/[id] (B4), `ncrs/[id]` (B2).
8. Everything renders in server or existing client components; no new dependencies. Not verified visually (no browser).

## Follow-up (coordinator round 2)
- Deleted unused `standalone/discipline-filter-form.tsx`. Observation ageing chart stays collapsed.
- Restyled dashboard-only domain components: `pending-actions-table` (status Badge, cards below md with border, 44px tabs/actions, aria-pressed), `today-queue` (new optional `className`, control-border chips with check, surface-subtle hover, titles), `assigned-to-me` (new optional `className`, card tokens, titles). APIs backward compatible (start-work still gets the old default `mt-6`).
- External dashboard "Show all" pill now uses `Disclosure`.
- Not done: `quick-raise-observation` form inputs (already 44px, global control-border rule applies); `expiring-clearances-card` not reviewed.
