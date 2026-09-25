# Architecture overview

Status: Accepted principles; concrete technology choices pending Phase A2 · Last reviewed: 2026-09-25

This document explains *how* the non-negotiables in `AGENTS.md` are realized. Each section links the ADR that holds the reasoning.

## 1. System shape

```
                 ┌───────────────────────────────────────────┐
                 │  Server: one codebase, all tenants         │
                 │  API · modules · PostgreSQL with RLS       │   ◄── Admin console (control plane,
                 │  one ledger per tenant                     │       separate app, Vertex staff)
                 └───────────────┬───────────────────────────┘
                     sync (when online) │        public read-only API ──► customer portal pages
   ┌──────────────────┬───────────────┼───────────────┬──────────────────┐
   │ Windows app       │ Android app    │ Android phone  │ Browser / PWA     │
   │ main cashier      │ touch POS      │ companion      │ owner, accountant │
   │ local DB + outbox │ local DB       │ local DB       │ limited offline   │
   └──────────────────┴───────────────┴───────────────┴──────────────────┘
```

Sync runs between each device and the server, never between departments. Departments are dimensions inside the one ledger (ADR-0006).

## 2. Modular monolith (ADR-0003)

One deployable application, divided into modules with enforced boundaries.

**A module owns** its tables, its API endpoints, its screens, its permissions, its typed settings schema, its print templates, and the domain events it publishes and consumes. It declares all of this in a **manifest**:

```ts
// illustrative shape — final API decided in Phase A2
export const repairsModule = defineModule({
  id: "repairs",
  dependsOn: ["core", "inventory", "customers", "sales"],
  permissions: ["repairs.view", "repairs.create", "repairs.assign", "repairs.deliver", "repairs.viewCost"],
  settings: repairsSettingsSchema,
  customizableEntities: ["repair_ticket"],
  printTemplates: ["repair_receipt", "repair_label"],
  publishes: ["RepairDelivered", "RepairPartsConsumed"],
  subscribes: { InvoicePosted: onInvoicePosted },
});
```

**Rules**
- No module reads another module's tables or internal files. It calls the other module's public interface or reacts to its events.
- Domain events are handled **inside the same database transaction** as the change that raised them (e.g. `InvoicePosted` → ledger entry + stock movement + cash box update, all or nothing).
- The module registry validates dependencies at startup; a module can't be disabled while an enabled module depends on it.
- Boundaries are enforced by tooling (lint/dependency rules), chosen in Phase A2.
- Every module's tables exist for every tenant; disabling a module hides it, it never drops data.

## 3. Tenancy (ADR-0002, ADR-0004)

- Single shared database, `tenant_id` + `branch_id` on every tenant-owned row, PostgreSQL row-level security as the enforcement layer. Code bugs can't leak data across tenants because the database refuses.
- V1 tenants have one hidden default branch; multi-branch later is activation, not migration.
- A large customer can later move to a dedicated database or server running **the same code**.
- An automated test proves one tenant cannot reach another's data.

## 4. Ledger (ADR-0006)

- Double-entry, balanced by construction; every financial event posts through the ledger module's interface.
- Departments are profit centers (a dimension on journal lines), with their own cash boxes.
- Posted documents are immutable; corrections are reversals; closed periods are locked.
- Chart of accounts comes from a sector template and remains editable.

## 5. Offline and sync (ADR-0005)

- Every client keeps a local database with the data its user's scope needs.
- Operations go into an **outbox** and are delivered idempotently (retries never duplicate).
- **Conflict model**
  - Documents (invoices, vouchers, shifts, tickets) are append-only: they can't conflict.
  - Master data (products, prices, permissions, settings) is server-authoritative and flows down.
  - Stock can go negative because of offline sales; that is flagged for the accountant, never blocks the sale.
- Document numbers carry a device prefix.
- The device receives a **signed configuration bundle** (license, entitlements, settings, custom-field definitions, templates, permissions; form-layout overrides join it after V1) and works fully offline with it until the license's maximum offline days.
- Each device shows its sync state; the owner dashboard shows each device's last sync.

## 6. Currency (ADR-0007)

Base currency fixed at tenant creation; owner-set daily rate with history; items priced in USD or SYP; per-document currency and rate; per-account currency for customers and suppliers; multi-currency payment on one invoice; rounding to the smallest denomination; realized FX differences computed; legacy import ÷100.

## 7. Licensing (ADR-0008)

Signed license on every device; lifecycle active → expiring → grace → read-only → suspended → archived; never mid-shift; export always allowed; perpetual licenses carry annual maintenance.

## 8. Customization model (ADR-0002, ADR-0009)

Per-tenant variation climbs this ladder; each rung is built once and serves every module:

| # | Layer | Mechanism | Who changes it |
|---|---|---|---|
| 1 | Modules on/off | Entitlements | Vertex admin |
| 2 | Features inside a module | Sub-entitlements | Vertex admin |
| 3 | Limits (users, departments, devices) | Numeric entitlements | Vertex admin |
| 4 | Settings | Typed settings schema, hierarchy | Tenant admin |
| 5 | Roles & permissions | Role/scope/action/limit model | Tenant admin |
| 6 | Custom fields | Field definitions (metadata) + JSONB values | Tenant admin (Vertex support can help) |
| 7 | Form layout | Overrides: hide, require, relabel, reorder — *deferred after V1* | Tenant admin |
| 8 | Templates | Versioned print and message templates with variables | Tenant admin |
| 9 | Add-on modules | Modules in this codebase, entitled per tenant | Vertex (paid development) |
| 10 | Integration | Public API and webhooks — *deferred after V1* | Tenant or their developer |

**Never customizable**: ledger rules, document immutability, the core data model (custom fields cover additions), security and tenant isolation, sync semantics.

**Entitlements vs feature flags**: entitlements answer *what did the tenant buy* (commercial, permanent); feature flags answer *is this ready for this tenant* (technical rollout, temporary). They are separate mechanisms.

**Enforcement points**: the server is authoritative (every API call checks entitlements); the UI hides what isn't entitled (convenience only); offline devices read entitlements from the signed bundle.

**Settings**: resolution order system default → plan → tenant (→ branch, → user for some keys later); nearest wins; every change audited.

**Custom fields**: a definitions table (`tenant_id`, entity, key, Arabic label, type, options, required, order, role visibility, archived_at) and a `custom_fields jsonb` column on each customizable entity with a GIN index. No EAV tables. Validation shares one definition on client and server. Archived fields keep their data.

**Templates**: variables such as `{{customer.name}}`; every document stores the template version it was printed with, so reprints match the original.

**Rule of three**: nothing becomes configurable until three different tenants need the variation; until then it's a fixed default.

## 9. Public surface (ADR-0012)

The customer portal uses a separate read-only public API: unguessable signed tokens in QR links, an explicit allowlist of public fields per entity (never cost, never exact stock), rate limiting, merchant on/off switches per page.

## 10. Control plane (ADR-0013)

The admin console is a separate application with mandatory 2FA, staff roles, and an immutable audit log. It manages tenants, plans, licenses, payments, entitlements, and read-only support impersonation that tenants can see.

## 11. Proposed repository layout (to be confirmed in Phase A2)

```
src/
├── core/            # always on: tenancy, access, organization, currency, ledger,
│                    # audit, sync, notifications, data, events, and config
│                    # (module registry, entitlements, settings, custom fields,
│                    # templates)
└── modules/         # inventory, treasury, customers, sales, purchases, reports,
                     # serials, repairs, recharge, weighted, customer-portal
```

The module registry (loads manifests, validates dependencies) lives in `core/config`.

Apps (Windows/Android/web client, server, admin console) and shared packages are arranged in a monorepo whose tooling is decided in Phase A2.

## 12. Open technical decisions

Decided in Phase A2 (see `docs/roadmap.md`): server runtime and framework, API style, monorepo tooling, ORM/query layer and migrations, money representation and rounding precision, local database and sync protocol details, license and bundle signing, authentication details, client state/data layer and RTL UI kit, printing and scanning libraries, test stack, CI/CD, hosting and environments, observability and backups, admin console stack.
