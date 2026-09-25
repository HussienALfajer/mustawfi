# 0017. Set the RLS tenant context with SET LOCAL inside a per-request transaction, as a non-owner role, failing closed

- Status: Accepted
- Date: 2026-09-25

## Context

ADR-0004 makes row-level security the tenant-isolation boundary and leaves the mechanism for setting the tenant context to this phase. The mechanism must be safe with connection pooling, must fail closed when the context is missing, and must not be bypassable by ordinary application code.

## Decision

**Roles**

| Role | Used by | Rights |
|---|---|---|
| `mustawfi_owner` | migrations only | owns the schemas; never used by a running app |
| `mustawfi_app` | `apps/server`, jobs | DML on tenant tables; **no `BYPASSRLS`**, not an owner, no `DELETE` on documents and ledger |
| `mustawfi_admin` | `apps/admin-api` | the control-plane schema; tenant data only through `withTenant` (ADR-0028) |
| `mustawfi_portal` | `apps/portal-api` | `SELECT` on allowlisted portal views only (ADR-0012) |

No role used by a running app has `BYPASSRLS`.

**Context per request:** every database access runs inside `withTenant(ctx, fn)`, which opens a transaction and sets `app.tenant_id` (plus `app.user_id` and `app.device_id` for auditing) with `set_config(name, value, true)`, the transaction-local form of `SET LOCAL`. The context disappears at commit or rollback, so it cannot leak through a pooled connection; this is also safe behind PgBouncer in transaction mode. Only `core` exports a database handle, and only inside `withTenant`; the raw pool is not exported.

**Policies:** every tenant-owned table has `ENABLE` and `FORCE ROW LEVEL SECURITY` and a policy `USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)` with the same `WITH CHECK`. A missing or empty setting yields `NULL`, which matches no row and blocks every insert — the failure mode is "nothing", never "everything". In V1 the policies filter by tenant only; branch filtering joins them when multi-branch arrives.

**Checks in the test suite**

1. **Catalog test:** every table in a module schema has `tenant_id`, `branch_id`, RLS enabled and forced, and a policy.
2. **Isolation test:** two tenants with data in every table; every repository and endpoint running as tenant A never returns, modifies, or counts tenant B's rows.
3. A query without context returns zero rows, and an insert without context fails.

## Consequences

- A forgotten `WHERE tenant_id = …` in application code cannot leak data.
- Every request pays one extra round trip for `set_config`; negligible at this scale.
- Background jobs and admin operations must state their tenant explicitly; there is no "all tenants" query outside the control-plane schema.

## Amendments

- 2026-09-25 (walking-skeleton slice 4, accepted by the user on 2026-09-25): the policy wraps the setting in `nullif(…, '')`. Once a connection has run a transaction with `set_config(…, true)`, `current_setting('app.tenant_id', true)` returns an empty string instead of `NULL` after that transaction ends, so the original `current_setting(…)::uuid` raised `invalid input syntax for type uuid` on every reused pooled connection without a context — failing, but not with the "nothing" this ADR requires. Verified on PostgreSQL 18.6; the isolation test covers it.

## Alternatives considered

- **A PostgreSQL role per tenant** — apparently stronger, but does not scale to thousands of tenants and complicates pooling and migrations.
- **Session-level `SET`** — leaks across pooled connections if a reset is ever missed.
- **Application filtering only** — rejected by ADR-0004.
