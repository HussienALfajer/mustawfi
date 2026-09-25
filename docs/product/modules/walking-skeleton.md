# Walking skeleton (`walking-skeleton`)

- Status: In progress
- Modules covered: thin slices of `core.tenancy`, `core.access`, `core.audit`, `core.config` (registry only), `core.ledger`, `core.sync`, `inventory`, `sales`; packages `kernel`, `ui`, `i18n`, `local-db`, `testing`
- Spec agreed with the user on: 2026-09-25 (Phase A2 architecture session)

## Purpose

Prove the chosen stack end to end, as thinly as possible: create a tenant → log in → create a product → sell it on a client while offline → sync → see the sale on the server with a balanced journal entry. Along the way, set up everything later units rely on: verification, CI, boundary enforcement, agent tooling, the kernel's money and identifiers, tenant isolation, the design-system foundation, and the local database.

## Scope (V1)

- Monorepo (ADR-0015), `pnpm verify`, GitHub Actions CI, boundary checks that fail the build.
- Agent tooling: a `verify` skill, hooks (formatting after edits, filtered test output), path-scoped rules for ledger, sync, tenancy, migrations, and RTL UI.
- `packages/kernel`: `Decimal`, `Money`, `Quantity`, `ExchangeRate`, UUIDv7, `Clock` (ADR-0018).
- PostgreSQL 18 foundation: roles, migrations, `withTenant`, RLS catalog and isolation tests (ADR-0016, ADR-0017).
- Server host with the module registry, contracts, problem-details errors; creating a tenant with its hidden default branch.
- Password login, opaque sessions, device registration with prefix and credential; login audit (ADR-0022).
- A minimal ledger (seeded accounts, balanced posting) and minimal products.
- Sync server: idempotent push, invoice ingest with posting, cursor pull (ADR-0020).
- Design tokens from the generator, contrast tests, a preview page approved by the user, `docs/design/design-system.md` (ADR-0024).
- The web client: RTL Arabic shell, login, products, a minimal POS that sells offline through the local database and outbox (ADR-0019, ADR-0023).
- The first version of the sync simulation harness (ADR-0026).
- The Windows desktop shell with native SQLite (ADR-0019), and a receipt-printing spike (ADR-0025).

## Out of scope

- Android shell and its native SQLite adapter → `core-sync` unit.
- Real permissions, roles, departments, shifts, cash boxes, multi-currency payments → `core-foundation`, `core-money`, `treasury`, `sales`.
- Licenses, configuration bundles, and signing (ADR-0021) → `core-foundation` and `core-config`. The skeleton's device works without a license check.
- PIN login, 2FA, device revoke → `core-foundation`.
- Production deployment, backups, restore drill, monitoring → `ops` unit (added to the roadmap before the closed beta).
- Admin console and portal apps → `admin`, `customer-portal`.

## Dependencies

None — this is the first code. ADR-0014 to ADR-0028 define the stack.

## Entities and data

Only what the path needs, each in its owning module's schema:

- `core_tenancy.tenants` (id, name, base currency), `core_tenancy.branches` (the hidden default branch).
- `core_tenancy.store_codes` (the sealed store-code directory, ADR-0029).
- `core_access.users` (password hash), `core_access.sessions` (token hash, expiry, revoked_at), `core_access.devices` (type, prefix, credential hash), `core_access.registration_codes`.
- `core_audit.entries` (append-only).
- `core_ledger.accounts` (seeded: cash, sales revenue, rounding differences), `core_ledger.journal_entries`, `core_ledger.journal_lines`.
- `inventory.products` (name, barcode, price with currency).
- `sales.invoices`, `sales.invoice_lines` — with every field of non-negotiable 7 (department, shift, and template version take fixed skeleton values).
- `core_sync.received_ops`, `core_sync.changes`, `core_sync.tenant_counters`.

## Business rules and invariants

1. Every tenant-owned table has `tenant_id`, `branch_id`, forced RLS, and a policy (catalog test).
2. No query returns or changes another tenant's rows; no query without tenant context returns rows (isolation test).
3. Every journal entry balances in the base currency; an unbalanced entry is refused (property test).
4. Posted invoices and journal entries cannot be updated or deleted by the application role (database test).
5. Pushing the same operation twice creates one invoice (idempotency test).
6. Money never passes through a JavaScript `number` (lint rule with a fixture test).
7. Document numbers are `{prefix}-INV-{seq:6}`, the prefix unique per tenant and never reused, the sequence gapless per device.

## Accounting impact

A cash sale posts: debit *cash*, credit *sales revenue*, and a *rounding differences* line when cash rounding applies — all in the base currency, with department and currency on each line. The skeleton uses a single currency (the tenant's base currency) and no cash-rounding step. Multi-currency posting belongs to `core-money`.

## Flows

1. Create a tenant (CLI command): tenant, default branch, owner user, seeded accounts.
2. The owner logs in on the web client (password).
3. The owner creates a product (online).
4. The owner registers the device with a registration code; the device receives its prefix and credential.
5. The device downloads products (pull), goes offline, and sells one product for cash: the invoice, its number, and its outbox entry commit in one local transaction.
6. The device comes back online and pushes; the server writes the invoice and its balanced journal entry.
7. The owner sees the sale and the journal entry on the server.

Desktop (Windows app and browser) only; no tablet or phone screens.

## Permissions

None beyond "authenticated owner". The permission model arrives in `core-foundation`.

## Offline and sync behavior

- Works offline: selling a product already synced to the device; the POS cart and the invoice are in the local database.
- Append-only: invoices (push).
- Server-authoritative: products (pull).
- Flagged after sync: negative stock (the skeleton records the flag; the accountant's review queue arrives later).

## Settings and customization points

None. The registry exists, but the skeleton defines no settings, custom fields, or templates beyond the receipt used in the printing spike.

## Edge cases

- The same push arrives twice (network retry) → one invoice; the second call returns `duplicate`.
- A push arrives with a gap in `deviceSeq` → processing stops at the gap, the device resends.
- The device sells more than the stock → the sale is accepted and flagged.
- The browser tab closes mid-sale → the cart is restored from the local database.

## Acceptance criteria

1. The full path (flows 1–7) runs as a Playwright end-to-end test in CI.
2. `AGENTS.md` → Commands lists the real build, test, lint, typecheck, and verify commands.
3. A `verify` skill, the hooks, and the path-scoped rules exist and are used by the slices after they land.
4. Every boundary rule of ADR-0015 fails the build on its fixture violation.
5. The RLS catalog test, the isolation test, and the ledger property test pass in CI.
6. The user approved the generated palette on the preview page.
7. The Windows desktop app sells offline through native SQLite, and a receipt printed from the spike is legible Arabic on a real printer.

## Verification plan

- Unit and property tests (Vitest, fast-check): kernel, ledger, numbering.
- Integration (Testcontainers PostgreSQL 18): migrations, RLS catalog and isolation, posting, push idempotency, pull ordering.
- Sync simulation harness v1: three devices, drops, duplicates, reordering, convergence.
- End-to-end (Playwright): keyboard-only login and product creation; the offline sale path.
- Manual, with the results recorded in the slice: the Windows app offline sale; a printed receipt on one real thermal printer.

## Slices

| # | Slice | Done when (3–5 checks) | Effort | Depends on | Status |
|---|---|---|---|---|---|
| 1 | Monorepo and verification pipeline | `pnpm verify` (build, format check, lint, typecheck, test) passes on a clean checkout; the GitHub Actions workflow runs it on pull requests and passes; `pnpm check:boundaries` fails on fixture violations of ADR-0015 rules 1–4; `AGENTS.md` Commands lists the real commands | medium | — | Done 2026-09-25 — see deviations below |
| 2 | Agent tooling | A `verify` skill runs `pnpm verify` with filtered output; a hook formats edited files; a hook or wrapper filters test output to failures and summaries; path-scoped rules exist for ledger, sync, tenancy, migrations, and RTL UI, each citing its ADRs | medium | 1 | Done 2026-09-25 — see deviations below |
| 3 | Kernel: exact money and identifiers | `Decimal`/`Money`/`Quantity`/`ExchangeRate` round only through named, mode-explicit functions (half away from zero); property tests prove exact allocation, mirrored reversals, and bounded conversion residuals; UUIDv7 and an injectable `Clock`; lint rules ban float money, ambient clock, and ambient randomness in domain code, each with a fixture test | high | 1 | Done 2026-09-25 — see deviations below |
| 4 | Database foundation and tenant isolation | Tests start PostgreSQL 18 through Testcontainers and apply migrations as `mustawfi_owner`; the app connects as `mustawfi_app` and every access goes through `withTenant`; the catalog test fails on a fixture table without forced RLS; the isolation test proves tenant A cannot read, change, or count tenant B's rows, and that no context returns zero rows and blocks inserts | high | 3 | Done 2026-09-25 — see deviations below |
| 5 | Server host, module registry, tenancy | Fastify mounts modules from the registry, and the registry refuses to start with an undeclared or disabled dependency (test); OpenAPI is generated from the Zod contracts; errors are problem details with stable codes; a CLI command creates a tenant with its hidden default branch, base currency, and owner (integration test) | medium | 4 | Done 2026-09-25 — see deviations below |
| 6 | Access: login, sessions, devices | Password login (Argon2id) returns an opaque session whose hash alone is stored; a revoked session is refused on the next request; registration codes are single-use and expire; a registered device gets a credential and a prefix unique per tenant and never reused (test); logins, and tenant and owner creation (left over from slice 5), are written to an append-only audit log | high | 5 | Done 2026-09-25 — see deviations below |
| 7 | Minimal ledger and products | Account seeding per tenant (cash, sales revenue, rounding differences); `postJournalEntry` refuses unbalanced entries; a property test of random posting sequences keeps debits equal to credits; the app role cannot update or delete posted entries (database test); product create and list endpoints under RLS | high | 5 | Done 2026-09-25 — see deviations below |
| 8 | Sync server: push, ingest, pull | Pushing the same `opId` twice yields one invoice and a `duplicate` result; a `deviceSeq` gap stops processing at the gap; ingesting `sales.invoice.post` writes the invoice and its balanced journal entry in one transaction; a negative-stock sale is accepted and flagged; pull returns product changes in commit order with a resumable cursor | high | 6, 7 | Done 2026-09-25 — see deviations below |
| 9 | Design tokens and preview | The generator reproduces ADR-0024's "Ink and paper" anchors and emits light and dark token CSS; the contrast test covers every pair with zero exceptions and fails on a fixture pair; a preview page shows palette, type scale, densities, `Money`, and the double-rule total; the user approved the full ramps and the dark theme; `docs/design/design-system.md` is written | medium | 1 | Done 2026-09-25 — see deviations below |
| 10 | Client shell: login and products | The web app renders RTL Arabic through i18n, and the string-literal and physical-direction lint rules fire on fixtures; `Button`, `TextInput`, `Money`, `MoneyInput`, and `DataTable` exist in `packages/ui` on React Aria; the login and product screens work against the API; a keyboard-only Playwright journey (log in, create a product) passes | medium | 6, 7, 9 | Done 2026-09-25 — see deviations below |
| 11 | Local database, offline sale, sync client | The `LocalDb` contract suite passes on the Node and WASM adapters; the POS screen sells offline, committing the invoice, `{prefix}-INV-000001`, and the outbox entry in one local transaction; the sync loop pushes and pulls, and a status indicator shows pending operations; the end-to-end Playwright test of flows 1–7 passes in CI | high | 8, 10 | Done 2026-09-25 — see deviations below |
| 12 | Sync simulation harness v1 | The harness runs three virtual devices on the Node adapter against a real server and database; the network drops, duplicates, and reorders requests from a seed; after convergence there are no lost or duplicate invoices and the ledger balances; it runs in CI within a time budget | high | 11 | Not started |
| 13 | Windows desktop shell | The Tauri spike chooses the SQLite binding (recorded in ADR-0019's consequences); the native adapter passes the `LocalDb` contract suite, including multi-statement transactions, with WAL and `synchronous = FULL`; an offline sale works in the packaged app (manual check recorded); a CI job on a Windows runner builds the installer | high | 11 | Not started |
| 14 | Receipt printing spike | A LiquidJS receipt template renders to a 576-dot raster with the bundled Arabic font; ESC/POS bytes are produced with the encoder, including cut and drawer kick; printed through the Windows spooler in RAW mode on one real printer, legible (photo recorded); receipt-to-printer time is measured on reference hardware, and the chosen rasterizer is recorded in ADR-0025 | medium | 13 | Not started |

### Slice notes and deviations

- **Slice 1 (2026-09-25).**
  - TypeScript is pinned to 6.0.x, not 7.x: `typescript-eslint` 8.70 supports `typescript <6.1`. Move to 7 when it does.
  - A module's `dependsOn` lives in its `package.json` as `mustawfi.dependsOn` (module ids) so the boundary check reads it statically; slice 5's `defineModule` manifest must match it (add that check there).
  - Beyond rules 1–4, the checker enforces ADR-0015's entry table: `shared` imports only `packages/kernel` among packages, `server` does not import `packages/ui`, `i18n`, or `local-db`, and `server` never imports `client`. Browser and Node globals under `src/shared/` are an ESLint error.
  - `pnpm build` has no build tasks yet; the first come with the apps (slices 5 and 10).
  - Prettier skips Markdown so docs tables and Arabic prose are not reflowed.
  - Dependencies respect pnpm's minimum release age (turbo pinned to 2.11.3; 2.11.4 was under a day old). No policy exclusions.
- **Slice 2 (2026-09-25).**
  - The tooling lives in `tools/agent` (`@mustawfi/tools-agent`): `pnpm verify:agent` runs the same steps as `pnpm verify` and prints only failures and summaries; a test keeps its step list equal to the root `verify` script.
  - Test output is filtered by a wrapper, not a hook: `pnpm test:agent` and the verify runner use Vitest's `minimal` reporter explicitly (Vitest 5 also picks it by itself when it detects an agent).
  - The format hook is a `PostToolUse` hook on `Edit|Write|MultiEdit` that runs Prettier on the edited file through its API, honouring `.gitignore` and `.prettierignore` like the CLI; it never blocks the agent.
  - Path-scoped rules are Claude Code rules in `.claude/rules/`. Their globs cover directories that do not exist yet (for example `**/migrations/**`); slice 4 decides where migrations live and should adjust `migrations.md` if needed. `agent-setup.test.ts` checks that each rule has `paths` and cites only existing ADRs, and that hook scripts and skill commands exist.
- **Slice 3 (2026-09-25).**
  - `packages/kernel` (`@mustawfi/kernel`) exports `Decimal`, `Currency`, `Money`, `Quantity`, `ExchangeRate`, `Clock` (`systemClock`, `manualClock`), `RandomSource` (`cryptoRandom`, `seededRandom`), and `uuidV7Generator`. `RandomSource` is an addition: ids — and session tokens from slice 6 — take their randomness from it, so tests and the sync harness can seed it. `Result` (in ADR-0015's layout) is not built; no slice has needed it yet.
  - `Decimal` takes only canonical strings or bigints and throws on any non-string coercion (`+d`, `d == 1.5`). It wraps decimal.js at 1000 significant digits and refuses, before computing, any sum or product that could exceed them, so arithmetic never rounds silently. Division exists only as `dividedBy(divisor, scale, mode)`. Modes: `halfAwayFromZero`, `towardZero`, `floor`, `ceiling`.
  - `Money` carries a `Currency` (code + minor units, 0–4); the kernel holds no currency data, callers build `Currency` from `core.currency`. Named rounding points: `roundToMinorUnit`, `roundToIncrement` (cash step, at least one minor unit), `allocate` (largest remainder, ties to the earlier part), and `ExchangeRate.convert`. The posting residual line (named point 4) belongs to slice 7; the property test for its bound (half a minor unit per conversion) is here.
  - Zod schemas for decimal strings on the wire are left to slice 5 (contracts).
  - The lint rules are a project ESLint plugin (`packages/config/eslint-plugin.js`): `no-float-money`, `no-ambient-clock`, `no-ambient-randomness`, applied to `core/*/src`, `modules/*/src`, and `packages/kernel/src`, tests included. Exemptions: `kernel/src/decimal.ts` may import decimal.js, `clock.ts` may read the clock, `random.ts` may read Web Crypto. Apps are composition roots and are not covered. `no-float-money` bans what ADR-0018 lists plus `Number.parseFloat`, `new Number`, `toPrecision`, and importing a decimal library outside the kernel; it does not flag unary `+`, `parseInt`, or `Math.floor`/`Math.ceil`.
  - Property tests generate exact ties on purpose: random decimals almost never land on one, and without them the rounding properties passed with banker's rounding swapped in (checked by mutation).

- **Slice 4 (2026-09-25).**
  - Layout: `withTenant` lives in `core/tenancy` (`@mustawfi/core-tenancy/server`), the root module every other module depends on. `openTenantDatabase` keeps the pool inside, exposes only `withTenant` and `close`, validates ids as lowercase UUIDs, and refuses a role that is (or is a member of) a superuser or `BYPASSRLS` role, or that owns a schema.
  - A new boundary rule, `database-through-tenancy`, fails the build when module code outside `core/tenancy/src/server/` (tests excepted) imports `pg`, `postgres`, PGlite, or a Drizzle PostgreSQL driver adapter; fixture tests prove it. To see npm imports, the boundary check no longer excludes `node_modules` (it stays unfollowed).
  - **ADR-0017 amended (accepted by the user 2026-09-25):** the policy is `tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid`. After a transaction-local `set_config`, a pooled connection returns `''`, not `NULL`, so the ADR's original expression raised a uuid cast error without a context instead of returning zero rows (verified on 18.6; the catalog test flags the old form).
  - Migrations: each module keeps drizzle-kit output in `<module>/migrations/`; `apps/server/src/db/migrate.ts` applies sets in the given (dependency) order as `mustawfi_owner`, one transaction per migration, under an advisory lock, records them in `mustawfi_migrations.applied`, and refuses a superuser, an edited applied migration (sha256 over LF-normalized text), or a removed or reordered one. The runner is our own, not Drizzle's migrator, for those checks. `apps/server/src/db/migration-sets.ts` is empty until `core.tenancy` gets tables in slice 5; the module registry takes it over. A `db:migrate` command for deployment is left to slice 5 / `ops`.
  - No real tenant tables exist yet (they start in slice 5). The catalog and isolation tests run over every table in the migrated database plus a fixture table (`rls_fixture.items`, generated with drizzle-kit); the isolation test fails for any catalog table without a registered seed, so new tables join automatically. Mutation checks: `USING (true)`, `WITH CHECK (true)`, and the unamended ADR policy each fail it.
  - `packages/testing` (`@mustawfi/testing`): a Vitest global setup starts `postgres:18.6-alpine` through Testcontainers and creates the roles; `createTestDatabase` gives each test file its own database; `inspectRlsCatalog` and `assertTenantIsolation` are generic. Role creation for production belongs to `ops`. `mustawfi_admin` and `mustawfi_portal` arrive with their apps.
  - `drizzle-kit` sits in its own package, `tools/drizzle`: installed next to Vitest, its esbuild and tsx peers split Vitest into two peer variants and broke `@fast-check/vitest`. pnpm 12 requires a decision on build scripts: `cpu-features`, `esbuild`, `protobufjs`, and `ssh2` are denied in `pnpm-workspace.yaml` (all have fallbacks or are checks only).
  - vite's optional peers (esbuild, tsx, yaml) had still split Vitest into three installs in the lockfile, which failed CI only (a clean install). `pnpm dedupe` merged them, and `tools/agent/src/lockfile.test.ts` now fails when Vitest resolves to more than one install.
- **Slice 5 (2026-09-25).**
  - `core.config` (`@mustawfi/core-config`) is the root module: `defineModule`, `createModuleRegistry` (refuses a module registered twice, an unregistered dependency, a cycle, or an enabled module whose dependency is disabled; orders dependencies first; migrates disabled modules too), `ProblemError`, and the problem-details schema in its `shared` entry. `core.tenancy` now depends on `core.config`. Risk: when `core.config` gains tables (settings, entitlements) it needs `withTenant` from `core.tenancy`, a cycle; the host should then hand the database to modules through the registry context instead of an import.
  - The manifest ↔ `package.json` match is a test (`apps/server/src/modules.test.ts`): every module under `core/` and `modules/` must be registered in `apps/server/src/modules.ts` with the same id and `dependsOn`. It is not a `tools/boundaries` rule.
  - Routes mount under `/api/v1/<id without "core.">`; OpenAPI 3.1 is served at `/api/v1/openapi.json` (`@fastify/swagger` + `fastify-type-provider-zod` 7); `/api/v1/health` exists. Host codes: `core.request.invalid` (with field paths), `core.request.rejected` (other 4xx), `core.route.notFound`, `core.server.internal` (500, nothing revealed).
  - A minimal `core.access` arrived here because the CLI creates the owner: `core_access.users` (login unique per tenant, Argon2id PHC hash at `@node-rs/argon2` defaults, `is_owner`), `hashPassword`, `createOwner`. Slice 6 adds login, sessions, and devices, and must decide how a login finds its tenant under RLS (users are visible only inside a tenant context).
  - `core_tenancy.tenants` has `tenant_id = id` and `branch_id` = the default branch (deferred FK); `branches` has `branch_id = id` and one `is_default` per tenant. No `DELETE` grant on either (master data). `createTenant` and `currentTenant` are the public interface.
  - `pnpm --filter @mustawfi/server tenant:create` (password on stdin, `DATABASE_URL` as `mustawfi_app`) runs the whole creation in one `withTenant` for the new tenant, under RLS. `db:migrate` (`DATABASE_OWNER_URL`) and `start` exist; the server runs its TypeScript directly on Node 24, so there is still no build step.
  - A business refusal is a thrown `ProblemError` that the host turns into problem details, not a returned value as ADR-0014 words it: no `Result` type exists yet (slice 3), and throwing keeps Fastify handlers plain. Revisit if `Result` lands.
  - Not done here: tenant creation is not audited yet (slice 6 brings the audit log and should audit it too); seeded accounts join in slice 7; Zod decimal-string schemas wait for the first money on the wire (slice 7).
  - The isolation test's seeds now name the tables they write and use the modules' own functions. Each tenant is seeded once (a tenant has one `tenants` row), with a second fixture row for A.

- **Slice 6 (2026-09-25).**
  - **Tenant at sign-in — ADR-0029 (accepted by the user on 2026-09-25).** Each tenant gets a six-symbol store code (unambiguous alphabet, random, unique, never changed). Sign-in is store code + login + password; device registration is store code + registration code. `core_tenancy.store_codes` is sealed (no privilege for `mustawfi_app`), filled by a `SECURITY DEFINER` trigger and read only through `core_tenancy.tenant_for_store_code(code)`, called by `TenantDatabase.resolveStoreCode`. The RLS catalog check now reports tables the app role cannot reach as `sealed` and lists the definer functions it can run; the catalog test pins both lists. `tenant:create` prints the store code.
  - Session tokens and device credentials are `s1.|d1.{tenantId}.{256-bit base64url}`; the SHA-256 of the whole token is stored. The tenant id routes the lookup under RLS (ADR-0029).
  - `core.audit` is a new module that depends on `core.config` and `core.tenancy`, and `core.access` depends on it — the reverse of `v1-scope.md`'s table, which is updated: access must write sign-in entries, and an audit entry keeps the actor as a plain id, so the log needs nothing from access. `core_audit.entries` is append-only: `mustawfi_app` has `SELECT, INSERT` only, and triggers refuse `UPDATE`, `DELETE`, and `TRUNCATE` for every role, the owner and superusers included. `created_by` is null only for a failed sign-in naming an unknown login.
  - Audited: `tenancy.tenant.created`, `access.user.created`, `access.login.succeeded`, `access.login.failed` (within a known store), `access.session.revoked`, `access.registrationCode.issued`, `access.device.registered`. A failed registration is not audited (its transaction rolls back); a sign-in with an unknown store code cannot be (no tenant).
  - Routes under `/api/v1/access`: `POST /login`, `POST /logout`, `GET /session`, `POST /registration-codes` (owner only), `POST /devices`, `GET /devices/current` (device credential). Other modules call `requireSession(request, context)`. Every failure of a kind gets one code (`access.login.failed`, `access.session.required`, `access.registration.failed`, `access.device.required`); unknown store and unknown login verify against a dummy hash so timing does not tell them apart.
  - Sessions last seven days from sign-in (a setting later); registration codes fifteen minutes. Tokens travel only as `Authorization: Bearer`; the browser's `HttpOnly` cookie and Origin check (ADR-0022) arrive with the web client in slice 10.
  - Device prefixes: chosen at random among the tenant's free ones (1024 in all) under a per-tenant advisory lock; the app role has no `DELETE` or `UPDATE` on devices, so a prefix is never freed; `(tenant_id, prefix)` is unique; `access.device.prefixesExhausted` (409) when all are taken. A device registers once per code (`registration_code_id` unique). `mustawfi_app` may update only `registration_codes.used_at` and `sessions.revoked_at`/`revoked_by`.
  - Kernel gains `randomCode`, `randomIndex`, and `UNAMBIGUOUS_ALPHABET`. `HostContext` gains `random`.
  - Not done here, left to `core-foundation`: login rate limiting (ADR-0022), device revoke, PIN, 2FA, sessions opened on a registered device (`sessions.device_id` stays null).
  - The `store_code` column is added `NOT NULL` without a backfill: no database with tenants exists outside tests yet.

- **Slice 7 (2026-09-25).**
  - `core.ledger` (`@mustawfi/core-ledger`) depends on `core.config` and `core.tenancy` only: `core.currency` and `core.organization` do not exist yet. Public interface: `seedAccounts`, `systemAccounts` (accounts by role: `cash`, `salesRevenue`, `roundingDifferences`), `postJournalEntry`, and the pure `balancedTotal`. Seeded chart: 1100 cash (asset), 4100 sales revenue (revenue), 5900 rounding differences (expense), with Arabic names as tenant data. `createTenantWithOwner` seeds them in the tenant's transaction and audits `ledger.accounts.seeded`.
  - Every entry is posted when written; there is no draft state. Lines hold a positive `debit` or `credit` (`numeric(20,4)`) in the base currency, with their `currency` and `department_id`. The skeleton refuses any line not in the tenant's base currency; multi-currency posting and the original-currency amount belong to `core-money`. `department_id` has no foreign key until `core.organization` exists; slice 8 picks the skeleton's fixed department.
  - Refusals are `ProblemError`s (422): `ledger.entry.unbalanced`, and `ledger.entry.invalid` (fewer than two lines; a zero, negative, or sub-minor-unit amount; another currency; an unknown account; a malformed date or source type). Slice 8 must not post a zero-total invoice (a zero line is refused).
  - Defense in depth in the database: deferred constraint triggers refuse at commit an entry with fewer than two lines or unequal debits and credits, however it was written; a trigger refuses a line on an entry written in an earlier transaction (so a balanced pair cannot be appended to a posted entry; it compares the entry's `xmin` with the top-level transaction, so entries must not be posted inside a savepoint); tenant-scoped composite foreign keys keep a line on its own tenant's entry and accounts; triggers refuse `UPDATE`, `DELETE`, and `TRUNCATE` of entries and lines for every role, superusers included. `mustawfi_app` has `SELECT, INSERT` on the three tables. Mutation checks (TS balance check off; DB balance triggers off; immutability triggers off) each fail the tests.
  - `inventory` (`@mustawfi/inventory`, the first module under `modules/`) depends on `core.access`, `core.audit`, `core.config`, `core.tenancy`. `inventory.products`: name, one optional barcode unique per tenant, `price numeric(20,6)` ≥ 0 with `price_currency`. `POST /api/v1/inventory/products` (owner only; 409 `inventory.product.barcodeTaken`; audited `inventory.product.created`) and `GET /api/v1/inventory/products?limit=&after=` (keyset pages by id). No editing or archiving yet, so no `UPDATE` grant. Product writes do not append to `core_sync.changes` yet: slice 8 adds that for pull.
  - The kernel gains `decimalString`, the Zod schema for decimals on the wire (canonical text, the column's scale and integer digits, sign); zod is now a kernel dependency.
  - The 403 path of product creation is untested: every user is an owner until `core-foundation`.

- **Slice 8 (2026-09-25).**
  - `core.sync` (`@mustawfi/core-sync`) depends on `core.access`, `core.config`, `core.tenancy`. Tables `received_ops` (keyed by `opId`, unique `(tenant, device, deviceSeq)`, payload snapshot, stored result or rejection), `changes` (unique `(tenant, seq)`, full-row snapshot or `null` tombstone), `tenant_counters`. `received_ops` and `changes` are append-only (grants plus triggers for every role); the app may update only `tenant_counters.change_seq`.
  - **Routes are `POST /api/v1/sync/push` and `GET /api/v1/sync/pull`**, not ADR-0020's `/sync/v1/…`: the registry mounts every module under `/api/v1/<module>`, so the API version stands for the protocol version for now. Both authenticate with the device credential (`requireDevice`, new in `core.access`); each operation's user must be a user of the device's store (`isTenantUser`) or it is rejected `sync.operation.unknownUser`.
  - Push: operations sorted by `deviceSeq`, each in its own `withTenant` transaction under a per-device advisory lock. Answers: `accepted`, `duplicate` (with the stored result), or `rejected` with a code; a repeated rejected operation gets its stored rejection again. A handler rejection rolls the operation back and stores the rejection in a second transaction. A gap stops processing; the answer carries `nextDeviceSeq` and `gap: true`. A new operation on a `deviceSeq` already held is answered `sync.operation.seqTaken` and not stored. Any other failure stores nothing (500), so the device retries.
  - **Handlers are composed by the host, not declared in the manifest**: modules export `SyncOperationDefinition`s (`salesSyncOperations`), and `apps/server/src/modules.ts` builds `HostContext.syncOperations` from the enabled modules (`hostSyncOperations`); a disabled module's operations are rejected `sync.operation.unsupportedType`. `core.config`'s manifest cannot name a tenant transaction without a cycle; revisit when the manifest gains events. Likewise, which entities sync down, and to which scope, is not declared in a manifest (ADR-0020): `inventory` calls `recordChange` itself.
  - Pull: `recordChange` numbers changes through the tenant's counter row (upsert, locked until commit); pages are `{ changes, cursor, more }` in `seq` order. **No per-device scope filter yet** (every device gets every change); `inventory.product` is the only entity, written by `createProduct`. No compaction or bootstrap snapshot yet (`core-sync` unit).
  - `sales` (`@mustawfi/sales`) depends on `core.access` (device FK), `core.audit`, `core.config`, `core.ledger`, `core.sync`, `core.tenancy`, `inventory`. `sales.invoice.post` v1 writes `invoices` (non-negotiable 7 fields, `business_date`, `sold_at` from the operation's device time, `op_id`, `doc_seq`), `invoice_lines` (device-generated ids), `invoice_flags`, the stock movements, an audit entry `sales.invoice.created`, and the journal entry (debit cash, credit sales revenue, the invoice's department, accounting date = business date) in the operation's transaction. A zero-total invoice posts no entry. Invoices, lines, and flags are immutable (grants and triggers), and a line cannot join an invoice written earlier (the ledger's `xmin` check).
  - Flags: `negativeStock` (stock went below zero) and `arithmeticMismatch` (a line differs from quantity × price rounded half away from zero, or the lines do not add up to the total; the entry posts the total). Rejections: `sales.invoice.invalid` (malformed payload, a total finer than the minor unit, repeated line ids), `numberMismatch` (not canonical `{prefix}-INV-{seq:6}` with the device's prefix), `unsupportedCurrency` (not the base currency at rate 1), `unknownProduct`, `duplicate` (invoice id, number, or line id already recorded).
  - The skeleton's fixed department, shift, and template version are `SKELETON_DOCUMENT_DEFAULTS` in `sales/shared`; the server records whatever the device sends. Minor units come from a two-entry table in `sales` (SYP 2, USD 2) until `core.currency`. Number gaps per device are not audited yet.
  - `inventory` gains `stock_levels` (updated in product-id order, may go negative) and append-only `stock_movements`, `moveStock` and `knownProducts`, and a `(tenant_id, id)` key on products for tenant-scoped foreign keys. Quantities are `Decimal` (products have no unit yet). There is no stock-receiving route: tests put stock on hand through `moveStock`. `inventory` now depends on `core.sync`.
  - Tests: `apps/server/src/sync.test.ts` (idempotency, including concurrent pushes; the per-device lock, proven with a fixture operation that holds its transaction; gaps; flags; one-transaction ingest by removing the cash account mid-operation; rejections; pull order and resumption; a change committing late is never skipped; immutability). Mutation checks: without the device lock and with an unlocked `max(seq)+1` counter, a test fails each time. Slice 11 needs a read endpoint for flow 7 ("the owner sees the sale").
  - Open for `core-sync` and slice 11: `unsupportedType` and `unsupportedVersion` are stored as permanent rejections, so an operation pushed to an older server (or while `sales` is disabled) needs a resend under a new `opId`; `received_ops.id` and the invoice keys are global, so an `opId` another tenant holds fails as a 500 (reachable only by collision or a forged id); the push size bound is Fastify's default body limit; an operation's user is checked against the store, not against a sign-in on the device (`core-foundation`); with no stock-receiving route, every end-to-end sale will carry `negativeStock`.
- **Slice 9 (2026-09-25).**
  - `packages/ui` (`@mustawfi/ui`) holds the generator in `src/tokens/`: our own OKLCH and WCAG code (no colour library), ramps 50–950 per anchor family (`ink`, `graphite`, `ledger`, `brass`, `green`, `red`, `amber`, `teal`), anchors pinned exactly, other steps generated. Paper `#F7F7F5` and white are fixed primitives outside the ramps (pinning paper into the cool graphite ramp tinted its light steps green). Info has no ADR anchor: a teal seed OKLCH(0.50 0.085 200). The dark accent comes out as ink 400 `#90B2D3` (ADR: around `#8DB3D9`; a test bounds the distance).
  - `src/styles/tokens.css` is generated by `pnpm --filter @mustawfi/ui tokens:generate`, committed, excluded from Prettier, and a test fails when it differs from the generator. The preview page is generated to `packages/ui/preview/` (git- and Prettier-ignored); `--hosted` writes a copy with Google Fonts for review outside the repo. Fonts are the `@fontsource` IBM Plex packages 5.3.0.
  - **Approved by the user on 2026-09-25** (preview published as a claude.ai artifact): the full ramps and the dark theme as generated; sunken rows use ledger 50 `#FBF9F5`, not the `#F0EBE3` anchor (muted text 4.14:1 and field border 2.71:1 on it); muted text never on status tints (4.39:1 on the anchored positive tint); the field border is measured only against the field's `surface` background (2.998:1 against paper).
  - The contrast pairs (`CONTRAST_PAIRS`, 59 per theme) are also the usage rules, listed in `docs/design/design-system.md`; every semantic token is in a pair unless declared decorative (`divider`, `signature`). Fixture checks: a text pair using the field border, and a drifted muted value, each fail.
  - The 48 px touch target is checked on the density tokens only; slice 10 checks rendered components. The Tailwind `@theme` mapping, digit shapes, and currency display names are left to slice 10.
- **Slice 10 (2026-09-25).**
  - `packages/i18n` (`@mustawfi/i18n`): `createI18n` (i18next + `i18next-icu`, Arabic only, no fallback language, ICU formatting in `ar-SY-u-nu-latn`), `formatDecimal` (`Intl.NumberFormat` reading canonical decimal *strings*, exact, never rounding; Intl puts an LRM before a minus sign), `parseDecimalInput` (Western and Arabic-Indic digits, `٫`, grouping marks only between groups of three — `12,5` is refused, not read as 125), `DigitShapeContext` (Western by default; the per-user setting comes later). `intl-messageformat` is pinned to 11.x: `i18next-icu` 2.4 declares `<12`.
  - `packages/ui` components on React Aria: `Button`, `TextInput`, `Money`, `MoneyInput` (+ `readMoneyInput`), `DataTable`, `LocaleProvider` (React Aria's `I18nProvider` at `ar-SY`, so arrow keys follow RTL). They have their own `ui` namespace. **Currency display names: SYP «ل.س», USD «$»**, any other currency shows its ISO code. `MoneyInput` takes text and gives exact `Money` through `readMoneyInput`; it offers the currency as a radio group when there is more than one. `DataTable` is minimal: no virtualization, totals row, or entry mode yet.
  - Tailwind v4 theme: `generateTailwindThemeCss` writes `packages/ui/src/styles/theme.css` (committed, test-checked like `tokens.css`). It clears Tailwind's colours, fonts, sizes, radii, and shadows, so only semantic and component tokens exist as utilities (`bg-surface`, `text-text-muted`, `border-field-border`, `h-control`, `px-pad-inline`, `gap-density-gap`, `text-density`).
  - Lint rules `no-physical-direction` and `no-literal-string` in the project ESLint plugin cover `apps/web/src`, `packages/ui/src/components`, and module `src/client` (tests excepted), with fixture tests. `no-physical-direction` flags physical Tailwind utilities, and bare `"left"`/`"right"` values, in any string, and physical keys inside JSX `style`. It does not lint `.css` files. `no-float-money` now also covers `packages/ui/src/components` and `packages/i18n`.
  - Module client entries: `core.config/client` (`apiRequest`, `ApiProblem`, `ApiUnreachable`), `core.access/client` (`LoginScreen`, session query, `SignOutButton`), `inventory/client` (`ProductsScreen`, which reads the API online; the local database comes in slice 11). Module packages now compile with DOM types and JSX in one tsconfig, server code included. Price currencies (SYP, USD, two minor units) are a list in `inventory/client` until `core.currency` exists. The new product's currency defaults to SYP, not the tenant's base currency, because the session does not carry the base currency.
  - **Browser sessions (ADR-0022, left over from slice 6):** `POST /login` takes `transport: "bearer" | "cookie"` (default `bearer`). `cookie` sets `mustawfi_session` (`HttpOnly; Secure; SameSite=Lax; Path=/api`, expiring with the session) and leaves the token out of the body. `requireSession` reads the bearer header first, then the cookie. When the cookie authenticates a change (any method but GET/HEAD/OPTIONS), and also for a cookie sign-in, `Origin` must match the request's `Host`; otherwise the answer is 403 `access.request.crossOrigin`. The web app and the API share one origin (Vite proxies `/api` and keeps the Host header). A production reverse proxy must forward `Host` (`ops`). Logout clears the cookie. A 401 on any query or mutation clears the cache and returns to sign-in.
  - `apps/web`: React 19, Vite 8, TanStack Router (code-based routes with a session guard) and Query, React Hook Form + Zod, Tailwind v4. The bundle is 811 kB in one chunk; routes are not lazy-loaded yet.
  - `pnpm test:e2e` (Playwright, Chromium) is a step of `pnpm verify` and CI. The global setup starts PostgreSQL 18 through Testcontainers, runs `db:migrate` and `tenant:create`, and starts the server as `mustawfi_app`. The web app runs on `vite preview`. The journeys: the page is RTL Arabic; a wrong password is shown as an alert; the keyboard-only journey (sign in, add a product with an Arabic-Indic price in USD, see it listed, reload with the HttpOnly cookie, sign out); a session revoked elsewhere returns to sign-in; in `touch` density, rendered controls are at least 48×48 px (the component check left over from slice 9). `@mustawfi/testing` exports `./postgres-server`, so the setup can run without Vitest.
- **Slice 11 (2026-09-25).**
  - `packages/local-db` (`@mustawfi/local-db`): `LocalDb` (`query`, `run`, `transaction`, `subscribe`, `close`) over a shared core (`createLocalDb`) that runs one statement or transaction at a time (`BEGIN IMMEDIATE`), binds whole numbers as integers, reads every `INTEGER` as a `bigint`, and announces the tables a commit wrote (parsed from the statement; `*` when it cannot tell). Entries: `.` (interface, `migrateLocalDb`, `localOrm` — Drizzle `sqlite-proxy` — with `int64` and `safeInteger` columns, React `LocalDbProvider`), `./node` (`node:sqlite`), `./wasm` (`@sqlite.org/sqlite-wasm` 3.53.4), `./worker` and `./browser` (the WASM adapter served from a dedicated worker), `./contract` (the contract suite, 15 cases, for the native adapter of slice 13).
  - **Contract suite on WASM runs in memory under Node** (the Node build has no persistent VFS). The browser path — OPFS SAH-pool VFS in a worker — is covered by the end-to-end journeys, which fail if the opened database does not report WAL and `synchronous = FULL` (it opens with `locking_mode = EXCLUSIVE`, which lets WAL work without shared memory; checked by mutation). The SAH pool holds its files exclusively: a second tab of the app cannot open the database and shows why.
  - Local schemas are hand-written SQL migrations in each module's `client` entry (`accessLocalMigrations`, `syncLocalMigrations`, `inventoryLocalMigrations`, `salesLocalMigrations`) with Drizzle `sqlite-core` table definitions beside them; `migrateLocalDb` applies them in order, one transaction each, and refuses a removed, reordered, or unknown applied migration. **Not done: the `VACUUM INTO` copy before migrations and daily (ADR-0019)** — left to slice 13 (desktop shell, real files).
  - `core.access/client`: `DeviceScreen` (issue a registration code, register this client), `registerThisDevice`, `localDevice`. The registration response now also carries `tenantId`, `name`, and the store's `baseCurrency`; the device is saved from that one answer. **The browser registers as `mainPos`**, standing in for the Windows app until slice 13, although ADR-0019 says the browser is never a main POS — **a temporary deviation, accepted by the user on 2026-09-25**; slice 13 revisits the browser's device type once the desktop app is the main POS; its credential sits in the local database (OPFS), readable by the page's scripts.
  - `core.sync/client`: the outbox (`sync_outbox`, kept after the answer; rejected operations stay as *needs review*), named counters (`deviceSeq`, `doc:INV`), `enqueueOperation`, `nextDocumentSeq`, and `createSyncEngine`: push in `deviceSeq` batches, record answers, resend from `nextDeviceSeq` after a gap, then pull pages applying each with its cursor in one transaction through module `PullApplier`s. Rounds run every 15 s, at once on an outbox or device change, and on the browser's `online`/`offline` events. `SyncStatusIndicator` shows the phase, pending, and needs-review counts in words. A pulled entity with no applier is skipped and the cursor moves on (a bootstrap to recover it comes with `core-sync`).
  - `inventory/client`: `inventory_products` (prices as integers scaled by 10^6), filled by pull; the POS reads it. **`ProductsScreen` still reads the API** (the owner's online master-data screen).
  - `sales/client`: the cart (`sales_cart_lines`, survives a reload — tested at unit and end-to-end level), `completeCashSale` (cart, number, invoice and lines, outbox entry, emptied cart in one transaction; a failure anywhere gives the number back — tested, and checked by mutation), local invoices immutable by triggers, `PosScreen`, and `InvoicesScreen` (flow 7). The business date is the day in `DEFAULT_TIME_ZONE` (`Asia/Damascus`). The POS sells only products priced in the store's base currency; others show why they cannot be sold.
  - Server: `GET /api/v1/sales/invoices` (owner; newest 50 by default, no paging yet) with flags and the posted entry, through the ledger's new public `journalEntriesForSources`. `core.config/client` gains `ClientRuntime` (clock, ids) and a `bearer` option on `apiRequest`.
  - The web app opens the local database before rendering and shows an alert if it cannot. Routes `/pos`, `/invoices`, `/device`. End-to-end: `offline-sale.e2e.ts` (flows 1–7 with `context.setOffline`; the sale carries `negativeStock`, as expected without stock receiving) and the cart-reload journey. The bundle is 930 kB plus the 869 kB WASM file.
  - Not possible yet: opening or reloading the app while offline (no service worker; the PWA shell and offline sign-in come later — `core-foundation` for PIN sign-in).

## Open questions

- Reference low-end hardware for the POS speed budget (add an item < 100 ms, sale < 1 s). Default until decided: the oldest Windows 10 PC and Android tablet available to the team; the business track names the reference models.
- Which thermal printer model is used for slice 14. Default: whatever 80 mm ESC/POS printer the team has on hand; the certified list comes later.
- Final product mark. Default: a text placeholder («مستوفي» with the double rule) until a designer delivers it.

## Changelog

- 2026-09-25 — Spec agreed in the Phase A2 architecture session.
- 2026-09-25 — Unit base commit: f0196b4c5701f564778daeed0dc8ddf04a3ed3fc
- 2026-09-25 — Slice 1 done: monorepo, `pnpm verify`, CI, boundary checks.
- 2026-09-25 — Slice 2 done: `verify` skill, format hook, filtered test output, path-scoped rules.
- 2026-09-25 — Slice 3 done: kernel money, exchange rates, clock, randomness, UUIDv7; domain lint rules.
- 2026-09-25 — Slice 4 done: PostgreSQL 18 test database, migration runner, `withTenant`, RLS catalog and isolation tests; ADR-0017 policy amended.
- 2026-09-25 — Slice 5 done: Fastify host, module registry, problem details, OpenAPI, tenant creation CLI; minimal `core.access` users.
- 2026-09-25 — Slice 6 done: password login, sessions, registration codes, devices and prefixes, `core.audit`; store codes (ADR-0029, accepted).
- 2026-09-25 — Slice 7 done: `core.ledger` (seeded accounts, balanced immutable posting), `inventory` products, wire decimals.
- 2026-09-25 — Slice 8 done: `core.sync` push and pull, `sales` invoice ingest with posting and flags, `inventory` stock.
- 2026-09-25 — Slice 9 done: `packages/ui` token generator, light and dark tokens, contrast test, preview page approved by the user, `docs/design/design-system.md`.
- 2026-09-25 — Slice 10 done: web client shell (RTL Arabic, i18n, React Aria components, Tailwind theme), login and product screens, browser cookie sessions with Origin check, RTL and literal-string lint rules, keyboard-only Playwright journey in CI.
- 2026-09-25 — Slice 11 done: `packages/local-db` (Node, WASM, and OPFS worker adapters behind one contract suite), local schemas, outbox and sync engine with status indicator, offline POS sale in one local transaction, device registration screen, server invoice list with journal entries, Playwright journey of flows 1–7.
- 2026-09-25 — The browser registering as `mainPos` recorded as a temporary deviation from ADR-0019, accepted by the user; revisited in slice 13.
