---
paths:
  - "core/tenancy/**"
  - "core/access/**"
  - "apps/server/**"
  - "apps/admin-api/**"
  - "apps/portal-api/**"
  - "core/*/src/server/**"
  - "modules/*/src/server/**"
  - "packages/testing/**"
---

# Tenant isolation rules

Sources: ADR-0002 (one codebase, multi-tenant), ADR-0004 (PostgreSQL RLS), ADR-0017 (RLS tenant context), ADR-0022 (authentication and devices), non-negotiables 1, 2, 3, 10.

- Every database access runs inside `withTenant(ctx, fn)`: one transaction, `set_config('app.tenant_id', …, true)` (plus `app.user_id`, `app.device_id`). Never set tenant context at session level and never query outside `withTenant`.
- Running apps connect as `mustawfi_app` (or `mustawfi_admin` / `mustawfi_portal`); none has `BYPASSRLS`. `mustawfi_owner` is for migrations only.
- A missing context must mean "nothing": zero rows returned, inserts refused. Never add a fallback that widens access.
- Do not filter by `tenant_id` in application code as a substitute for RLS; RLS is the guarantee, and the isolation test proves it. When adding a table, repository, or endpoint, extend the isolation test so tenant A cannot read, change, or count tenant B's rows.
- A module reads another module's data only through that module's public interface or events, never its tables (non-negotiable 2).
- Per-customer behavior comes from configuration, never from code branches on a tenant id (non-negotiable 1).
- Security-relevant actions (login, permission change, impersonation) are written to the append-only audit log with who, what, when, device, and before/after values.
