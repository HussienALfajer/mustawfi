# Mustawfi — agent instructions

Mustawfi (مُستوفي) is a multi-tenant SaaS for accounting and point of sale, built by Vertex System for Syrian retail stores. V1 serves single-branch small and medium stores — mobile phone shops first, supermarkets second — where several staff work in separate sections (repairs, accessories, carrier top-ups…) and everything consolidates to the owner and the main accountant. The product must keep selling when the internet or power drops, and must handle US dollars and the new Syrian pound side by side. It will grow into multi-branch and enterprise accounting, so today's design must not block that.

## Where the truth lives

Read what the task needs; don't load everything.

| Need | Source |
|---|---|
| What V1 contains, module by module | `docs/product/v1-scope.md` |
| Detailed spec and slice plan of a module | `docs/product/modules/<spec-unit>.md` |
| Why a technical choice was made | `docs/decisions/NNNN-*.md` (ADRs) |
| System shape, module rules, customization model | `docs/architecture/overview.md` |
| Phases, spec units, module order, status | `docs/roadmap.md` |
| Arabic ↔ English terms and code identifiers | `docs/glossary.md` |
| How to spec, build, review, close a module | `docs/workflow/*.md` |
| Market, competitors, pricing | `docs/product/vision.md` |

## Non-negotiables

These hold in every change. A change that needs to break one stops and asks the user.

1. **One codebase for all customers.** Per-customer behavior comes from configuration (entitlements, settings, custom fields, templates, add-on modules in this repo) — never from forks or per-customer branches.
2. **Modular monolith.** A module never reads another module's tables or internals; it uses that module's public interface or domain events.
3. **Tenant isolation.** Every tenant-owned table has `tenant_id` and `branch_id`; PostgreSQL row-level security enforces isolation. No query may bypass it.
4. **Offline first.** A sale never waits for the network. Clients work from a local database and sync through an outbox.
5. **One ledger per tenant, double-entry.** Every financial event posts balanced journal entries (debits = credits). Departments are profit centers inside that ledger, not separate books.
6. **Posted documents are immutable.** Corrections are reversals. Nothing financial is ever deleted.
7. **Every document records** its currency, exchange rate, department, user, shift, device, and the print-template version used.
8. **Document numbers are unique per device** (device prefix), so offline devices never collide.
9. **Closed periods are locked.** No journal entry may carry an accounting date inside a locked period; a document keeps the business date it happened on.
10. **Everything is audited.** Create, cancel, return, discount, price change, permission change, login, drawer open without sale, support impersonation — with who, what, when, which device, before/after values.

## Domain gotchas

- **Currency:** since 2026-01-01 amounts are in the *new* Syrian pound (two zeros removed). Old notes lost legal tender on 2026-07-31. Legacy data imported from old systems is divided by 100 — the import tool offers this explicitly.
- **Dollarization:** merchants price many items in USD and sell in SYP at a daily rate the owner sets. Customer and supplier debts are often kept in USD. Never assume SYP-only.
- **Connectivity:** power and internet are intermittent. Never make a sale, print, or shift close depend on the server.
- **Arabic on thermal printers:** ESC/POS printers render Arabic unreliably. Render receipts to an image and print the raster.
- **IMEI:** 15 digits with a Luhn check digit. Dual-SIM phones have two IMEIs. Phone boxes carry several barcodes (IMEI1, IMEI2, serial, EAN) — classify them, don't take the first one scanned.
- **Clients run on Windows 10 or later.** Windows 7 is still common in Syrian shops but is not supported; say so wherever requirements are shown.
- **Cash is local reality:** shifts, cash counts, handovers, and owner drawings are core features, not edge cases.
- **Cash drawer:** it opens with a sale, once. A reprint never kicks it; any other opening is an audited event (non-negotiable 10).
- **Local migrations are matched by position:** a new module's local migrations go at the end of `LOCAL_MIGRATIONS` (`apps/web/src/local-migrations.ts`), never in dependency order, or devices with an existing database refuse to start.

## How work is organized

Work flows in spec units (a module or a small group of tightly coupled core modules, listed in `docs/roadmap.md`):

1. **Spec session** — agent and user discuss the unit; output is `docs/product/modules/<unit>.md` with an ordered slice plan. See `docs/workflow/module-spec.md`.
2. **Slices** — one slice per session: build, verify, review, update the spec, ship. See `docs/workflow/implement-slice.md`.
3. **Close** — whole-unit review, docs reconciled, lessons folded back into these instructions. See `docs/workflow/close-module.md`.

A **slice** is one verifiable outcome that fits in a single session without compacting context: roughly one module's internals plus the core interfaces it uses, finishable in 3–5 checkable conditions.

## Working agreement

- When a step doesn't need the user, keep going. Put status notes in the same message as your next action.
- Stop and ask only when you can't continue without the user, or before anything destructive or hard to undo: deleting data, force-pushing or rewriting pushed history, changing anything outside this repository, or changing a non-negotiable or an accepted ADR.
- If a request has no verifiable finish line, state the one you'll use in one line, then proceed.
- Stay inside the task's scope. Record what you notice outside it under **ما وجدته** instead of fixing it silently.
- Accepted ADRs are settled. Don't reopen one without new evidence; if you think one is wrong, say why and let the user decide. A new significant decision gets an ADR (from `docs/decisions/_template.md`) with status *Proposed* until the user accepts it.
- Show evidence, not assertions: the commands you ran and what they returned.
- Mark anything you couldn't confirm, and say where you looked.
- Give your candid professional opinion, including disagreement with the user's idea, with the reasons. The user wants it.

## Definition of done (code changes)

- The slice's acceptance criteria hold, shown by checks that ran.
- New behavior has tests; invariants touched by the change have tests that would fail if the invariant broke.
- Project verification passes (see Commands).
- The module spec reflects what was built (slice status, deviations noted).
- Committed with a Conventional Commits message, e.g. `feat(treasury): close shift with variance posting`.

## Reporting

End every task that changes files or runs more than a few steps with a report to the user, in Arabic, under these headings (a quick question gets a direct answer instead):

- **ينتظرك** — decisions or approvals needed from the user, or «لا شيء». When the task leaves a local branch whose PR is not merged yet (auto-merge pending, or left for the user), this section always ends with the cleanup to run once GitHub shows the PR merged, as one line: `git switch main; git pull --ff-only; git branch -d <branch>`. It uses `;`, not `&&`, so it runs in both bash and Windows PowerShell 5.1. After a squash merge, `-d` works because the local `origin/<branch>` ref still exists (git warns that the branch is "not yet merged to HEAD"). If that ref has been pruned, `-d` refuses: confirm that the PR was merged, then use `-D`. If the agent sees the PR merged before it reports, it runs the cleanup itself and says so, instead of listing it.
- **ما تغيّر** — what changed, briefly.
- **الدليل** — checks run and their results.
- **ما وجدته** — out-of-scope findings, risks, anything unconfirmed.
- **الخطوة التالية** — the exact next action, copy-paste ready.

## Language

- Chat with the user in Arabic. Everything stored in the repository is English: code, docs, commit messages, PR descriptions.
- V1 UI text is Arabic, always through i18n keys — never hard-coded strings.
- Name things with the identifiers in `docs/glossary.md`; add new domain terms there.

## Git

- CI exists: every change, docs included, goes through a branch and a PR to `main`. `main` is protected; the `verify` check must pass before merging, and only squash-merge is allowed.
- Branches: `slice/<unit>-<n>-<short-name>` for slices, `docs/<short-name>` or `fix/<short-name>` otherwise.
- Merging is done by GitHub, not by the agent: after opening the PR, enable auto-merge (squash). GitHub merges when `verify` passes and deletes the remote branch. Then update local `main` and delete the local branch (`git switch main; git pull --ff-only; git branch -d <branch>`). While the merge is still pending, the report lists that command under **ينتظرك** (see Reporting).
- A change that touches a non-negotiable or an accepted ADR is never auto-merged: leave the PR open for the user under **ينتظرك**.
- When CI fails, the agent diagnoses and fixes it in code, at most three attempts per PR. Never weaken a test, a lint rule, a boundary rule, or a CI step to make CI pass. After three failed attempts, stop and report under **ينتظرك**: hypotheses, what was tried, the evidence, and a proposal.
- Never force-push and never rewrite pushed history.

## Commands

Node.js 24 (`.nvmrc`), pnpm (version pinned in `package.json` → `packageManager`), and Rust through rustup (toolchain pinned in `rust-toolchain.toml`; on Windows with the MSVC build tools). Run from the repository root:

| Command | What it does |
|---|---|
| `pnpm install` | Install dependencies (CI uses `--frozen-lockfile`) |
| `pnpm build` | Build every package that has a build step (Turborepo; today the web app) |
| `pnpm format` / `pnpm format:check` | Format with Prettier / check formatting (Markdown is excluded) |
| `pnpm lint` | ESLint, zero warnings allowed |
| `pnpm typecheck` | TypeScript for root config and every package (Turborepo) |
| `pnpm check:boundaries` | ADR-0015 boundary rules: package exports, module `dependsOn`, entry and layer rules, tables kept internal and SQL kept in the module's own schema |
| `pnpm check:rust` | `cargo fmt --check` for every crate, then Clippy (warnings are errors) and `cargo test` on the native LocalDb core and the printer transport |
| `pnpm test` | Vitest across all workspace projects (builds the native LocalDb core with Cargo for its contract suite) |
| `pnpm test:e2e` | Playwright journeys of the web app against a real server and PostgreSQL (Docker); first run `pnpm --filter @mustawfi/web exec playwright install chromium` |
| `pnpm verify` | All of the above in order — the gate before any commit; CI runs the same |
| `pnpm verify:agent` | The same steps as `pnpm verify`, printing one line per passing step and only the errors and summary of a failing one (full logs in `node_modules/.cache/mustawfi-verify/`) |
| `pnpm test:agent [filter]` | Vitest with only failures and the summary |
| `pnpm --filter @mustawfi/desktop build:installer` | The Windows app's NSIS installer (Windows only), in `target/release/bundle/nsis/`; `dev` runs it against the Vite dev server |

A module declares its dependencies in its `package.json` as `"mustawfi": { "dependsOn": ["core.ledger", …] }` (module ids, not package names).
