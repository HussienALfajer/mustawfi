# 0013. The super admin console is a separate application with strict controls

- Status: Accepted
- Date: 2026-09-25

## Context

Vertex System staff create tenants, sell plans, record payments, grant entitlements, and support customers. Whoever controls this console controls every customer's data.

## Decision

- A separate application from the tenant app, with mandatory 2FA and staff roles (owner, support, finance; resellers later, limited to their own tenants).
- It manages tenants (created from sector templates), plans and licenses (ADR-0008), invoices and payments, entitlements and limits (ADR-0009), devices, internal notes, and tenant data export.
- Support impersonation is read-only by default, logged, and visible to the tenant.
- Every admin action goes to an immutable audit log.
- Support staff don't see Vertex System's financial figures.

## Consequences

- A second frontend to build and secure; its initial version is needed before the beta.
- Tenant creation must be fully automated (templates for chart of accounts, roles, departments).

## Alternatives considered

- **Admin screens inside the tenant app** — a larger attack surface; mixes staff and customer concerns.
