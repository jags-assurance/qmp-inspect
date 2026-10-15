# UI redesign stage 1: senior review

Method: code reading only (no browser, no database). Verified with `npx tsc --noEmit` (clean) and `npx vitest run` (179 files, 1370 tests, all pass) after my fixes.

Counts: Blocker 0, Major 4 (3 fixed), Minor 8 (3 fixed), Suggestion 6.

## Verified OK
- `desk:` breakpoint: Tailwind 4 turns `--breakpoint-desk: 90rem` in `@theme` into a real `desk:` variant, sorted after `xl`. No `min-[1440px]` fallback needed.
- Sticky offsets: `workspace-tabs.tsx` and `settings-nav.tsx` add `env(safe-area-inset-top)` to `--header-h`, which matches the header's top padding.
- Drawer: inert plus aria-hidden when closed, focus trap, Esc, scroll lock, focus returns to the hamburger. Container height uses `dvh`.
- Contrast of the new tokens (computed):

| Pair | Ratio | Verdict |
|---|---|---|
| muted on white | 7.29 | ok |
| muted on surface-subtle | 6.47 | ok |
| muted on surface-sunken | 6.14 | ok |
| brand on white | 11.4 | ok |
| success on its soft tint | 5.72 | ok |
| warning on its soft tint | 4.93 | ok |
| danger on its soft tint | 5.58 | ok |
| info on its soft tint | 5.44 | ok |
| control border on white | 4.18 | ok |
| gold on burgundy | 6.97 | ok |
| white/75 text on burgundy | 7.02 | ok |

## Major
1. **Fixed: sheet and command palette were capped below notices.** `HeaderContext`'s `Sheet` and `CommandPalette` render inside the header, which is `sticky z-20` and therefore a stacking context. Their `fixed z-50` overlays were effectively z-20, so `NoticeStack` (z-30) painted over them. Fix: both now render through `createPortal(..., document.body)` (`components/ui/sheet.tsx`, `components/domain/command-palette.tsx`).
2. **Fixed: filter forms dropped each other's params.** On the ITP and NCR registers, and on observations (which reuses the NCR discipline form), each GET form submitted only its own field. New `lib/hooks/use-filter-param.ts` (`useSetFilterParam`) sets one param on the current URL, keeps the rest, and clears `page`, `itp` and `pane`. `itps/{discipline,phase,sort}` and `ncrs/discipline` forms call it on change. The `<form>` stays as the no-JavaScript fallback. `standalone/discipline-filter-form.tsx` still has the old behaviour: migrate it in stage 2.
3. **Fixed: outline buttons looked different as links.** `globals.css` darkens `button.border-border` only, so `buttonVariants()` on a `<Link>` kept the pale border (1.45:1). The outline variant now uses `border-control-border` (`components/ui/button.tsx`).
4. **Open: the lighter `--color-border` is a design reversal.** `#ddd6c8` is 1.45:1 on white and 1.35:1 on off-white. The earlier darker value was chosen for sunlight legibility on tablets. About 1121 `border-border` usages exist, including 13 anchors and many `<summary>` and pill-label controls (e.g. `checklists/[templateId]/response-row.tsx`, `itps/[id]/accept-on-behalf-form.tsx`). Those still carry the pale edge, and the global override does not reach them. Decision needed: either keep decorative edges pale and give every interactive non-input a `border-control-border`, or darken `--color-border` to about `#c9c0ad` (`--color-border-strong`).

## Minor
1. **Header "QQMP Inspect" cause.** `HeaderBreadcrumb` and `app/inspect/layout.tsx` (`breadcrumb="QMP Inspect"`) render the text once. The extra "Q" was the magnifier icon of the old search `<Button>` in `CommandPalette`. That svg was `absolute start-3 top-1/2` and the Button was not `position: relative`, so it anchored to the sticky header and sat just left of the title, reading as a Q. Stage 1 replaced that markup with a plain button, so it should already be gone. If it still shows, check for a stale build. Rule: never put `absolute` children inside `<Button>`.
2. **Fixed: placeholder contrast.** `::placeholder` opacity 0.8 gave 4.4:1 (below AA 4.5:1). Set to 1 in `globals.css`.
3. **Fixed: media-query units.** `sidebar-shell.tsx` used `1024px` and `1440px` in JS while CSS breakpoints are `rem`, so the two could disagree with a non-16px browser font. Now `64rem` and `90rem`.
4. **Open: sidebar rail flicker.** The server renders expanded (`useMediaQuery(..., true)`). On a laptop with no stored choice, the page loads at 256px and then snaps to the 72px rail. Fix: persist the preference in a cookie and read it in `app-shell`.
5. **Open: `use-focus-trap`.** Esc uses `stopPropagation` on a `document` listener, which does not stop other document listeners. A dropdown inside a sheet can close both on one Esc. Stacked `body.style.overflow` locks (drawer, sheet, FilterBar) restore the previous value in the wrong order if closed out of order.
6. **Open: `scroll-padding-top`.** `calc(var(--header-h) + 1rem)` ignores the safe-area inset on notched phones.
7. **Open: notifications dropdown.** It is z-30 inside the z-20 header context, so it sits under `NoticeStack` (z-30) on overlap. Portal it like the sheet.
8. **Open: radius overrides.** `rounded` (no suffix, 122 uses) was not rescaled while `sm/md/lg/xl` each moved up a step, so small chips and rounded boxes now look inconsistent.

## Suggestions for stage 2
- Make `<Sheet>`, `<Dialog>` and `<Popover>` portal-based. Anything that is `fixed` or z-30 or higher and opened from the header must mount under `body`.
- Use only the z-scale in `globals.css` (10, 20, 30, 40, 50, 60). No `z-[5]`, `z-[60]` or new numbers.
- Interactive elements that are not input, select, textarea or button must use `border-control-border`. Cards and dividers use `border-border`. Do not rely on the global override.
- Filter controls: use `useSetFilterParam`, never a bare GET form. Migrate `standalone/discipline-filter-form.tsx` and the vault, inspections and observations filters.
- Never put `absolute` positioned icons inside `<Button>`. Wrap in `relative`, or use an icon prop.
- Persist layout preferences (sidebar rail) in a cookie to avoid first-paint shift. Keep `useMediaQuery` for behaviour only; use Tailwind classes for styling.
- Every truncated name or number needs a `title` (or visible full text in a detail view). Status always needs text or an icon plus colour.
- Migrate remaining `StatCard` usages to `StatTile` and `StatGrid`, `hover:bg-off-white` to `hover:bg-surface-subtle`, and old `<summary>` pills to one shared disclosure component.
