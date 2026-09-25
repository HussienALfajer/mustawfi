# 0004. Isolate tenants with PostgreSQL row-level security; tenant_id and branch_id on every table

- Status: Accepted
- Date: 2026-09-25

## Context

All tenants share one database (ADR-0002). A single missing filter in application code must not expose one store's data to another. V1 is single-branch, but multi-branch is on the roadmap.

## Decision

Use PostgreSQL. Every tenant-owned table carries `tenant_id` and `branch_id`. Row-level security policies enforce tenant isolation at the database layer for every query. V1 tenants get one default branch that the UI hides. An automated isolation test is part of the test suite.

## Consequences

- Isolation holds even when application code is wrong.
- Multi-branch later is activation, not a schema migration.
- Every migration and query pattern must be RLS-aware; connection handling must set the tenant context reliably (mechanism chosen in Phase A2).
- A large tenant can move to a dedicated database or schema with the same code.

## Alternatives considered

- **Schema per tenant** — stronger separation, but migrations across many schemas get hard.
- **Database per tenant** — strongest isolation, highest cost; kept as an option for large tenants.
- **Application-level filtering only** — one bug away from a data leak.
