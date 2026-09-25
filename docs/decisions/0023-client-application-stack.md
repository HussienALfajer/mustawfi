# 0023. Client stack: React + Vite, TanStack Router and Query over the local database, React Hook Form + Zod, i18next, own components on React Aria

- Status: Accepted
- Date: 2026-09-25

## Context

One React + TypeScript UI ships as a Windows app, an Android app, and a browser/PWA (ADR-0010). Its source of truth is the local database (ADR-0019), refreshed by sync. It must be Arabic, RTL, keyboard-first at the cashier, touch-friendly on tablets, fast on old hardware (add an item in under 100 ms), and dense with numbers, dates, and tables. The user asked for components built for an accounting system, not an off-the-shelf kit; shadcn/ui may serve as a reference only.

## Decision

**Core:** React 19, TypeScript, Vite. **TanStack Router** with typed routes and typed search parameters (report filters live in the URL). Route guards choose the screen set per form factor.

**Data:** **TanStack Query** is the single cache for data. Query functions read from the local database through module repositories; local writes and applied sync pages emit table-change events that invalidate the matching query keys. Queries that need the server (remote owner reports, the admin console) use the same library against the API. Small, short-lived UI state lives in **Zustand**. The POS cart is written to the local database on every change, so it survives a power cut.

**Forms:** React Hook Form with the Zod resolver, reusing the contract schemas (ADR-0014).

**Components:** three layers.

1. **Behavior: React Aria Components** (Adobe) — focus management, keyboard navigation (including grids and tables), overlays and positioning in RTL, accessibility semantics, a number field that parses Arabic-Indic digits, date fields and calendars with time zones, and built-in translations including Arabic.
2. **Design system: `packages/ui`** — our tokens and our visual design (ADR-0024), styled with Tailwind CSS v4 through semantic tokens only.
3. **Accounting components we build:** `Money` and `MoneyInput` (built on the kernel's `Money`, never `number`), `Quantity`, `CurrencyRate`, `DateTime`, `DataTable` (virtualized, keyboard grid, totals row, decimal alignment, spreadsheet-style entry for journal entries and stocktake), `EntityPicker` (search by code or name, with Arabic normalization: أ/إ/آ→ا, ة/ه, ى/ي, diacritics removed), `DocumentView`, `Statement`, `ReportLayout` (print-ready), and the POS set (keypad, tender panel, `ScanInput`, large touch targets).

React Aria rather than Base UI (checked 2026-09-25: `react-aria-components` 1.21.1, `@base-ui/react` 1.8.0): Base UI has no calendar, date picker, date field, or table, and its locale-aware number parsing arrived only in 2026. React Aria covers all of these, with 13 calendar systems, 5 numbering systems, and more than 30 locales. Mixing the two would give one app two focus models. shadcn/ui is a reference for patterns only; none of its code is vendored.

**Internationalization:** i18next + react-i18next with ICU messages (the six Arabic plural forms). One namespace per module, shipped in the module's `client` entry. No user-facing string literal in code (lint). Formatting uses `Intl` with the `ar-SY` locale — Levantine month names (كانون الثاني، شباط…), the Gregorian calendar, the tenant's time zone (`Asia/Damascus` by default). Digits are **Western (0–9) by default**, with Arabic-Indic (٠–٩) as a per-user display setting that never affects stored values or parsing; IMEIs, barcodes, and document numbers are always Western digits.

**Icons:** Tabler Icons (outline, MIT). **Charts:** chosen in the `reports` spec session (deferred: no chart exists before then).

## Consequences

- Offline and online screens share one data layer; moving later to a reactive local store such as TanStack DB changes repositories, not screens.
- Our components carry the accounting knowledge; React Aria carries the behavior that is expensive to get right.
- React Aria is somewhat heavier per component than minimal primitives; long lists are virtualized and routes are lazy-loaded to stay within the POS speed budget.

## Alternatives considered

- **shadcn/ui components** — generic look and generic behavior; used as a pattern reference only, at the user's request.
- **Base UI** — solid primitives, but no dates, calendar, or tables, which are the core of an accounting UI.
- **Building behavior from scratch** — months of focus, keyboard, and RTL-positioning work with no visible benefit.
- **Mantine / Ant Design** — fast to start, but heavier, harder to make distinctive, and Ant's admin look is generic.
- **TanStack DB** — promising live queries built for sync, but young; revisit once stable.
