# 0009. Separate entitlements from feature flags; build the customization layers once for all modules

- Status: Accepted
- Date: 2026-09-25

## Context

Every tenant may need different modules, limits, fields, and printouts (ADR-0002). If each module invents its own customization, the code multiplies and support becomes impossible.

## Decision

- **Entitlements** (what the tenant bought) = plan + paid add-ons + per-tenant overrides. Checked on the server (authoritative), in the UI (hiding), and on devices (signed bundle).
- **Feature flags** (technical rollout) are a separate, temporary mechanism.
- **Settings** use a typed schema per module, with a resolution hierarchy (system → plan → tenant; later branch and user) and an auto-generated settings screen.
- **Custom fields**: metadata definitions plus a `custom_fields jsonb` column with a GIN index on each customizable entity; archived, never erased; no EAV tables. V1 entities: product, customer, repair ticket.
- **Templates**: versioned print and message templates; documents store the version used.
- **Form-layout overrides** and a **public API** are designed for but deferred after V1.
- **Never customizable**: ledger rules, document immutability, the core data model, security and isolation, sync semantics.
- **Rule of three**: a variation becomes configurable only when three tenants need it.

## Consequences

- Most customization requests become admin-console changes, with no code.
- Custom-field definitions and templates must sync to offline devices.
- Reports must be able to filter and group by custom fields.

## Alternatives considered

- **Per-module ad hoc configuration** — duplicated effort, inconsistent behavior.
- **EAV tables for custom fields** — slow and awkward to report on.
- **Drag-and-drop form builder in V1** — inner-platform risk; not needed yet.
