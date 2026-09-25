# 0003. Build a modular monolith with enforced module boundaries

- Status: Accepted
- Date: 2026-09-25

## Context

Features must be switchable per tenant, and the system will grow for years. A single sale touches stock, cash, and the ledger and must be all-or-nothing. The team is small.

## Decision

One deployable application divided into modules. Each module declares a manifest (dependencies, permissions, settings schema, customizable entities, templates, published and subscribed events). Modules interact only through public interfaces and domain events handled inside the same database transaction. Boundaries are enforced by tooling. Disabling a module hides it and never drops its data.

## Consequences

- Cross-module financial changes stay ACID.
- Any module can later be extracted into a service, because its boundary is already explicit.
- Tooling must fail the build on boundary violations.
- The risk of many module combinations is contained by explicit dependencies, a few standard editions, and per-module tests.

## Alternatives considered

- **Microservices** — distributed transactions for every sale, heavy operations, harder offline sync; no benefit at this team size.
- **Unstructured monolith** — per-tenant module switching and long-term growth become impossible.
