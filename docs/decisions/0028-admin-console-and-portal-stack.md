# 0028. The admin console and the customer portal each get their own API process and database role; the admin frontend reuses the client stack

- Status: Accepted
- Date: 2026-09-25

## Context

ADR-0013 makes the admin console a separate application with mandatory 2FA, staff roles, and an immutable audit log. ADR-0012 makes the customer portal a separate read-only public API. Both need a stack, and both must not weaken tenant isolation (ADR-0017).

## Decision

**Admin console**

- **Frontend (`apps/admin`):** React + Vite + TanStack Router and Query + `packages/ui` + i18n (Arabic), online only — no local database.
- **API (`apps/admin-api`):** a separate Fastify process on its own subdomain, behind an IP allowlist at the proxy, with mandatory TOTP (ADR-0022) and staff roles (owner, support, finance).
- **Data:** its own schema, `control_plane` — staff, plans, licenses, invoices, payments, admin audit log. This data is not tenant-owned, so access is controlled by staff roles instead of tenant RLS. The database role is `mustawfi_admin`.
- **Cross-tenant work** (create a tenant from a sector template, grant entitlements, issue a license, export data) calls the core modules' public interfaces inside `withTenant` for the target tenant. No role has `BYPASSRLS`.
- **Impersonation:** a read-only session flagged as support, audited, and visible to the tenant.
- License signing uses the control plane's own key (ADR-0021).

**Customer portal**

- **API (`apps/portal-api`):** a separate process whose database role `mustawfi_portal` may only `SELECT` from allowlisted views in a `public_portal` schema. Each view exposes only public fields, never cost or exact stock.
- Links carry signed, scoped, unguessable tokens (JWS). Rate limiting at the proxy and in the process. Per-page merchant switches.
- **Pages (`apps/portal`):** lightweight and mobile-first. Whether they are a prerendered SPA or server-rendered HTML is decided in the `customer-portal` spec session; the API boundary is fixed now.

## Consequences

- Compromising the portal process exposes only allowlisted public fields; compromising the admin frontend still requires an allowlisted IP and 2FA.
- Three server processes to deploy instead of one, all from the same monorepo and image pipeline (ADR-0027).
- Tenant creation automation lives in core modules and is reused by the admin API, not duplicated.

## Alternatives considered

- **Admin endpoints inside the tenant server** — rejected by ADR-0013's reasoning: larger attack surface, mixed concerns.
- **An admin role with `BYPASSRLS`** — simpler cross-tenant queries, but a single leaked credential would read every tenant.
- **Portal endpoints inside the tenant API** — shares a process and a role that can read everything.
