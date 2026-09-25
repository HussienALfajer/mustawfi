# <Spec unit title> (`<spec-unit-id>`)

- Status: Draft | Spec ready | In progress | Done
- Modules covered: `<module.id>`, …
- Spec agreed with the user on: YYYY-MM-DD

## Purpose

Why this unit exists and what the user gets, in a few sentences.

## Scope (V1)

What this unit delivers. Must be consistent with `docs/product/v1-scope.md`.

## Out of scope

What it deliberately does not do, with where it goes instead (later version, another unit).

## Dependencies

Other units and modules this relies on, and which of their interfaces or events it uses.

## Entities and data

Main entities, key fields, relationships. Code identifiers from `docs/glossary.md`.

## Business rules and invariants

Numbered rules. Mark module-specific invariants that tests must protect.

## Accounting impact

Which events post which journal entries (accounts, department dimension, currency handling).

## Flows

User-facing flows step by step, per form factor where they differ (desktop, tablet, phone).

## Permissions

Actions, scopes, and limits this unit adds to the permission model.

## Offline and sync behavior

What works offline, what is append-only, what is server-authoritative, what gets flagged after sync.

## Settings and customization points

Typed settings with defaults, custom-field entities, templates, entitlements this unit introduces.

## Edge cases

The hard cases agreed with the user, and the chosen behavior for each.

## Acceptance criteria

Numbered, verifiable statements for the unit as a whole.

## Verification plan

How the criteria are proven: unit, property-based, integration, sync simulation, end-to-end, manual device checks.

## Slices

| # | Slice | Done when (3–5 checks) | Effort | Depends on | Status |
|---|---|---|---|---|---|
| 1 | | | medium | — | Not started |

## Open questions

Anything still undecided, with the default that applies until it's decided.

## Changelog

- YYYY-MM-DD — Spec agreed.
