# 0030. Issue one license per tenant from a staff CLI, build the signed configuration bundle from module parts, store departments in core.tenancy, apply lifecycle restrictions per business day, and accept documents from a revoked device

- Status: Accepted (by the user on 2026-09-25)
- Date: 2026-09-25
- Amends: ADR-0021 (license claims, bundle assembly), ADR-0022 (documents from a revoked device)

## Context

The `core-foundation` spec session (2026-09-25) has to deliver licenses, offline PIN sign-in, and device revoke before the control plane (`admin`, roadmap unit 12) and shifts (`treasury`, unit 6) exist.

- ADR-0021 puts the device in the license claims and gives the license key to `apps/admin-api`. With a license per device, every device registration on the tenant server would need the control plane online to sign it, and the tenant server must never hold the license key.
- PIN verifiers and permissions must reach devices signed (ADR-0021, ADR-0022), and the bundle was planned for `core-config` (unit 3). Delivering them unsigned first and moving them later builds the delivery twice and leaves them open to local tampering meanwhile.
- ADR-0008 forbids lifecycle transitions mid-shift, but there are no shifts before `treasury`.
- ADR-0022 accepts, from a revoked device, only operations created before the revocation time. A device offline when it was revoked does not know, keeps selling, and its sales would be refused — a real sale missing from the books, which ADR-0020 rejects for every other business rule. The cut-off also relies on the device clock.

The user chose the license, bundle, lifecycle, and revoke options below in the spec session on 2026-09-25; the placement of departments came out of checking the module dependency graph in the same session.

## Decision

**One license per tenant.** The license claims are the tenant, plan, entitlements, limits (users, departments, main POS devices, companion devices), `notBefore`, `expiresAt`, grace days, read-only days, maximum offline days, and the issuer's time. There is no device claim: a device is bound to its tenant by its credential (ADR-0022), and device limits are enforced by the tenant server at registration from the license's limits. The license key stays with the issuer; the tenant server and devices hold only public keys (with `kid`, current and next, ADR-0021).

**Issuance before the control plane.** A staff CLI in `tools/license` generates key pairs and issues license JWS tokens (Ed25519, `jose`). The tenant server installs a license through `core.tenancy` after verifying its signature, its tenant, and that it is newer than the installed one. `tenant:create` requires a license and takes the tenant id from its claim, so no tenant exists without one. `apps/admin-api` later calls the same installation interface; the CLI then stays for development and tests only.

**The configuration bundle is built in `core-foundation`.** `core.config` owns the format (a JWS manifest with version, issue time, license reference, and a SHA-256 per part), signing with the bundle key on the server, verification and local storage on the client. Modules contribute parts — `core.tenancy` the license, `core.access` the users allowed on the device with roles, permissions, limits, department scopes, and PIN verifiers — and the host composes them, as it composes sync operations. `core.sync` delivers the bundle to authenticated devices after each sync round. `core-config` adds its parts (settings, custom fields, templates, entitlements) to the same mechanism.

**Lifecycle restrictions apply per business day on devices.** A device evaluates the license state, and the maximum offline days, at its first sign-in of each business day (Asia/Damascus) and keeps that state until the day ends. A renewal lifts restrictions at once. When `treasury` adds shifts, shift open and close replace the day boundary. A clock moved backwards is a tampering signal and applies at once. On the server, a document dated on a business day after the tenant became read-only is accepted and flagged.

**Departments are stored in `core.tenancy`.** The `departments` table, with its rules (one default, never archive the last active one, the license's limit), sits in `core.tenancy` next to `branches`: `core.access` (user scopes), `core.ledger` (journal lines), and document modules need foreign keys to it, while `core.organization` depends on `core.access` for its routes and `core.sync` already depends on `core.access`. Inside `core.organization`, departments would close a dependency cycle. `core.organization` keeps the routes, screens, and audit entries that manage departments, plus the store profile and document numbering; `v1-scope.md` still lists departments as a `core.organization` feature, which it remains for the user.

**Documents from a revoked device.** At its first contact after revocation, a revoked device may still push. Every completed document it pushes is accepted and flagged `deviceRevoked` for the accountant; nothing is refused for the revocation itself. Once every operation has an answer, the device wipes its local data. Pull, the bundle, and every other API refuse the revoked credential.

## Consequences

- Registration and sync never depend on the control plane being up; the tenant server keeps only verification keys.
- A copied license is useless on another tenant's devices (tenant claim) and on an unregistered device (no credential).
- Offline PIN sign-in ships with signed permissions from the start; `core-config` extends the bundle instead of replacing a delivery path.
- A cashier is never cut off mid-day by an expiry; the tenant gets up to one extra business day of use.
- A stolen, revoked device can push fabricated sales at its first contact; they arrive flagged and the accountant reverses them. Losing a real sale is judged worse.
- Operation-level flags (`deviceRevoked`, `licenseReadOnly`) live in `core.sync`, so every document module gets them without its own flag code.

## Alternatives considered

- **A license per device (ADR-0021 as written)** — every registration waits for the control plane, which does not exist yet and must not be on the selling path.
- **The tenant server signs trial licenses** — puts the license key on the tenant server, against ADR-0021's key separation.
- **Unsigned access data now, the bundle in `core-config`** — builds delivery twice and allows local permission tampering in between.
- **Transitions at the next sign-in, or immediately with no open cart** — can still change a cashier's state in the middle of a working day.
- **Departments inside `core.organization`, with a host-injected scope provider for `core.access`** — keeps the table where `v1-scope.md` lists the feature, but loses the foreign keys from user scopes and journal lines and adds two ports for one table.
- **Accept only operations created before the revocation time** — depends on the device clock and loses real sales made before the device learned of the revocation.

## Amendments

- 2026-09-26 (`core-foundation` slice 9, accepted by the user on 2026-09-26): besides push, a revoked device's credential opens one more call, the report that it wiped its local data (`POST /api/v1/access/devices/current/wipe`). The call can only record the wipe, once, on a revoked device; everything else still refuses the credential. Without it the owner could not tell a wiped device from one that never came back.
