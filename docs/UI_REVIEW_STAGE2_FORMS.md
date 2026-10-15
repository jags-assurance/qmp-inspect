# UI review, Stage 2: forms, settings, auth and public pages

Reviewed by reading the code (no browser). Scope: login, forgot/reset password, MFA, error and 404 pages, verify, legal pages, `auth-shell`, `error-id-chip`, `password-field`, `public-page-shell`, the four `new` pages, settings, organisation pages and account security.

Result: 0 Blocker, 2 Major, 8 Minor, 5 Suggestion. 5 fixed, the rest open.
`npx tsc --noEmit` is clean. `npx vitest run`: 179 files and 1370 tests pass.

## Regression check (`git diff 346c29e HEAD`)

- No presentational change touched field names, hidden inputs, action wiring, redirects or validation. The `name=`, `required`, `min`/`max` and `defaultValue` lines in the diff are re-indentation only.
- The diff base also includes earlier functional commits that are not part of the redesign. They are `c83202a`, `730541f`, `8bece0a`, `d099d57`, `6c89c11` and `2d7b3f0`:
  - `VaultUploadLimitForm` in `retention-forms.tsx`
  - the client-code duplicate check in `numbering-config-row.tsx`
  - the timezone picker
  - the branding form now shows `state.message`
- Password-manager attributes are intact: login uses `autocomplete="email"` and `current-password`, reset uses `new-password` twice, MFA uses `one-time-code`. The show/hide toggle is `type="button"` with `aria-label` and `aria-pressed`.

## Findings

### Major

1. **Settings nav on phones does not scroll the active item into view** (`app/inspect/settings/settings-nav.tsx`, mobile `<ul>` rows).
   - There are many sections per group. A section in the second half of a group sits off-screen to the right, so the user cannot see where they are.
   - FIXED: new `app/inspect/settings/scroll-row.tsx` (client component). It sets `scrollLeft` on each render to centre the `aria-current` item. It scrolls only that row, not the page.
2. **Required fields have no visible marker anywhere in the new/settings forms.**
   - `FormField` supports `required`, but no caller passes it. Fields carry the native `required` attribute only.
   - Examples: itps/new Project and Title, ncrs/new, numbering Client code, level Label.
   - Screen readers hear "required" through the native attribute. Sighted users get no cue until the browser bubble appears.
   - OPEN (wide change, many files). Pass `required` to `FormField` on every field that has the attribute.

### Minor

3. FIXED: sticky action bar bled past the card edge in the three ITP "new" forms (`components/ui/sticky-action-bar.tsx`, `itps/new/*`).
   - The bar used `-mx-3` and `sm:-mx-6`, but those forms are cards with `p-4` and `sm:p-5`. On phones the bar stopped 4px short of the card edge. At `sm` (640 to 767) it overflowed by 4px each side.
   - Added an `inCard` prop (`-mx-4 px-4 sm:-mx-5 sm:px-5`) and applied it to the card forms: new-itp-form, from-template, and the first bar in from-ai (line 293).
   - The second from-ai bar (line 654) is not in a card, so it keeps the default.
   - Open for other card forms that use the bar (punch list, registers): they should also pass `inCard` if their form has card padding. Out of my area; flagging.
   - `cn()` is plain `clsx` with no tailwind-merge, so passing a conflicting `-mx-*` through `className` is unreliable. Use the prop.
4. FIXED: `ErrorIdChip` copy had no rejection handler (`components/domain/error-id-chip.tsx`).
   - A denied clipboard permission or an insecure context produced an unhandled promise rejection.
   - Now it fails quietly and the ID stays visible and selectable.
5. FIXED: the intervention-level "Code" caption was a `<label>` with no control (`level-row-form.tsx`). It is now a `<span>`.
6. FIXED: the privacy table's scroll container could not be reached by keyboard (`app/privacy/page.tsx`). Added `role="region"`, an `aria-label` and `tabIndex={0}`.
   - Open: the table text is 12px (`text-xs`) and the headers are not run through `<T>` (not translated).
7. OPEN: `PasswordField` shows an eye icon at `h-5` and an eye-off icon at `h-5` with the slash, but the base eye is `h-4` (`password-field.tsx:72`). The icon visibly changes size when toggled. Make both `h-5`.
8. OPEN: the reset-password hint `#pw-hint` is not tied to the inputs (`reset-password-form.tsx`). `PasswordField` has no `describedBy` prop. Screen-reader users miss the rules until after an error.
9. OPEN: MFA page does not use `AuthShell`, so it has no brand mark (`login/mfa/mfa-form.tsx`). Its label "Code" and the button text "Checking…" and "Verify" are not translated. The field is `inputMode="numeric"` with `maxLength=7`; check this against recovery codes if they exist.
10. OPEN: forgot-password swaps to the "Check your email" view with no focus move or live region (`forgot-password/page.tsx`). Screen-reader users hear nothing. Put `tabIndex={-1}` and focus on the new `h1`, or wrap the result in `role="status"`.
11. OPEN: `ResponsiveTable breakpoint="md"` on the usage page (`organisation/usage/page.tsx`) turns into a 4-column table in a half-width card at 1024 to 1279 (`lg:grid-cols-2`). Model names are `break-all`, so it works, but it is tight. Consider `breakpoint="xl"` for the two half-width cards.

### Suggestions

- Login email: use `autoComplete="username"` plus `autoCapitalize="none"` and `spellCheck={false}`. Some password managers key on `username`.
- The "Forgot password?" link sits between the label and the field, so the tab order is email, link, password. Move it below the password field so the form reads in order.
- `PublicPageShell` top band is only `max-w-3xl` wide on desktop, so it looks like a floating bar. Make it full-bleed.
- Many "new" form inputs are about 38px tall (`py-2 text-sm`) with no `min-h-11` or focus ring (itps/new, level rows). On phones `globals.css` forces 16px font, so there is no iOS zoom. On touch the height is still below 44px. Use the shared input class as the numbering rows do.
- Numbering rows are good: the sample uses the real formatter and wraps with `break-all`. Client code spans two columns at `sm`. Padding, originator and separator fit the 1, 2 and 4 column grid. The `Number("") = 0` case falls back to 1 correctly.

## What was checked and is fine

- AuthShell: brand panel hidden below `md`, mobile logo above the card, `min-h-dvh`, card `max-w-md`.
- Login: `autoFocus`, `FormField` wires id, label and `aria-invalid`, `FormMessage` live regions are always mounted, submit shows "Signing in…" and is disabled while pending.
- Error pages: `app/error.tsx` has `role="alert"`, buttons stack on phones, ID chip is `min-h-11` and `truncate`s. `global-error` uses inline styles with `overflowWrap: anywhere`.
- Not-found: single primary action.
- Verify page: pass and fail states now carry a text and symbol marker, not colour alone.
- Legal shell: 70ch line length, correct h1 then h2 hierarchy.
- Settings nav: `aria-current="page"` on items, `"true"` on groups, 44px targets, sticky offset uses `--header-h`.
- Destructive actions use `danger` / `link-danger` and sit last in their group.

## MANUAL DEVICE CHECKLIST

**Settings navigation (375x812 and 768x1024)**
1. Open Settings, pick the last group, then tap the last section in its row. The row should scroll so the selected pill is roughly centred. The page must not jump vertically.
2. Tap another group. The second row should show that group's sections with the first (or current) one in view.
3. At 1280 and 1440 the left rail replaces the pills. The active entry is tinted and the rail scrolls on its own if it is taller than the screen.

**Sign-in (375x812, 768x1024, 1280x800)**
1. 375: no brand panel; round "JA" logo above a card. 768 and up: burgundy panel on the left, card on the right.
2. The email field is focused on load. Tap it on a phone: the page must not zoom.
3. Enter a wrong password. A red message appears above the button, the email field gets a red border, and the button reads "Signing in…" while waiting.
4. Tap the eye: the password shows, the label becomes "Hide password", and the icon should not change size (open item 7).
5. Let a password manager fill the form. Both fields should fill and Enter should submit.
6. Open MFA: type a 6-digit code, the numeric keypad appears, a one-time-code suggestion appears from SMS or the authenticator, and the box is centred and large.

**Forgot and reset password**
1. Submit an email: the "Check your email" view appears. With a screen reader, note whether it is announced (open item 10).
2. Reset page: both fields show eye toggles. The rules line sits under the fields. A mismatch shows a red message above the button.

**Error and 404 (any size)**
1. Visit a bad URL: a large "404", title, one "Go to home" button, centred.
2. Trigger an error page (use a test route if available): the Error ID chip shows. Tap it: it says "Copied" for two seconds. In a non-HTTPS or blocked-clipboard browser, nothing breaks and the ID can still be selected.

**Creating records (375x812 then 768x1024)**
1. New ITP, "Manual" tab: the form is a white card. Scroll: the Create ITP bar sticks to the bottom of the screen with its sides flush to the card edge (no gap, no overhang). At 768 and up the bar is a plain row inside the card.
2. Focus the last input with the keyboard open. The field must stay visible above the bar. If the bar covers it, scroll further and note the device.
3. New NCR, New project, New standalone assignment: the bar spans edge to edge, fields are not hidden behind it, and Save shows "Creating…" or "Saving…" and cannot be tapped twice.

**Organisation settings**
1. Numbering at 375: each document type is a card. The Sample line is above the fields and wraps instead of overflowing. Change the separator or tick Year: the sample updates at once.
2. Numbering at 768: Client code takes the full row. At 1280: Client code is two columns wide, then originator and separator, and padding sits beside the Year and Discipline ticks.
3. Tap "Check code for duplicates": a coloured message appears under Save. Tap a suggestion chip to fill the code.
4. Intervention levels at 375: each level is one column. The Blocking tick is easy to hit. "Remove level" is a red text link under the row.
5. Retention and data requests: the red "Anonymise account…" button asks for confirmation before acting.
6. Usage page at 375: the tables turn into labelled cards. At 768 and 1280 they are tables. Look for horizontal scroll at 1024.

**Account security**: the card is `max-w-xl`. The enrol QR and code field sit inside the card with no sideways scroll at 375. The code field uses the numeric keypad.

**Public pages**
1. Privacy at 375: the data table scrolls sideways inside its own box. Tab to it: a focus ring appears and the arrow keys scroll it.
2. Terms and Privacy at 1280: body text is no wider than about 70 characters. Headings step down h1 then h2.
3. Verify page at 375: the result card is full width. "Genuine" shows a tick and "Void" or "Rejected" shows a cross, in addition to the colour. The file picker button is at least 40px tall.

## Fix pass (builder F4)

- Required markers: every `FormField` whose control has the native `required` attribute now passes `required` (asterisk aria-hidden, visually hidden "(required)", aria-required). Raw project-organisation label got the same marker. `PasswordField` shows the marker and sets aria-required. "* required" legend added at the top of the new ITP / NCR / project / standalone forms.
- PasswordField: eye and eye-off icons both 20px; new `describedBy` prop links hint text (reset-password `pw-hint`) alongside the error; control-border.
- MFA page now uses AuthShell. Forgot-password confirmation is `role=status` / `aria-live=polite` and takes focus on its heading. Login: email `autoComplete="username"`, Forgot password link moved under the password field (44px).
- Legal pages: top band is full width, text stays 70ch.
- New-form inputs: min-h-11, control-border, focus ring, 16px text on phones.
- StickyActionBar: bars in padded cards already pass `inCard`; others sit outside cards.
- StatCard replaced by StatTile/StatGrid on 8 organisation pages; hover:bg-off-white replaced; PageHeader adopted on data-requests, orphan-photos, traceability, support, whats-new, account/security.
- Not done: usage tables at xl (ResponsiveTable only supports "sm" | "md" and is outside this builder's file ownership); no hand-styled summary or Escape listeners were found in these areas.
