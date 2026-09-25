# Architecture overview

Status: Accepted · Technology choices recorded in ADR-0014 to ADR-0028 · Last reviewed: 2026-09-25

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
// illustrative shape — the final API is built in the walking skeleton
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
- Boundaries are enforced by tooling: package `exports`, dependency-cruiser rules, and a manifest check (ADR-0015).
- Every module's tables exist for every tenant; disabling a module hides it, it never drops data.

## 3. Tenancy (ADR-0002, ADR-0004)

- Single shared database, `tenant_id` + `branch_id` on every tenant-owned row, PostgreSQL row-level security as the enforcement layer. Code bugs can't leak data across tenants because the database refuses.
- V1 tenants have one hidden default branch; multi-branch later is activation, not migration.
- A large customer can later move to a dedicated database or server running **the same code**.
- An automated test proves one tenant cannot reach another's data.
- Every database access runs in a transaction that sets the tenant context with `set_config(..., true)`, as a role without `BYPASSRLS`; a missing context returns nothing (ADR-0017).

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
- Document numbers carry a device prefix: `{prefix}-{docCode}-{seq}`, the prefix unique per tenant and never reused (ADR-0020).
- Devices send complete documents; the server posts the journal entry, stock movements, and document in one transaction. A completed sale is never refused for a business rule — it is accepted and flagged (ADR-0020).
- The device receives a **signed configuration bundle** (license, entitlements, settings, custom-field definitions, templates, permissions; form-layout overrides join it after V1) and works fully offline with it until the license's maximum offline days.
- Each device shows its sync state; the owner dashboard shows each device's last sync.

## 6. Currency (ADR-0007)

Base currency fixed at tenant creation; owner-set daily rate with history; items priced in USD or SYP; per-document currency and rate; per-account currency for customers and suppliers; multi-currency payment on one invoice; rounding to the smallest denomination; realized FX differences computed; legacy import ÷100. Amounts are exact decimals everywhere, ledger amounts sit at the currency's minor unit, and every rounding difference is an explicit line (ADR-0018).

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

## 11. Repository layout (ADR-0015)

```
apps/
  server/       tenant API, sync endpoints, jobs (Fastify host)
  admin-api/    admin console API, separate process (ADR-0028)
  portal-api/   customer-portal read-only API, separate process (ADR-0028)
  web/          the tenant client — the single UI codebase (React + Vite)
  desktop/      Tauri 2 shell around web (Windows)
  android/      Capacitor shell around web
  admin/        admin console frontend
  portal/       customer-portal pages
core/<name>/    tenancy, access, organization, currency, ledger, audit, sync,
                config (module registry, entitlements, settings, custom fields,
                templates), notifications, data
modules/<name>/ inventory, treasury, customers, sales, purchases, reports,
                serials, repairs, recharge, weighted, customer-portal
packages/       kernel (Decimal, Money, ids, Clock), ui, i18n, local-db,
                testing, config
tools/          boundary checks and generators
```

Each module is one workspace package with three public entries: `shared` (runs on server and client — contracts, validation, pure domain rules), `server`, and `client`. Its tables live in its own PostgreSQL schema (ADR-0016). The module registry lives in `core/config`.

## 12. Technology decisions

| Area | Decision | ADR |
|---|---|---|
| Server runtime, framework, API | Node.js LTS, Fastify, REST + OpenAPI from shared Zod contracts, pg-boss jobs | 0014 |
| Monorepo and boundaries | pnpm + Turborepo, package per module, `exports` + dependency-cruiser, ESLint + Prettier | 0015 |
| Database conventions | PostgreSQL 18, UUIDv7, schema per module, Drizzle, reviewed forward-only SQL migrations, business vs accounting date | 0016 |
| Tenant context | `set_config(..., true)` in a per-request transaction, non-owner role, forced RLS, fail closed | 0017 |
| Money | Exact decimal (`numeric`, kernel `Decimal`, strings on the wire, scaled integers in SQLite), minor-unit ledger amounts, half away from zero at named points, explicit rounding lines | 0018 |
| Client local database | Native SQLite (Tauri, Capacitor), SQLite WASM on OPFS (browser), one `LocalDb` interface | 0019 |
| Sync and posting | Custom push/pull, idempotent outbox, per-tenant change log, server-side posting, device-prefixed numbering, late documents | 0020 |
| Signing | Ed25519 JWS, separate license and bundle keys, rotation, monotonic device clock | 0021 |
| Authentication | Opaque sessions, device credentials from registration codes, offline PIN verifiers, TOTP | 0022 |
| Client stack | React + Vite, TanStack Router and Query over the local database, React Hook Form + Zod, i18next, own components on React Aria, Tailwind v4 | 0023 |
| Visual design | "Ink and paper": calm and dense, ink-blue accent `#2B4A66`, paper neutrals, brass double rule, IBM Plex Sans Arabic, three densities, patterns to avoid | 0024 |
| Printing and scanning | LiquidJS HTML templates rasterized to ESC/POS, native transports, HID scanners, ML Kit | 0025 |
| Tests | Vitest, fast-check, Testcontainers PostgreSQL, sync simulation harness, Playwright | 0026 |
| CI/CD and operations | GitHub Actions, pilot on the company VPS with isolation, off-site pgBackRest, Sentry EU | 0027 |
| Admin console and portal | Separate API processes and database roles; admin frontend on the client stack | 0028 |
| Tenant at sign-in | Store code resolved through a sealed directory; tenant-routed bearer tokens | 0029 |

Deferred with a reason: chart library (`reports` spec — no chart before then), portal page rendering (`customer-portal` spec), Android printer transport plugin (`sales` unit, against certified printers), the SYP cash-rounding step (`core-money` spec with the advisor accountant), the off-site backup provider (`ops` unit).
