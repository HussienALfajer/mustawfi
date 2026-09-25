# Roadmap

Last updated: 2026-09-25

Work is organized in **spec units**. A unit is one module, or a few tightly coupled core modules specified together. Each unit goes through the workflow in `docs/workflow/`: spec session → slices → close.

## Status legend

`Not started` · `Spec ready` · `In progress` · `Done`

## Phase A — Foundation

| Step | What | Status |
|---|---|---|
| A1 | Foundation documents and agent setup (this repository's current contents) | Done (2026-09-25) |
| A2 | Architecture session | Done (2026-09-25) — ADR-0014 to ADR-0028 accepted (ADR-0024 after a follow-up identity comparison) |
| A3 | Walking skeleton (`docs/product/modules/walking-skeleton.md`) | Closing — slice 15 (receipt on a real printer) moved to `sales`; ADR-0015 rule 5 open (see the unit spec) |

### A2 — Architecture session

One discussion session with the user, run at `/effort high`, producing accepted ADRs for every open technical decision in `docs/architecture/overview.md` §12:

- Server runtime and framework (TypeScript), API style, request validation.
- Monorepo tooling and final repository layout (tenant client, server, admin console, shared packages); module-boundary enforcement tool.
- PostgreSQL version, schema conventions (IDs, timestamps, naming), migrations tool, ORM or query builder, how the RLS tenant context is set per request.
- **Money representation**, rounding, and exchange-rate precision (no floating point).
- Local database per client (Tauri, Capacitor, browser), sync protocol (outbox, idempotency keys, cursors, batching), device numbering, signing of licenses and configuration bundles.
- Authentication: sessions or tokens, PIN login on shared devices, device registration and revoke.
- Client stack: state and data layer, RTL-capable UI kit, i18n.
- Visual design direction for the tenant app: design tokens, Arabic typography, and an explicit list of UI patterns to avoid.
- Thermal printing (render to raster, ESC/POS) and camera scanning libraries.
- Test stack: unit, property-based (ledger), integration against real PostgreSQL, sync simulation harness, end-to-end.
- CI/CD on GitHub Actions; hosting target and environments; backups; error reporting and observability.
- Admin console stack.

**Done when:** every item is decided in an ADR (or explicitly deferred with a reason), the user has accepted them, `docs/architecture/overview.md` §11–12 reflect the result, the walking-skeleton spec (`docs/product/modules/walking-skeleton.md`) exists with its slice plan, and everything is committed.

### A3 — Walking skeleton

The thinnest end-to-end path through the chosen stack: create a tenant → log in → create a product → sell it on a client while offline → sync → see the sale on the server with a balanced journal entry.

**Done when:** that path runs in CI; `AGENTS.md` Commands lists the real build, test, lint, and typecheck commands; a `verify` skill runs the project's verification; hooks (formatting after edits, filtered test output) and path-scoped rules for ledger, sync, tenancy, migrations, and RTL UI exist; module-boundary tooling fails the build on violations.

## Business track (the owner, in parallel with development)

These are not agent tasks, but their findings feed the spec sessions:

- Field interviews before the first spec sessions: 10–15 mobile phone shops and 5 supermarkets (current software, pain points, what they pay).
- A Syrian accountant as advisor, available for the `core-money`, `treasury`, and `reports` spec sessions.
- Inquiry with the General Commission for Taxes and Fees about approval conditions for accounting software.
- Certified hardware: source and test the printers, scanners, and cash drawers to support.
- Resellers per governorate, lined up before the beta.

## Phase B — V1 modules (in order)

| # | Spec unit | Modules covered | Status |
|---|---|---|---|
| 1 | `core-foundation` | core.tenancy, core.access, core.organization, core.audit | Not started |
| 2 | `core-money` | core.currency, core.ledger | Not started |
| 3 | `core-config` | core.config (registry, entitlements, settings, custom fields, templates) | Not started |
| 4 | `core-sync` | core.sync (hardening beyond the skeleton, simulation harness, Android shell and its native SQLite adapter) | Not started |
| 5 | `inventory` | inventory | Not started |
| 6 | `treasury` | treasury | Not started |
| 7 | `customers` | customers | Not started |
| 8 | `sales` | sales (inherits walking-skeleton slice 15: receipt on a real printer and reference-hardware timing) | Not started |
| 9 | `purchases` | purchases | Not started |
| 10 | `reports` | reports, owner dashboard | Not started |
| 11 | `core-services` | core.notifications, core.data | Not started |
| 12 | `admin` | admin console, initial version | Not started |
| 13 | `serials` | serials | Not started |
| 14 | `repairs` | repairs | Not started |
| 15 | `recharge` | recharge | Not started |
| 16 | `customer-portal` | customer-portal | Not started |
| 17 | `ops` | Production deployment, off-site backups and restore drill, monitoring, operations runbook, pilot hosting move trigger (ADR-0027) | Not started |

## Phase C — Closed beta

5–10 real mobile phone shops, free in exchange for feedback. Fixes flow back as slices of the affected units.

## Phase D — Launch

| # | Spec unit | Modules covered | Status |
|---|---|---|---|
| 18 | `weighted` | weighted (supermarket pack) | Not started |
| 19 | `admin-lifecycle` | admin console completion: lifecycle automation, dashboard, staff roles | Not started |

After the last unit: work through the launch gates in `docs/product/v1-scope.md` §10. They are a checklist, not a spec unit.
