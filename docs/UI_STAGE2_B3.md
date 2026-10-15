# UI stage 2, builder B3 (forms, settings, auth, error pages)

Layout and presentation only. No server action, field name, hidden input or validation changed.

## Migrated
- Auth: `components/domain/auth-shell.tsx` (new). Brand panel from md, centred card, mobile brand mark. Used by login, forgot-password, reset-password. Inputs 44px, text-base on phones, `aria-invalid` danger border, size lg submit, 44px "Forgot password?" and back links. Card heading is now the page `h1`. `PasswordField`: 44px input, 44px show/hide target, 20px icon. MFA form: centred card, large centred code input, boxed error.
- Error pages: `components/domain/error-id-chip.tsx` (new, copyable chip with a text "Copy / Copied" state). `app/error.tsx`, `app/inspect/error.tsx`, `app/not-found.tsx`, `app/inspect/not-found.tsx` use Button/buttonVariants, a card, stacked buttons on phones. `global-error.tsx` and `platform/error.tsx` untouched (inline-style fallback / not in scope).
- Creation pages: `ncrs/new`, `projects/new`, `itps/new` (both branches), `standalone/new` headers now use `PageHeader` (back link, guide, subtitle). `new-project-form`: Sections (Project details, Schedule and site, Responsibility), `md:grid-cols-2`, `FormMessage`, `StickyActionBar` with Save plus Cancel link. `new-ncr-form`: sections as cards with `text-base` headings, single column on phones, `FormMessage`, `StickyActionBar`. `new-itp-form` and `new-itp-from-template-form`: card form, `FormMessage`, `StickyActionBar`.
- Settings: workspace header via `PageHeader`; `settings-nav` z-[5] to z-10, `hover:bg-surface-subtle`, stronger bottom border. The nav already collapses to a two-row horizontal scroller below lg (stage 1), so it takes no horizontal space on tablet.
- Numbering: `numbering-config-row.tsx` is now a card per doc type: title plus a visible Sample chip at the top, 1/2/4 column field grid, 44px checkboxes (Year, Discipline), full-width Save on phones. `numbering-view.tsx` drops the outer card (no card in card).

## Follow-up pass
- `new-itp-from-ai-form`: card forms, `FormMessage`, `StickyActionBar` (Generate; Create plus Discard), editor inputs to 40px/text-sm rounded-md, per-party sign-off selects stack on phones, "Add activity" is an outline `Button`, ITP number/title/standard grid from md.
- `new-assignment-form`: single column on phones, card fieldsets, control-border type tiles with focus ring and 44px height, `FormMessage`, `StickyActionBar`.
- `global-error` (inline styles, Error ID as a pill with select-all) and `platform/error` (same layout as inspect error with `ErrorIdChip`).
- Organisation and settings views (mechanical pass): heading size by `embedded`, cards `shadow-xs sm:p-5`, row forms (`level-row-form`, `add-level-form`) stack to one column on phones, checkbox labels 44px, `hover:bg-surface-subtle`. Usage (model, category, project tables) and traceability (audit trail, checklist usage) now use `ResponsiveTable breakpoint="md"` with phone cards.
- Public pages: `PublicPageShell` has a brand bar with a 44px Sign in link, 70ch line length, larger section headings. `/verify` card, status glyph (check or cross) beside the status text, styled file input. Support, guide, whats-new and account security cards use the shared card look.

## Still not done / uncertain
- Section/Card/PageHeader were not forced onto every settings view; views keep their own markup plus the mechanical pass above. `components/ui/disclosure.tsx` did not exist, so `MoreDetails` is still used.
- Privacy page tables keep a horizontal scroll wrapper (`min-w-[40rem]`), not cards.
- Guide page (444 lines) got only token/card tweaks.
- Change-password and confirm: no such pages exist (`app/auth/confirm/route.ts` is a route handler; forced change reuses `/reset-password`).
- `tsc` currently shows `components/ui/section.tsx` (`Disclosure` undefined, B0 in progress) and the B1 StatGrid error; none in my files. Vitest: 179 files, 1370 tests pass.
