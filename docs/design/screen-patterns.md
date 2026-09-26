# Mustawfi screen patterns

- Agreed with the user on 2026-09-25 (`core-foundation` spec session). Builds on ADR-0023 (client stack), ADR-0024 (visual direction), and `design-system.md` (tokens, contrast, densities, patterns to avoid).
- The rules below are decided. The frame and the list-with-side-panel pattern were approved by the user on a preview on 2026-09-25 and built in `core-foundation` slice 3; their measures below come from that preview. The notice pattern was approved by the user on 2026-09-26 on the screenshots of «device removed» (`core-foundation` slice 9): a centred card on the page background, an icon, the title as the page's `h1`, the reason, what to do next, and one primary action that has focus. The summary pattern was approved by the user on 2026-09-26 on the screenshots of «License and plan» (`core-foundation` slice 12): titled sections on the page background at a readable width, facts as label and value pairs, the state as a word with its colour and a sentence on what it means, and a table of figures (end-aligned, tabular) whose rows link to the screen where each is managed.
- Decided on 2026-09-26 (`core-foundation` slice 10; the user left the choice to the agent's professional judgement): security settings save section by section, machine-read codes stay dark on light, and the user menu is built as the frame says. Each is recorded below.
- Like `design-system.md`, this document changes only by recorded decision (an ADR or a unit spec's deviation note).

## Who the screens are for

Accountants, owners, and cashiers who spend whole shifts in the app, mostly on a keyboard, reading many figures. The screens favour speed, density, and certainty over decoration: the user always knows where they are, what is saved, and why something is refused.

## The frame

- **Side navigation** on the start side (right in Arabic), 232 px wide, in groups in this order — Sales, Inventory, Accounting, Treasury, Reports, Administration, This device — each under a small muted heading. An entry appears only when the signed-in user may open it, and a group with no entry is not shown. The current page has the `selected` background, accent text, and a 3 px accent bar on its start edge.
- **Collapsed** to 56 px: icons only; the group headings become dividers; each label stays the link's accessible name and appears beside the icon on hover or keyboard focus. The toggle sits at the foot of the navigation with its shortcut, `Ctrl+B` toggles from anywhere, and the choice is remembered on the device (browser storage; a refusal only means it is not remembered).
- **Top bar**, 56 px: the page title (the page's one `h1`) at the start; at the end the license warning (owners), the sync status indicator, the user menu — a button showing the user's name and role that opens My account and sign out — on a registered device of the store, switch user in its place, which returns to the PIN screen (`core-foundation` slice 15). `MenuButton` in `packages/ui`: Enter or the down arrow opens it on its first item, `Esc` returns to the button.
- **Content** fills the rest; no fixed maximum width on list screens (tables use the space), a readable maximum on forms.

## Patterns

Every screen is one of these. A new pattern needs a recorded decision and a preview approved by the user before its code.

| Pattern | Used for | Shape |
|---|---|---|
| **List with side panel** | Master data and records: users, roles, departments, devices, audit entries, products, customers | A compact table under a filter bar (search, status choice, count, and «New» at the end); selecting a row opens its details in a 400 px side panel on the end side, never a modal, and the table narrows beside it. The arrow keys move the selection and the panel follows; «New» (`N`) opens an empty panel. The panel has its title and close button (`Esc`) on top, and a footer with Save (`Ctrl+S`) at the start and a destructive action at the end. The selection and the filters live in the URL. |
| **Full document** | Invoices, journal entries, vouchers, statements | A full page with the document's header, lines, totals with the double rule, and its actions; opened from a list, back to the same list position. |
| **Settings form** | Store profile, My account, printer | Sections with headings on one page; a sticky footer with Save and Cancel; unsaved changes guarded on leave. **Security settings** (My account: PIN, password, 2FA) are the exception: each section proves the change with the current secret and saves on its own with its own button, so there is no shared footer and no leave guard — a typed secret is never kept. |
| **Summary** | License and plan, device status | Read-only facts with their state; actions link to where they are done. |
| **Notice** | Store suspended, device removed, not registered | One message, the reason, and the one thing the user can do. |
| **Touch panel** | PIN screen, POS, supervisor override | `touch` density, targets of at least 48 px, usable with a keyboard too. |

## Interaction rules

**Keyboard**
- Every journey works without a mouse; Playwright journeys are keyboard-only.
- `Enter` moves to the next field (and submits on the last), `Esc` closes the side panel or dialog, `/` focuses the list's search, arrow keys move in tables, `Ctrl+S` saves a form or panel, `N` opens a new record in a list (when no field has focus), `Ctrl+B` collapses the side navigation. Shortcuts are shown next to their buttons (`Kbd`, fed with the button's own `aria-keyshortcuts`).
- Focus never gets lost: closing a panel returns focus to its row (or to «New» for a new record); saving keeps the row selected.

**Tables**
- `compact` density; sticky header; numeric columns end-aligned with tabular figures and their currency; a totals row where totals mean something.
- Filters and sort live in the URL (typed search parameters), so a filtered list can be reopened or shared.
- Row actions are always visible on the selected row, never on hover only.
- Long values are truncated only with the full value one keystroke or tap away.
- Large lists are virtualized, never paginated in the POS and never infinitely scrolled in reports (ADR-0024).

**Forms**
- `comfortable` density; labels above fields, never placeholders as labels; required fields marked in words.
- Validation uses the same Zod schema as the server (the module's `shared` entry), shown inline in Arabic on leaving a field and on save; the browser's own messages never appear.
- A failed save keeps everything typed and says what to fix, on the screen, not only in a toast.

**Refusals and states**
- What the user's role never allows is not shown. What is blocked by state — a license limit, read-only, a locked period — stays visible and explains itself when used («وصلت إلى حد 3 مستخدمين في باقتك»).
- Status is written as a word with its colour («نشط», «موقوف», «مُبطَل»), never colour alone.
- Routine actions have no confirmation. Destructive or security actions (revoke a device, deactivate a user, archive a department) confirm once and ask for a reason, which goes to the audit log.
- Important failures (sync, print, posting, save) stay on screen until resolved; toasts are for success only.
- Every details panel ends with «last changed by … on …», linked to the audit log for users who may read it.
- Loading never blocks the screen on the network and always says whether the app is offline.
- Codes read by a machine (QR codes, barcodes) keep dark modules on a light box in every theme (`data-theme="light"` on the box): scanners and authenticator apps read dark on light. The same value is shown beside it as text for typing by hand.

## Components

- **Built when a screen needs them.** A component starts in the module whose screen needs it; it moves to `packages/ui` when a second module needs it. Generic controls with no domain meaning (select, checkbox, switch, dialog, side panel, tabs, badge, page header, filter bar) go to `packages/ui` from their first use.
- Built on React Aria Components for behaviour, styled only with semantic and component tokens (ADR-0023, ADR-0024). No third-party component kit.
- Every `packages/ui` component has behaviour tests and appears in the **component gallery** — the former token preview page — in light and dark and in all three densities, after the palette, semantic tokens, contrast pairs, and type scale. It is the web app's `/gallery` page, open without signing in, so the user can review it at any time. A test fails when the package exports a component the gallery does not show.

## Code structure

Three layers, each with one job (enforced by `pnpm check:boundaries`):

1. `packages/ui` — generic components; no domain knowledge, no data fetching.
2. A module's `client` entry — its screens and domain components, grouped by feature:
   ```
   <module>/src/client/<feature>/
     <feature>-screen.tsx   composition only: layout, table, panel
     <feature>-table.tsx    the list
     <feature>-form.tsx     the form, on the shared Zod schema
     queries.ts             query keys and options (TanStack Query)
     messages.ts            Arabic strings (i18n keys only in code)
     <feature>.test.tsx     behaviour tests
   ```
3. `apps/web` — composition only: routes, the frame, wiring modules together.

Rules: a screen does not fetch data itself (queries do); validation is written once in `shared`; no user-facing string literals, no physical directions, no raw colours (lint); one responsibility per component; typed props, no `any`.

## Checks

- An **axe** accessibility check (WCAG 2.1 A and AA rules) in every Playwright journey fails the build on a violation: journeys import `test` from `apps/web/e2e/test.ts`, which checks the screen each journey ends on, and they call `expectAccessible` on each screen they pass through. React Aria's off-screen live region is excluded: a button that stops being pending announces itself there by id, and that node outlives the button for 7 seconds when the page changes.
- The touch-size check (48 px) in `touch` density (existing).
- Keyboard-only journeys per screen.
- Screenshots of each new screen, light and dark, in the slice report for the user.
