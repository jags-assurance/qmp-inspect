# Buttons: one standard

Use `components/ui/button.tsx` for every action. Do not hand-style a `<button>` or a link that looks like one.

| Need | Use |
|---|---|
| The main action of a form or card (one per group) | `<Button>` (primary) |
| Other actions | `<Button variant="outline">` |
| Toolbar / low emphasis | `<Button variant="ghost">` |
| Destructive and final (delete, withdraw) | `<Button variant="danger">` |
| Destructive but reversible, or needs a reason first | `<Button variant="danger-outline">` |
| Inline text action in a row, cell or sentence | `variant="link"`, `"link-muted"` (Cancel, Clear) or `"link-danger"` |
| A link that must look like a button | `<Link className={buttonVariants({ variant: "outline" })}>` |

Sizes (8-point scale, text never below 14 px): `sm` 32 px for dense rows and tables, `md` 40 px default, `lg` 48 px for one prominent call to
action. On touch screens boxed buttons grow to at least 44 px.

Order inside a group (`<ButtonGroup>`): primary first, then outline, then Cancel (link-muted or ghost), destructive last, with the same gap
(`gap-2`) everywhere. Icon-only buttons need an `aria-label`. Tabs, toggles (`aria-pressed`) and menu items keep their own components.

## Additions (design system v2)

- `size="icon"` is a square icon-only button (40 px, 44 px on touch). It always needs an `aria-label`. Prefer it for toolbar and header
  tools; in page headers use `PageHeader`'s secondary-actions menu instead of loose icon buttons.
- Page-level actions are laid out by `PageHeader` (primary action first, secondary actions fold into a "..." menu on phones). Do not
  hand-roll action rows at the top of a page. See `docs/UI_DESIGN_SYSTEM.md`.
- Outline and ghost hover use the `surface-subtle` token; primary and outline carry the `shadow-xs` token.
