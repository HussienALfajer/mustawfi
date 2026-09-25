# Mustawfi — agent instructions

Mustawfi (مُستوفي) is a multi-tenant SaaS for accounting and point of sale, built by Vertex System for Syrian retail stores. V1 serves single-branch small and medium stores — mobile phone shops first, supermarkets second — where several staff work in separate sections (repairs, accessories, carrier top-ups…) and everything consolidates to the owner and the main accountant. The product must keep selling when the internet or power drops, and must handle US dollars and the new Syrian pound side by side. It will grow into multi-branch and enterprise accounting, so today's design must not block that.

## Where the truth lives

Read what the task needs; don't load everything.

| Need | Source |
|---|---|
| What V1 contains, module by module | `docs/product/v1-scope.md` |
| Detailed spec and slice plan of a module | `docs/product/modules/<spec-unit>.md` |
| Why a technical choice was made | `docs/decisions/NNNN-*.md` (ADRs) |
| System shape, module rules, customization model | `docs/architecture/overview.md` |
| Phases, spec units, module order, status | `docs/roadmap.md` |
| Arabic ↔ English terms and code identifiers | `docs/glossary.md` |
| How to spec, build, review, close a module | `docs/workflow/*.md` |
| Market, competitors, pricing | `docs/product/vision.md` |

## Non-negotiables

These hold in every change. A change that needs to break one stops and asks the user.

1. **One codebase for all customers.** Per-customer behavior comes from configuration (entitlements, settings, custom fields, templates, add-on modules in this repo) — never from forks or per-customer branches.
2. **Modular monolith.** A module never reads another module's tables or internals; it uses that module's public interface or domain events.
3. **Tenant isolation.** Every tenant-owned table has `tenant_id` and `branch_id`; PostgreSQL row-level security enforces isolation. No query may bypass it.
4. **Offline first.** A sale never waits for the network. Clients work from a local database and sync through an outbox.
5. **One ledger per tenant, double-entry.** Every financial event posts balanced journal entries (debits = credits). Departments are profit centers inside that ledger, not separate books.
6. **Posted documents are immutable.** Corrections are reversals. Nothing financial is ever deleted.
7. **Every document records** its currency, exchange rate, department, user, shift, device, and the print-template version used.
8. **Document numbers are unique per device** (device prefix), so offline devices never collide.
9. **Closed periods are locked.** No document may be dated inside a locked period.
10. **Everything is audited.** Create, cancel, return, discount, price change, permission change, login, drawer open without sale, support impersonation — with who, what, when, which device, before/after values.

## Domain gotchas

- **Currency:** since 2026-01-01 amounts are in the *new* Syrian pound (two zeros removed). Old notes lost legal tender on 2026-07-31. Legacy data imported from old systems is divided by 100 — the import tool offers this explicitly.
- **Dollarization:** merchants price many items in USD and sell in SYP at a daily rate the owner sets. Customer and supplier debts are often kept in USD. Never assume SYP-only.
- **Connectivity:** power and internet are intermittent. Never make a sale, print, or shift close depend on the server.
- **Arabic on thermal printers:** ESC/POS printers render Arabic unreliably. Render receipts to an image and print the raster.
- **IMEI:** 15 digits with a Luhn check digit. Dual-SIM phones have two IMEIs. Phone boxes carry several barcodes (IMEI1, IMEI2, serial, EAN) — classify them, don't take the first one scanned.
- **Clients run on Windows 10 or later.** Windows 7 is still common in Syrian shops but is not supported; say so wherever requirements are shown.
- **Cash is local reality:** shifts, cash counts, handovers, and owner drawings are core features, not edge cases.

## How work is organized

Work flows in spec units (a module or a small group of tightly coupled core modules, listed in `docs/roadmap.md`):

1. **Spec session** — agent and user discuss the unit; output is `docs/product/modules/<unit>.md` with an ordered slice plan. See `docs/workflow/module-spec.md`.
2. **Slices** — one slice per session: build, verify, review, update the spec, ship. See `docs/workflow/implement-slice.md`.
3. **Close** — whole-unit review, docs reconciled, lessons folded back into these instructions. See `docs/workflow/close-module.md`.

A **slice** is one verifiable outcome that fits in a single session without compacting context: roughly one module's internals plus the core interfaces it uses, finishable in 3–5 checkable conditions.

## Working agreement

- When a step doesn't need the user, keep going. Put status notes in the same message as your next action.
- Stop and ask only when you can't continue without the user, or before anything destructive or hard to undo: deleting data, force-pushing or rewriting pushed history, changing anything outside this repository, or changing a non-negotiable or an accepted ADR.
- If a request has no verifiable finish line, state the one you'll use in one line, then proceed.
- Stay inside the task's scope. Record what you notice outside it under **ما وجدته** instead of fixing it silently.
- Accepted ADRs are settled. Don't reopen one without new evidence; if you think one is wrong, say why and let the user decide. A new significant decision gets an ADR (from `docs/decisions/_template.md`) with status *Proposed* until the user accepts it.
- Show evidence, not assertions: the commands you ran and what they returned.
- Mark anything you couldn't confirm, and say where you looked.
- Give your candid professional opinion, including disagreement with the user's idea, with the reasons. The user wants it.

## Definition of done (code changes)

- The slice's acceptance criteria hold, shown by checks that ran.
- New behavior has tests; invariants touched by the change have tests that would fail if the invariant broke.
- Project verification passes (see Commands).
- The module spec reflects what was built (slice status, deviations noted).
- Committed with a Conventional Commits message, e.g. `feat(treasury): close shift with variance posting`.

## Reporting

End every task that changes files or runs more than a few steps with a report to the user, in Arabic, under these headings (a quick question gets a direct answer instead):

- **ينتظرك** — decisions or approvals needed from the user, or «لا شيء».
- **ما تغيّر** — what changed, briefly.
- **الدليل** — checks run and their results.
- **ما وجدته** — out-of-scope findings, risks, anything unconfirmed.
- **الخطوة التالية** — the exact next action, copy-paste ready.

## Language

- Chat with the user in Arabic. Everything stored in the repository is English: code, docs, commit messages, PR descriptions.
- V1 UI text is Arabic, always through i18n keys — never hard-coded strings.
- Name things with the identifiers in `docs/glossary.md`; add new domain terms there.

## Git

- Until CI exists (Phase A3), documentation-only changes may be committed directly to `main`.
- After that: one branch per slice (`slice/<unit>-<n>-<short-name>`), a PR to `main`, squash-merge once verification and review pass. A slice that touches a non-negotiable or an ADR waits for the user's approval under **ينتظرك**.
- Never force-push and never rewrite pushed history.

## Commands

Not defined yet — set during Phase A3 (walking skeleton). Until then there is no code to build or test.
