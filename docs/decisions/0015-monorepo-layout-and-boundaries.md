# 0015. pnpm + Turborepo monorepo; one package per module with shared/server/client entries; boundaries enforced by package exports and dependency-cruiser

- Status: Accepted
- Date: 2026-09-25

## Context

A module owns its tables, endpoints, screens, permissions, settings, templates, and events (ADR-0003). Some of its code runs on the server, some in the client, and some — validation, pricing, money math — on both, including offline. Boundaries must be enforced by tooling because they decay silently: code that reaches into another module compiles and passes tests.

## Decision

**Tooling:** pnpm workspaces, Turborepo for task orchestration and caching, exact dependency versions. Linting is ESLint (flat config, `typescript-eslint`) with project rules, formatting is Prettier. ESLint over Biome because the project rules below need ESLint's plugin ecosystem.

**Layout:**

```
apps/
  server/       tenant API, sync endpoints, jobs (Fastify host)
  admin-api/    admin console API, separate process (ADR-0028)
  portal-api/   customer-portal read-only API, separate process (ADR-0028)
  web/          the tenant client — the single UI codebase (React + Vite)
  desktop/      Tauri 2 shell around web (Windows)
  android/      Capacitor shell around web
  admin/        admin console frontend
  portal/       customer-portal pages
core/<name>/    core modules: tenancy, access, organization, currency, ledger,
                audit, sync, config, notifications, data
modules/<name>/ inventory, treasury, customers, sales, purchases, reports,
                serials, repairs, recharge, weighted, customer-portal
packages/
  kernel/       Decimal, Money, Quantity, ExchangeRate, ids (UUIDv7), Clock, Result
  ui/           design system on React Aria (ADR-0023, ADR-0024)
  i18n/         i18n runtime, Arabic formatting, digit settings
  local-db/     LocalDb interface and adapters (ADR-0019)
  testing/      test utilities, PostgreSQL fixtures, sync simulation harness
  config/       shared tsconfig, ESLint, Prettier presets
tools/          boundary checks and code generators
```

**A module is one workspace package** (`@mustawfi/core-ledger`, `@mustawfi/inventory`) with three public entries in its `exports` map:

| Entry | Runs on | May import |
|---|---|---|
| `./shared` | server and client | `packages/kernel`, other modules' `shared` |
| `./server` | server | its own `shared`, other modules' `shared` and `server` |
| `./client` | client | its own `shared`, other modules' `shared` and `client`, `packages/ui`, `packages/i18n`, `packages/local-db` |

**Enforced rules** (the build fails on violation; each rule has a fixture test proving it fires):

1. Deep imports into another package are impossible: `exports` exposes only the entries above.
2. A module imports only modules listed in its manifest `dependsOn` (checked against imports and `package.json`).
3. `client` never imports `server`; `shared` imports neither and has no platform APIs.
4. `packages/*` never import modules; modules never import `apps/*`.
5. A module's table definitions are not exported from any entry; its SQL touches only its own PostgreSQL schema (ADR-0016).
6. Project lint rules: no floating-point money (ADR-0018), no ambient clock (`Date.now()`, zero-argument `new Date()`) or ambient randomness (`Math.random`, `crypto.randomUUID`) in domain code, no physical-direction CSS utilities (ADR-0024), no hard-coded user-facing strings (ADR-0023).

Rules 1 and 4 come from package `exports`; rules 2, 3, and 5 from dependency-cruiser plus a manifest check in `tools/`.

## Consequences

- A module stays cohesive: its schema, endpoints, screens, and shared rules sit together, as `docs/architecture/overview.md` §2 describes.
- Apps are thin composition roots; a module can be dropped from an edition by not registering it.
- More `package.json` files to maintain; generators in `tools/` create new modules from a template.

## Alternatives considered

- **Nx** — built-in boundary tags, but heavier and more opinionated than the problem needs.
- **pnpm workspaces alone** — no build cache and no boundary checking; we would build both.
- **Separate server and client trees** — simpler at first, but every module is split in two places and shared rules need a third.
- **Biome instead of ESLint** — faster, but custom rules (money, clock, RTL, i18n) are far easier to write and test in ESLint.

## Amendments

- 2026-09-25 (walking-skeleton close, layout details): `packages/printing` exists (receipt template, rasterizer, ESC/POS, Windows spooler transport — ADR-0025); a module's `client` may not import it, so `apps/web` composes it with `sales/client`. `Result` is not in `packages/kernel`: refusals are thrown `ProblemError`s (see the walking-skeleton slice 5 notes). Rule 5 has no automated check yet: its enforcement is open (see the walking-skeleton spec).
