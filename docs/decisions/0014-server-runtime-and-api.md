# 0014. Run the server on Node.js LTS with Fastify; REST + OpenAPI from shared Zod contracts

- Status: Accepted
- Date: 2026-09-25

## Context

The server is TypeScript (ADR-0010 chose TypeScript for the UI; one language lets domain rules, validation, and money math run on both server and offline clients). It hosts a modular monolith (ADR-0003) whose modules declare their own manifests, so the framework must not impose a competing module system. Later the product needs a public API and webhooks (ADR-0009) and already needs a public read-only API for the customer portal (ADR-0012), so the API style must not be TypeScript-only.

## Decision

- **Runtime:** Node.js active LTS (24 today), pinned in `.nvmrc`; moving to the next LTS is a deliberate change, not a drift. ESM only, TypeScript `strict`.
- **Framework:** Fastify 5. Each module registers its routes as an encapsulated Fastify plugin from its `server` entry; the module registry (`core.config`) decides what is mounted.
- **API style:** HTTP + JSON, resource-oriented REST under `/api/v1`. Sync has its own protocol (ADR-0020), mounted at `/api/v1/sync` (ADR-0020 amendment, accepted 2026-09-25).
- **Contracts and validation:** request and response schemas are **Zod** schemas in each module's `shared` entry, used on the server (via `fastify-type-provider-zod`), in client forms, and when validating local data. OpenAPI is generated from them; the client calls the API through a thin typed wrapper over the same schemas.
- **Errors:** RFC 9457 problem details with a stable machine code (`inventory.product.barcodeTaken`); the client turns the code into an Arabic message through i18n. A business refusal is a value with a code; an unexpected failure is a 500 that reaches error reporting.
- **Background work:** `pg-boss` (PostgreSQL-backed queue), enqueued inside the same transaction as the change that causes it. No Redis.
- **Configuration:** environment variables validated by a Zod schema at startup; the process refuses to start on invalid configuration.
- **Logging:** Pino (Fastify's logger), structured JSON (ADR-0027).

## Consequences

- One validation definition per contract serves server, client forms, and offline validation.
- The generated OpenAPI document makes the later public API an exposure decision, not a rewrite.
- Module plugins give each module its own route prefix, hooks, and error mapping without a framework-level module system.
- Everything that needs asynchronous work uses the database, so backups and transactions cover the queue too.

## Alternatives considered

- **NestJS** — its module/DI system duplicates the module manifests and ties every module to decorators.
- **Bun + Hono** — faster start-up, but less certain compatibility with the PostgreSQL and native tooling an accounting system depends on.
- **tRPC** — end-to-end types without generation, but TypeScript-only and a poor base for the public API and webhooks.
- **GraphQL** — field-level authorization and caching cost with no benefit for clients that read from a local database.
