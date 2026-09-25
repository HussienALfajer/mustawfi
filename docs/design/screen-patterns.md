# Mustawfi screen patterns

- Agreed with the user on 2026-09-25 (`core-foundation` spec session). Builds on ADR-0023 (client stack), ADR-0024 (visual direction), and `design-system.md` (tokens, contrast, densities, patterns to avoid).
- The rules below are decided. The visual details marked *after the preview* are completed in `core-foundation` slice 3, once the user has approved the preview of the frame and the list-with-side-panel pattern.
- Like `design-system.md`, this document changes only by recorded decision (an ADR or a unit spec's deviation note).

## Who the screens are for

Accountants, owners, and cashiers who spend whole shifts in the app, mostly on a keyboard, reading many figures. The screens favour speed, density, and certainty over decoration: the user always knows where they are, what is saved, and why something is refused.

## The frame

- **Side navigation** on the start side (right in Arabic), in groups — Sales, Inventory, Accounting, Treasury, Reports, Administration, This device — collapsible to icons with labels on focus. An entry appears only when the signed-in user may open it. *After the preview:* widths, group order, the collapsed state's behaviour.
- **Top bar:** the page title, the sync status indicator, the license warning (owners), and the user menu (My account, sign out, switch user).
- **Content** fills the rest; no fixed maximum width on list screens (tables use the space), a readable maximum on forms.

## Patterns

Every screen is one of these. A new pattern needs a recorded decision and a preview approved by the user before its code.

| Pattern | Used for | Shape |
|---|---|---|
| **List with side panel** | Master data and records: users, roles, departments, devices, audit entries, products, customers | A compact table with a filter bar; selecting a row opens its details in a side panel beside the table, never a modal. The arrow keys move between rows while the panel follows. «New» opens an empty panel. |
| **Full document** | Invoices, journal entries, vouchers, statements | A full page with the document's header, lines, totals with the double rule, and its actions; opened from a list, back to the same list position. |
| **Settings form** | Store profile, My account, printer | Sections with headings on one page; a sticky footer with Save and Cancel; unsaved changes guarded on leave. |
| **Summary** | License and plan, device status | Read-only facts with their state; actions link to where they are done. |
| **Notice** | Store suspended, device removed, not registered | One message, the reason, and the one thing the user can do. |
| **Touch panel** | PIN screen, POS, supervisor override | `touch` density, targets of at least 48 px, usable with a keyboard too. |

## Interaction rules

**Keyboard**
- Every journey works without a mouse; Playwright journeys are keyboard-only.
- `Enter` moves to the next field (and submits on the last), `Esc` closes the side panel or dialog, `/` focuses the list's search, arrow keys move in tables, `Ctrl+S` saves a form or panel. Shortcuts are shown next to their buttons.
- Focus never gets lost: closing a panel returns focus to its row; saving keeps the row selected.

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

## Components

- **Built when a screen needs them.** A component starts in the module whose screen needs it; it moves to `packages/ui` when a second module needs it. Generic controls with no domain meaning (select, checkbox, switch, dialog, side panel, tabs, badge, page header, filter bar) go to `packages/ui` from their first use.
- Built on React Aria Components for behaviour, styled only with semantic and component tokens (ADR-0023, ADR-0024). No third-party component kit.
- Every `packages/ui` component has behaviour tests and appears in the **component gallery** — the former token preview page — in light and dark and in all three densities. The user can review the gallery at any time.

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

- An **axe** accessibility check in every Playwright journey fails the build on a violation.
- The touch-size check (48 px) in `touch` density (existing).
- Keyboard-only journeys per screen.
- Screenshots of each new screen, light and dark, in the slice report for the user.
