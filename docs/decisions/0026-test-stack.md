# 0026. Test stack: Vitest, fast-check, Testcontainers PostgreSQL, a sync simulation harness, Playwright

- Status: Accepted
- Date: 2026-09-25

## Context

The definition of done requires tests for new behavior and for every invariant a change touches. The ledger must be property-tested (ADR-0006), isolation must be proven against the real database (ADR-0004, ADR-0017), sync must be proven under failure (ADR-0005), and launch gates include a 72-hour offline test and an isolation test (`v1-scope.md` §10). Tests run on Windows developer machines and on CI.

## Decision

| Layer | Tool | What it proves |
|---|---|---|
| Unit | **Vitest** (one workspace across packages) | Domain rules, components, adapters |
| Property-based | **fast-check** (with `@fast-check/vitest`) | Ledger balance over random operation sequences; money rounding, allocation, and reversal (ADR-0018); document numbering; model-based sync scenarios (`fc.commands`) |
| Integration | Vitest + **Testcontainers** running the pinned PostgreSQL 18 image, migrations applied, connected as `mustawfi_app` with RLS on | Repositories, posting transactions, RLS catalog and isolation tests (ADR-0017), migration upgrade tests (ADR-0016) |
| Sync simulation | **`packages/testing/sync-sim`** — many virtual devices, each running the real client sync code on the Node SQLite adapter against a real server and database, through a network that drops, duplicates, reorders, delays, and partitions, with a controllable clock and seeded randomness | No loss, no duplication, balanced ledger, converged stock and balances, after long outages and retries |
| End-to-end | **Playwright** against the web build (Chromium) | User journeys, including offline selling (`context.setOffline`), keyboard-only journeys, RTL screenshots in light and dark, and the 48px touch-target check |
| Design system | Vitest | Contrast of every token pair, token snapshot (ADR-0024) |
| Boundaries | dependency-cruiser + fixture tests | Each boundary rule fires on a known violation (ADR-0015) |

- Docker is required for integration tests, locally and in CI.
- A Tauri smoke test (`tauri-driver` on a Windows runner) joins once the desktop shell exists. Android is covered by a manual device checklist until the beta.
- No coverage percentage target. The rule is the definition of done: every invariant has a test that would fail if it broke.
- Test output is filtered for agents (failures and summaries only); full logs stay in CI artifacts.

## Consequences

- Isolation and ledger invariants are proven on the real PostgreSQL, never on a mock or an emulation.
- The sync harness is an engineering product of its own; it starts in the walking skeleton and matures in `core-sync`.

## Alternatives considered

- **Jest** — slower and awkward with ESM and Vite.
- **PGlite or mocked databases for integration** — RLS, roles, and pooling semantics must be proven on real PostgreSQL.
- **A shared CI Postgres service with docker-compose locally** — two setups that drift; Testcontainers gives one.
- **Cypress** — weaker multi-context and offline control than Playwright.

## Amendments

- 2026-09-25 (walking-skeleton slice 12, a layout detail): the generic harness is `packages/testing/src/sync-sim` (`@mustawfi/testing/sync-sim`), and the scenario that composes the real modules and server is `apps/server/sync-sim/`, because packages may not import modules (ADR-0015 rule 4).
