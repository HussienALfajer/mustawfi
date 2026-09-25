# 0016. PostgreSQL 18 conventions: UUIDv7 keys, a schema per module, Drizzle with reviewed SQL migrations

- Status: Accepted
- Date: 2026-09-25

## Context

PostgreSQL with row-level security is settled (ADR-0004). Offline devices create documents without the server, so identifiers must be final at creation. Old app versions keep syncing for a while after a release, so schema changes must stay compatible. The same query layer should serve PostgreSQL on the server and SQLite on devices (ADR-0019).

## Decision

**Version:** PostgreSQL 18 (native `uuidv7()`), pinned to one minor line per release.

**Identifiers:** every primary key is a UUIDv7 (`uuid` column), generated where the record is created — on the device offline, or on the server — through `packages/kernel`, from a cryptographic source. Human-facing numbers (document numbers, ADR-0020) are separate columns.

**Ownership:** one PostgreSQL schema per module (`core_ledger`, `core_access`, `inventory`, `sales`…). A module's SQL touches only its schema. Foreign keys across modules are allowed only toward modules in its `dependsOn`, and only to hold integrity — never as a way to read.

**Naming:** tables and columns `snake_case`; tables plural (`sales.invoices`, `sales.invoice_lines`). TypeScript uses camelCase through Drizzle's casing mapping.

**Standard columns** on every tenant-owned table: `tenant_id`, `branch_id`, `created_at`, `created_by`. Documents additionally carry the fields of non-negotiable 7 (currency, exchange rate, department, user, shift, device, template version).

**Time:** instants are `timestamptz`, stored in UTC. A document also has a `business_date` (`date`, in the tenant's time zone, `Asia/Damascus` by default) — the day the event happened — and its journal entry an `accounting_date`, the day it is posted to (ADR-0020). Period locks apply to the accounting date.

**Types:** money, prices, quantities, and rates use `numeric` with the scales in ADR-0018. Closed value sets use `text` with a `CHECK` constraint rather than PostgreSQL enums, which are awkward to change. `jsonb` is used only for custom fields (ADR-0009) and for immutable payload snapshots.

**Immutability in the database:** the application role has no `DELETE` on document and ledger tables, and triggers refuse `UPDATE` of posted rows. Master data is archived (`archived_at`), never deleted.

**Data access:** Drizzle ORM — schema in TypeScript, SQL-like query builder, the same library over PostgreSQL (server) and SQLite through `sqlite-proxy` (devices). Raw SQL through Drizzle's `sql` tag where it is clearer.

**Migrations:** `drizzle-kit generate` produces SQL files that are reviewed and committed; they may be hand-edited (RLS policies, triggers, grants). Forward-only. Breaking changes go expand → migrate data → contract, across at least two releases, so the previous app version keeps working. Migrations run as a dedicated owner role in a one-off step before the new version starts. CI applies every migration to an empty database and to the previous release's schema.

## Consequences

- Offline-created records never need ID translation after sync.
- A module's table ownership is visible in every query and checkable by tooling.
- Two-phase schema changes slow some refactors down; that is the price of devices on old versions.

## Alternatives considered

- **bigint keys with temporary client UUIDs** — every offline reference needs translation after sync, a known source of bugs.
- **One schema with table-name prefixes** — separation by convention only; hard to check.
- **Kysely** — excellent query builder, but no central schema or migration generation, so the schema is written twice.
- **Prisma** — setting RLS context inside transactions is awkward, and it is weaker at advanced SQL.
