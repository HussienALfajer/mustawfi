---
paths:
  - "**/migrations/**"
  - "**/*.sql"
  - "**/drizzle.config.*"
  - "**/schema.ts"
  - "**/schema/**"
---

# Database schema and migration rules

Sources: ADR-0016 (PostgreSQL conventions), ADR-0017 (RLS tenant context), ADR-0018 (numeric precision), non-negotiables 3, 6, 7.

- One PostgreSQL schema per module (`core_ledger`, `sales`…). A module's SQL touches only its own schema. Foreign keys cross modules only toward `dependsOn` modules, for integrity, never to read.
- Migrations come from `drizzle-kit generate`, are reviewed and committed, and may be hand-edited for RLS policies, triggers, and grants. **Forward-only**: never edit a migration that has been merged; add a new one. Breaking changes go expand → migrate data → contract across at least two releases.
- Migrations run as `mustawfi_owner`. Grant `mustawfi_app` only the DML it needs — no `DELETE` on document and ledger tables.
- Every tenant-owned table has `tenant_id`, `branch_id`, `created_at`, `created_by`; `ENABLE` and `FORCE ROW LEVEL SECURITY`; and a policy `USING (tenant_id = current_setting('app.tenant_id', true)::uuid)` with the same `WITH CHECK`. The catalog test fails on a table missing `tenant_id`, `branch_id`, forced RLS, or the policy.
- Documents also carry non-negotiable 7's fields (currency, exchange rate, department, user, shift, device, template version) and a `business_date`; journal entries an `accounting_date`.
- Primary keys are UUIDv7 `uuid` columns generated through `packages/kernel`. Instants are `timestamptz` in UTC.
- Types: amounts `numeric(20,4)`, unit prices and costs `numeric(20,6)`, quantities `numeric(20,4)`, rates `numeric(20,6)`, percentages `numeric(9,4)`. Closed value sets are `text` + `CHECK`, not enums. `jsonb` only for custom fields and immutable payload snapshots.
- Posted rows are protected by triggers that refuse `UPDATE`; master data is archived (`archived_at`), never deleted.
- Names are `snake_case`, tables plural.
