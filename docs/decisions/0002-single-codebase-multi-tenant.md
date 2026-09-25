# 0002. One codebase for all customers; customization through configuration, never forks

- Status: Accepted
- Date: 2026-09-25

## Context

Customers will ask for custom behavior. Keeping a code copy or a server per customer makes every fix, feature, and security patch N times the work, and turns the company into a custom-development shop.

## Decision

Mustawfi is a multi-tenant SaaS built from a single codebase. Customer-specific needs are met by climbing the customization ladder (`docs/architecture/overview.md` §8): entitlements, settings, roles, custom fields, templates, add-on modules that live in this repository and are entitled per tenant, and later a public API. Requests that fit none of these, or that break core rules, are declined. A large customer may run on a dedicated database or server — always with the same code.

## Consequences

- One fix or feature reaches every tenant; support always knows what a tenant runs.
- The customization platform (ADR-0009) must exist early.
- Paid custom development becomes add-on modules with their own subscription.
- A request repeated by three tenants becomes a product feature.

## Alternatives considered

- **Code copy and server per customer** — unmaintainable past a few dozen customers; cost scales linearly.
- **Everything configurable** — becomes an inner platform: slow, buggy, unsupportable.
