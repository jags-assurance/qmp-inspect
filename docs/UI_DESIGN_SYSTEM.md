# QMP Inspect UI design system (v2, stage 1)

Purpose: one calm, professional look for field inspectors (phones/tablets), office staff (laptops/desktops) and clients. Layout and
workflow are unchanged; this document is the contract for new and migrated pages. Buttons are covered by `docs/UI_BUTTONS.md` (still
the standard; extended with `size="icon"`).

Reference pages built with this system: `/inspect` (admin dashboard), `/inspect/itps`, `/inspect/ncrs`.

## 1. Tokens (apps/web/app/globals.css)

All existing names still work. New semantic tokens are available as Tailwind colours (`bg-surface-subtle`, `text-brand`, ...).

| Role | Token | Value | Use |
|---|---|---|---|
| Page background | `background` / `off-white` | #f9f7f4 | behind everything |
| Surface | `surface` | #fff | cards, header, inputs |
| Subtle surface | `surface-subtle` | #f4f1ec | table head, row hover, ghost hover |
| Sunken | `surface-sunken` | #efebe4 | skeletons, icon chips, tracks |
| Border (decorative) | `border` | #ddd6c8 | card edges, dividers (light, calm) |
| Border strong | `border-strong` | #c9c0ad | hover edge, separators on tint |
| Control border | `control-border` | #857b66 | inputs, selects, outline buttons (3:1, applied by a global rule) |
| Text | `ink` / `text-strong` | #1c1c1e / #111113 | body / page titles and big numbers |
| Muted text | `muted` | #5c5648 | labels, captions (7:1 on white) |
| Brand | `brand` (= `burgundy`), `brand-hover`, `brand-soft`, `brand-fg` | #6b1e2c, #501623, #f7edef, #fff | primary buttons, links, active chips |
| Accent | `gold` | #f5c518 | sidebar active marker, highlights; never as text on white |
| Success / Warning / Danger / Info | `success` `warning` `danger` `info` + `-soft` | text/icon colour + tinted background | all pass AA on white and on their `-soft` tint |
| Overlay | `overlay` | ink at 45% | drawer, sheet backdrops |
| Focus | `focus` | burgundy | 2px outline, 2px offset, global (gold on dark surfaces) |

Status is never colour alone: Badge carries an icon glyph, chips carry a check, tiles carry text labels.

### Typography
Inter (`font-sans`), IBM Plex Mono for record IDs (`.doc-id`). Base 16px / 1.5.

| Use | Class |
|---|---|
| Page title | `text-2xl sm:text-[1.75rem] font-semibold tracking-tight text-text-strong` (PageHeader) |
| Section title | `text-base font-semibold` |
| Body | `text-sm` (14px) for dense UI, `text-base` for inputs on phones (prevents iOS zoom; enforced in CSS) |
| Label / caption | `text-xs font-medium text-muted` (never below 12px; button text never below 14px) |
| KPI number | `text-2xl font-semibold tabular-nums` (StatTile) |

### Spacing
4px base. Component gaps `gap-2` (8) inside groups, `gap-3/4` (12/16) between tiles/cards, `space-y-5` (20) between page blocks.
Card padding `p-4 sm:p-5`. Page padding: 12px (phone) / 24px (>=sm) / 32px (>=lg). Content max width `--content-max` 1440px, centred.

### Radii and shadows
`rounded-md` 8px (controls, buttons), `rounded-lg` 12px (cards, tables), `rounded-xl` 16px (sheets, dialogs), `rounded-full` (badges, chips,
avatars). Shadows: `shadow-xs` cards at rest, `shadow-md` hovered tile/popover, `shadow-lg` menus, `shadow-xl` drawer/sheet/dialog.

### z-index scale (never invent a new number)
sticky sub-bars 5-10, header 20, dropdowns/popovers 30, floating notices 30, drawer and side panel 40, sheet / command palette / toasts 50,
confirm dialog 60.

### Layout variables
`--header-h` 56px, `--sidebar-w` 256px, `--sidebar-rail-w` 72px, `--content-max` 1440px. Sticky sub-navs use
`top-[calc(var(--header-h)+env(safe-area-inset-top))]`.

## 2. Breakpoints and shell behaviour

| Name | Width | Tailwind | Sidebar | Header |
|---|---|---|---|---|
| Mobile | < 640 | default | off-canvas drawer | hamburger, last breadcrumb only, context icon, search icon, bell, avatar (no name) |
| Tablet | 640-1023 | `sm:` / `md:` | off-canvas drawer | full breadcrumb, context button with project number, search field with Ctrl K, bell, avatar |
| Laptop | 1024-1439 | `lg:` | sticky, collapses to 72px icon rail with tooltips (remembered; default rail) | + inline org/project selects, avatar with name + role |
| Desktop | >= 1440 | `desk:` (or `min-[1440px]:`) | fixed 256px, always expanded | same as laptop, wider selects |

Rules: header is ONE 56px row and the only sticky element. The drawer has overlay, Esc to close, focus trap, inert page, safe-area insets,
closes on navigation. Touch (`pointer: coarse`) controls are at least 44px. Tables become cards below `md` (768px) on migrated pages.
Never let a control stretch the header: give it a max-width and `truncate`.

## 3. Component catalogue

All in `components/ui` unless noted. Server-safe means usable from a server component without `"use client"`.

| Component | File | Server-safe | Use | Do not |
|---|---|---|---|---|
| `PageHeader` | page-header | yes | top of every page: title, guide, badges, subtitle, meta, back link, `primaryAction`, `secondaryActions` (inline from sm, "..." menu on phones) | hand-roll an action row; put more than one primary |
| `Card`, `Section` | section | yes | surfaces. `Section` adds header (title, description, actions), `collapsible` (native details), `flush` for edge-to-edge tables | nest cards in cards |
| `StatTile`, `StatGrid` | stat-tile | tile is client (translates label) | KPI row; `StatGrid max` 2/3/4/6; tile `href` for drill-down; `tone` tints the icon chip | use for non-numeric content |
| `StatCard` | stat-card | client | legacy alias of StatTile | use in new code |
| `FilterBar`, `FilterField`, `Toolbar` | toolbar | client | filters inline from md, "Filters (n)" bottom sheet below md. Pass a `<form method="get">` as `filters` | put the Apply button outside the form |
| `FILTER_CONTROL_CLASS` | filter-styles.ts | yes | class for native selects/inputs in filters | |
| `FilterChips` | filter-chips | yes | status/quick filter links with counts; scrolls sideways on phones | use for more than ~8 options (use a select) |
| `DataTable` | data-table | client | search + table + pagination. `breakpoint="md"`, `renderCard` for a designed phone card | show all columns on the phone card; keep it to number, status, 2-3 facts |
| `ResponsiveTable` | responsive-table | yes | plain table; `breakpoint`, `cardTitle`, `cardActions`, `bordered` | drop a row action on phones |
| `EmptyState` | empty-state | yes | empty lists: say what, why, next step | leave a bare "No data" |
| `DescriptionList` | description-list | yes | label/value facts, 1 col phone, 2-3 col wide | |
| `StickyActionBar` | sticky-action-bar | yes | last child of long forms: sticks to the bottom on phones | use outside a form |
| `Sheet` | sheet | client | bottom sheet (dialog from sm) for short secondary tasks | use for long flows (use a page or SidePanel) |
| `SidePanel` | side-panel | client | record detail beside a list | |
| `DropdownMenu` | dropdown-menu | client | "more" menus; `hideChevron`, `ariaLabel` for icon triggers | |
| `Skeleton`, `PageHeaderSkeleton`, `StatGridSkeleton` + existing page skeletons | skeletons | yes | route `loading.tsx` | spinners for page loads |
| `Badge` | badge | yes | status with icon + text | colour-only status |
| `Button`, `ButtonGroup`, `buttonVariants` | button | yes | see UI_BUTTONS.md | |

Hooks in `lib/hooks`: `useFocusTrap(ref, active, onClose)`, `useMediaQuery(query, serverDefault)` (use only when behaviour, not styling,
depends on the breakpoint), `useServerDrivenTableParams`.

## 4. Page patterns

**List page (register)**: `PageHeader` (primary = create, secondary = export/print) -> notices -> `StatGrid` (optional) -> `FilterChips` ->
`FilterBar` -> `DataTable breakpoint="md" renderCard`. See `app/inspect/ncrs/page.tsx`, `app/inspect/itps/page.tsx`.

**Detail page**: `PageHeader` with `backHref`, status `badges`, `meta` -> main column of `Section`s (`DescriptionList` inside) with an optional
side column from `lg`; on phones the side column stacks under the main one; actions that matter stay in the header.

**Form page**: `PageHeader` -> max-w-2xl form of `Section`s with `FormField` -> `StickyActionBar` (primary first, Cancel as link-muted).

**Dashboard**: `PageHeader` (greeting as subtitle) -> `StatGrid max={6}` ordered by urgency -> grid of Watchlist/`Section` windows
(`lg:2 xl:3` columns) -> full-width `Section` tables. See `app/inspect/admin-dashboard.tsx`.

**Field / mobile screen**: one primary action, 44px targets, cards not tables, `StickyActionBar` for submit, no hover-only information,
text 14px minimum, content within the 12px page padding, bottom actions clear of `--notice-h` and the home indicator.
