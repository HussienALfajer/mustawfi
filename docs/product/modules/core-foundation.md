# Core foundation (`core-foundation`)

- Status: In progress
- Modules covered: `core.tenancy`, `core.access`, `core.organization`, `core.audit` — plus the configuration-bundle mechanism in `core.config` and operation flags and bundle delivery in `core.sync` (ADR-0030)
- Spec agreed with the user on: 2026-09-25

## Purpose

Turn the walking skeleton's "one owner, one device, no license" into a real store: licensed and limited by plan, with departments, several staff with roles and department scopes, fast PIN sign-in that works offline, supervisor override, device revoke, and an audit log the owner can read. Every later module builds on these permissions, departments, and audit paths.

## Scope (V1)

**`core.tenancy` — tenant and license**
- One license per tenant, signed with the license key (Ed25519 JWS), issued by a staff CLI and installed on the tenant server (ADR-0030). `tenant:create` requires a license.
- The license's limits enforced on the server: users, departments, main POS devices, companion devices.
- The lifecycle active → expiring → grace → read-only → suspended, evaluated on the server and on devices; devices apply it per business day (ADR-0030); owners see the warnings.
- Maximum offline days and detection of a clock moved backwards on devices (ADR-0021).

**`core.access` — identity, permissions, devices**
- Roles: a fixed owner role and editable roles created from templates (accountant, section cashier, repair technician, top-up operator); one role per user.
- Permissions in three dimensions: action (declared by modules), scope (the user's departments), limits (declared by modules; the values sit on the role).
- Users: create, edit, deactivate; PIN for everyone, password optional; several owners, at least one active.
- PIN sign-in on registered devices, online and offline, with name tiles, lockout after five wrong attempts, supervisor unlock; auto-lock after five minutes idle.
- Supervisor override by PIN on the same device.
- Sign-in rate limiting; sessions bound to the device they were opened on; unregistered browsers may sign in with a password, online only, with no selling.
- Device limits at registration; device revoke with accept-and-flag of its pending documents and a local wipe (ADR-0030).
- Optional TOTP two-factor authentication for users with a password, with recovery codes.
- Support password reset through a one-time reset code issued by Vertex staff (CLI until the admin console).
- The Windows app keeps its device credential and session token in Windows Credential Manager (ADR-0022, ending the walking-skeleton deviation).

**`core.organization` — store and departments**
- Store profile: name, logo, address, phones, tax number, commercial registration number; shown on the receipt.
- Departments: create, rename, archive; a hidden default department seeded with the tenant; department limit from the license.
- Document codes declared by modules; the number format `{prefix}-{docCode}-{seq:6}` as a shared function; server-side sequence tracking with an audited gap per device and document code.
- Documents carry a real department instead of the skeleton's fixed id.

**`core.audit` — audit log**
- Every event of non-negotiable 10 that this unit's modules produce, with who, what, when, which device, and before/after values.
- A device audit path: events that happen on a device (PIN sign-in and failures, lockout, override, clock tampering) are queued in the outbox and recorded with device time and server receipt time.
- The audit log screen for owners and holders of `audit.view`, with filters.

**Screens (desktop)** for store profile, departments, users, roles and permissions, devices, audit log, license and plan, and the user's own account; the PIN screen and supervisor override at touch density too. The full list and the conventions are under *Flows*.

## Out of scope

| Item | Goes to |
|---|---|
| Entitlement checks for modules and features, settings, custom fields, templates as bundle parts | `core-config` |
| The idle time as a setting (fixed at 5 minutes here) | `core-config` |
| Shifts replacing the business-day boundary of lifecycle restrictions | `treasury` |
| Plans, invoices, payments, reminders at 14/7/3/1 days, archiving, support impersonation, sector templates for departments | `admin` |
| Full tenant data export (the lifecycle gate already exempts export routes) | `core-data` |
| Using limits and overrides in real flows (discounts, credit sales, returns) | `sales`, `customers` |
| Which department a mixed cart or a section cashier sells under beyond the interim rule below | `sales` |
| Remote approvals on the owner dashboard | `reports` |
| Per-device pull scope (the bundle is already per device) | `core-sync` |
| Android keystore for the credential | `core-sync` (Android shell) |
| Restricting users to specific devices | later (rule of three) |
| WebAuthn, SMS or email recovery | after V1 |

## Dependencies

- Walking skeleton: `withTenant`, `resolveStoreCode`, the module registry and host composition (`apps/server/src/modules.ts`), `recordAudit`, session and device authentication (behind the route guard since slice 5), device prefixes, the sync outbox, push, pull, and `recordChange`, `LocalDb`, the web shell, the Windows app.
- ADRs: 0008 (lifecycle), 0017 (RLS), 0020 (sync, flags, numbering), 0021 (signing), 0022 (authentication and devices), 0029 (store code), 0030 (this unit's decisions).
- `sales`, `inventory`, and `core.sync` are touched only at their interfaces: route authorization, the department on invoices, document-number tracking, the read-only check before a sale, operation flags.

## Entities and data

Every table has `tenant_id` and `branch_id` with forced RLS, except as noted.

**`core_tenancy`**
- `licenses`: id, `jws` (the signed token as issued), `kid`, `plan`, `issued_at`, `not_before`, `expires_at`, `grace_days`, `read_only_days`, `max_offline_days`, `limits` (jsonb), `entitlements` (jsonb), `installed_at`, `installed_by`. Append-only; the current license is the newest installed. Claims are copied into columns for queries; the JWS stays the source.
- `departments`: id, `name` (unique among active departments), `is_default` (one per tenant), `sort_order`, `archived_at`, `archived_by`. No `DELETE` grant. **Stored in `core.tenancy`, next to branches** (ADR-0030): `core.access` (user scopes), `core.ledger` (journal lines), and document modules reference departments, while `core.organization` needs `core.access` for its routes and `core.sync` already depends on `core.access` — departments inside `core.organization` would close a dependency cycle. `core.tenancy` holds the table and its rules (default, last active, limit); `core.organization` owns the routes, screens, and audit entries that manage it.

**`core_organization`** (new module `@mustawfi/core-organization`, depends on `core.access`, `core.audit`, `core.config`, `core.sync`, `core.tenancy`)
- `store_profiles`: one row per tenant — `name`, `logo` (bytea, PNG or JPEG, at most 256 KB), `logo_type`, `address`, `phones` (up to three), `tax_number`, `commercial_register`, `updated_at`.
- `document_sequences`: (`device_id`, `doc_code`) → `last_seq`; the server's view of each device's numbering.

**`core_access`**
- `roles`: id, `name`, `template` (`owner` | `accountant` | `sectionCashier` | `repairTechnician` | `topUpOperator` | null for a copy), `is_owner`, `archived_at`. The owner role is one fixed row per tenant.
- `role_permissions`: (`role_id`, `permission`).
- `role_limits`: (`role_id`, `limit`, `value` decimal string).
- `users` gains: `role_id`, `department_scope` (`all` | `listed`), `status` (`active` | `deactivated`), `pin_verifier` (Argon2id PHC), `pin_changed_at`, `password_hash` becomes nullable, `totp_secret` (encrypted with a server key), `totp_enabled_at`. `is_owner` is replaced by the role.
- `user_departments`: (`user_id`, `department_id`) when the scope is `listed`.
- `recovery_codes`: user, code hash, `used_at`.
- `reset_codes`: user, code hash, `expires_at`, `used_at`, `issued_by_support` (the support reset of the owner's password).
- `sessions` gains a non-null `device_id` when opened on a registered device, and `method` (`password` | `pin`).
- `devices` gains `revoked_at`, `revoked_by`, `revoke_reason`, `wiped_at` (reported by the device), and `last_sync_at` (the server's time of the device's last push or pull, for the devices screen and the owner dashboard).
- `login_attempts`: failed attempts per login (password and online PIN), for rate limiting (pruned by age; not audit data). The per-source-address limit is **not** a table: an address may name no tenant (an unknown store code), and every table in a module schema is tenant-owned (ADR-0017). It is counted in the server process's memory, which is enough for V1's single server process; it resets on restart, and the per-login limit still holds.

**`core_sync`**
- `operation_flags`: (`op_id`, `code`) — operation-level flags that apply to any document type: `deviceRevoked`, `licenseReadOnly`, `permissionMissing`, `overrideNotAuthorized`, `numberGap`. Append-only.

**`core_audit`**
- `entries` gains `recorded_at` (server receipt time; `created_at` stays the time of the event, device time for device events) and `source` (`server` | `device`).

**Plans until the admin console** (in `tools/license`; the license carries the resolved values, so the tenant server never reads this table). Limits from `v1-scope.md` §6; every active user counts, owners included.

| Plan (`plan`) | Entitled modules | `users` | `departments` | `mainPosDevices` | `companionDevices` |
|---|---|---|---|---|---|
| `basic` | core, base modules, customer portal | 3 | 2 | 1 | 2 |
| `phonesPro` | + `serials`, `repairs`, `recharge` | 6 | 4 | 3 | 2 |
| `supermarketPro` | + `weighted` | 6 | 3 | 3 | 2 |

The CLI overrides any limit per tenant (`--limit users=8`). Entitlements are recorded in the license now and enforced by `core-config`; this unit enforces only the four limits.

**Configuration bundle** (not a table): a JWS manifest `{ version, issuedAt, deviceId, licenseRef, parts: { name → sha256 } }` and the parts. Parts in this unit: `license` (the JWS), `access` (users allowed on the device — every active user of the tenant in V1 — with name, role, department scope, and PIN verifier; roles with permissions and limits; lockout state reset marker), `organization` (departments and the store profile without the logo; the logo is fetched separately and checked against its hash).

**Device local tables** (SQLite, per module): `core.config` — `config_bundle` (manifest, parts, verified at); `core.tenancy` — `clock_guard` (high-water mark, last server contact), `license_day_state` (business date, evaluated state); `core.access` — `pin_lockouts` (user, failures, locked at), `local_sessions` (user, method, opened at, last activity).

## Business rules and invariants

Rules marked **[I]** are invariants that tests must protect.

**License**
1. **[I]** The tenant server never holds a license private key; it accepts a license only if its signature verifies against a configured public key for its `kid`, its tenant claim is this tenant, and its `issuedAt` is later than the installed license's. The test key pair lives with the tests and is never in a production key list: the server reads its public keys from configuration, with no built-in default.
2. **[I]** No tenant exists without an installed license: `tenant:create` takes the tenant id from the license's claim and creates both in one transaction.
3. The lifecycle state is a pure function of the claims and an instant: before `expiresAt − 14 days` active; until `expiresAt` expiring; for `graceDays` more grace; for `readOnlyDays` more read-only; then suspended. Days are 24-hour periods counted from `expiresAt`; each boundary instant belongs to the later state. A license whose `notBefore` is in the future is not installed.
4. **[I]** Limits: an active user, an active department, a main POS device, or a companion device beyond the license's limit is refused at creation (409 with a code naming the limit). Deactivated users, archived departments, and revoked devices do not count. A lower limit after a downgrade deactivates nothing; it only refuses new ones, and owners see the overage.
5. **[I]** Read-only (server): every write route answers 403 `tenancy.license.readOnly`, except sign-in, sign-out, the user's own PIN, password, and 2FA, and routes marked `allowedWhenReadOnly` (export, from `core-data`). Suspended: only owners' sessions are accepted, with the same exemptions; others get 403 `tenancy.license.suspended`. Sync push is always accepted; documents dated on a business day after the tenant became read-only are flagged `licenseReadOnly` (ADR-0030).
6. **[I]** Devices evaluate the state and the offline days at the first sign-in or unlock of each business day (Asia/Damascus) and keep that state until the next sign-in or unlock on a later business day; a session that runs past midnight keeps its state, and auto-lock (rule 24) bounds how long. A new license that improves the state applies at once (ADR-0030).
7. **[I]** A device whose last server contact is more than the license's maximum offline days ago, counted against its monotonic mark, is read-only until it syncs.
8. **[I]** The device's high-water mark is the maximum of every trusted server time and every local time observed. A local time more than 5 minutes behind the mark puts the device in read-only at once, until it reaches the server; the event is audited (device path).
9. Read-only on a device: no new document of any kind; viewing and export stay; an open cart stays for later. Suspended on a device: only owners can sign in, and they see the reason, how to renew, and export.
10. Expiring and grace warnings are shown to owners only. Read-only and suspended explain themselves to everyone who reaches them.

**Bundle**
11. **[I]** A device uses a bundle only after verifying the manifest's signature (bundle key, `kid`) and every part's hash; a failure keeps the previous valid bundle and puts the device in read-only until a valid one arrives. A bundle for another device is refused.
12. The bundle is rebuilt on demand from current data; its version increases whenever a part changes. Devices fetch it after each sync round when the server's version differs.

**Roles and permissions**
13. **[I]** Every permission and limit is declared by a module in its manifest, with the templates that grant it by default; the registry refuses an undeclared permission in a check, a duplicate declaration, or a template grant naming an unknown template.
14. **[I]** The owner role holds every permission, no department restriction, and no limits; it cannot be edited or archived. At least one active user has the owner role at all times; only owners grant or remove the owner role.
15. A user has exactly one role. A scoped permission holds only in the user's departments (`all` or the listed ones); an unscoped permission (for example `access.users.manage`) ignores the scope.
16. A limit's value is a percent, an amount in the base currency, or a count, as the declaring module says. A missing value means the action is not allowed beyond zero; the owner is unlimited.
17. **[I]** Every route and every sync operation type names the permission it needs, or says explicitly that it is `public` (sign-in, health, OpenAPI) or needs only an authenticated session or device (own session, own account, device audit events). The server checks it for routes (403 `access.permission.denied`). For sync operations the document is accepted and flagged `permissionMissing` when the user lacked the permission on the server at ingest.
18. Supervisor override: when an action needs a permission or exceeds a limit, a supervisor picks their name and enters their PIN on the same device; the override holds if the supervisor's role covers the action and the value, in the department. The document carries the approver and the override id; the override is audited (device path). The server re-checks and flags `overrideNotAuthorized` when the supervisor lacked it.

**Users, PIN, sessions**
19. Every user has a PIN of 4–6 digits (not all the same digit, not a straight run up or down such as `1234` or `4321`); the owner or a user with `access.users.manage` sets the first one, and the user may change it with the current PIN. A password is optional; a user without one signs in only by PIN on a registered device.
20. **[I]** Five wrong PINs for one user on one device lock that user on that device. Offline, only a supervisor with `access.users.unlock` unlocks them there. When the device reaches the server, the PIN screen checks PINs online and the server's rate limit (rule 21) governs that user instead of the local count (ADR-0022). The count survives restarts.
21. **[I]** Sign-in rate limiting: after 5 failures for one store and login within 15 minutes, further attempts for that login wait 15 minutes; after 30 failures from one source address within 15 minutes, that address waits 15 minutes (counted in memory, see `login_attempts`). The answer is 429 `access.login.throttled`; throttling is audited once per window. Online PIN sign-in counts the same way per user and device.
22. **[I]** A session opened on a registered device is bound to it: requests with that session must also carry the device credential, and revoking the device revokes its sessions. A session opened without a device (an unregistered browser) cannot push, pull, fetch a bundle, or create documents.
23. **[I]** A revoked device: its credential is refused everywhere except push; everything it pushes is accepted and flagged `deviceRevoked` (ADR-0030); the push answer tells it that it is revoked; when every operation has an answer the device wipes its local data and reports the wipe if it can. The prefix is never reused.
24. Auto-lock: after 5 minutes without input the device returns to the PIN screen; the open cart and any unsaved form stay in the local database.
25. After an offline PIN sign-in, the first action that needs the server asks for the PIN again once the server is reachable, to open a server session.
26. 2FA: a user with a password may enable TOTP (QR code, confirmation code) and receives 10 single-use recovery codes; password sign-in then needs a code or a recovery code. PIN sign-in on a registered device does not ask for it. An owner may clear another user's 2FA; the support reset clears the owner's.
27. Support reset: Vertex staff issue a one-time reset code (valid 30 minutes) for a named owner through the CLI; with it, the owner sets a new password (and PIN if asked). The issue and the use are audited and visible in the tenant's log as done by support.

**Organization**
28. **[I]** A tenant has exactly one default department, created with the tenant («المتجر»); the default department can be renamed but not archived. The last active department cannot be archived. Departments are archived, never deleted; archived departments keep their history and leave users' scopes.
29. While a tenant has one active department, no screen other than the departments screen asks for or shows a department (no column, picker, or filter).
30. **[I]** Document codes are declared by modules (three upper-case letters, unique across modules). Numbers are `{prefix}-{docCode}-{seq:6}`, formatted and parsed only by `core.organization/shared`.
31. **[I]** On ingest, a document number whose sequence is not the device's last one for that code plus one is accepted; a jump is flagged `numberGap` and audited `organization.numbering.gap` with the missing range; a repeat is already refused as a duplicate (ADR-0020).
32. Interim department rule for documents, until `sales` refines it: a user whose scope lists exactly one department sells under it; otherwise the device's documents use the tenant's default department.

**Audit**
33. **[I]** Audit entries are append-only for every role (walking skeleton); device events carry the device time as `created_at` and the server's receipt time as `recorded_at`.
34. **[I]** Every action code written anywhere has an Arabic label and appears in the audit catalogue test, which also lists the events of non-negotiable 10 this unit produces (below) and fails if one has no writer. Every slice that adds an action code adds its Arabic label in its module's messages at the same time; slice 14 adds the catalogue test over all of them.
35. The audit log is readable by owners and by users with `audit.view`; it is never editable or deletable from any screen or API.

Events this unit audits: sign-in by password or PIN (success, failure, throttled), sign-out, lockout and unlock, auto-lock (not audited — too frequent; the next sign-in is), session revoked, user created, edited, deactivated, reactivated, role changed, scope changed, PIN set or changed, password set, changed, or reset (support or owner), 2FA enabled, disabled, cleared, recovery code used, role created, edited, archived, device registered, revoked, wiped, registration code issued, store profile changed (before/after), department created, renamed, archived, license installed, license state reached on a device (read-only, suspended), maximum offline days reached, clock moved backwards, supervisor override granted or refused, number gap.

## Accounting impact

None directly: this unit posts no journal entries. It supplies the department that every journal line carries (the invoice's department, rule 32) and the operation flags the accountant's review queue will read.

## Flows

**Staff (Vertex), CLI**
1. `license:issue --tenant new --plan phonesPro [--expires …] [--limit users=8 …]` prints a license JWS for a new tenant id; `tenant:create` takes it with the store name, base currency, and the first owner, and prints the store code.
2. `license:issue --tenant <id> …` then `license:install` renews or changes a license.
3. `access:reset-code --store <code> --login <login>` prints a one-time reset code for an owner.

**Owner, desktop (Windows app or browser)**
4. Sign in with store code, login, password (and a 2FA code when enabled).
5. Store profile: edit name, logo, address, phones, tax and commercial register numbers; the receipt shows the name.
6. Departments: add, rename, archive (only once a second department exists does the department column appear anywhere).
7. Roles: see the templates, copy one, change permissions and limits, archive.
8. Users: add (name, login optional, password optional, role, departments, first PIN), edit, deactivate, reactivate, reset PIN or password, clear 2FA.
9. Devices: issue a registration code, see devices with type, prefix, last sync, revoke.
10. Audit log: filter by user, action, device, date range; open an entry to see before and after.
11. Own account: change PIN, password, enable or disable 2FA, see recovery codes once.

**Cashier, main POS device (Windows app), online or offline**
12. The app opens on the PIN screen: name tiles of the users allowed on the device, then the PIN pad (keyboard digits work).
13. Five wrong PINs lock that name on this device; a supervisor picks their name and enters their PIN to unlock it.
14. After 5 idle minutes the PIN screen returns; the cart is where it was.
15. An action beyond the cashier's permission or limit opens the supervisor override: supervisor name, PIN, done.
16. The status area shows the license warnings to owners and the read-only reason to everyone.

**Revoked device**
17. On its next contact the device pushes everything pending, shows that it was removed from the store, wipes its local data, and returns to device registration.

Tablets and phones use the same PIN screen and override at touch density; administration screens are desktop only in this unit.

### Screens after this unit

The whole client once this unit is done (desktop; the PIN screen and override also at touch density). Navigation is a collapsible side panel on the start side, in groups (user decision, 2026-09-25); each entry shows only to users who may open it.

| Group | Screen | Pattern | New or changed |
|---|---|---|---|
| — (before sign-in) | Sign-in: store code, login, password; then a 2FA code when enabled | form | changed |
| — | Recovery with a support reset code | form | new |
| — | PIN screen: name tiles, then the pad; also the auto-lock screen | touch panel | new |
| — | «Store suspended» (owners: reason, renewal, export) | notice | new |
| — | «This device was removed from the store» | notice | new |
| Sales | Point of sale (read-only block, supervisor override) | POS | changed |
| Sales | Invoices | list | unchanged |
| Inventory | Products | list | unchanged |
| Administration | Store profile | settings form | new |
| Administration | Departments (always here; department columns and pickers elsewhere stay hidden while one is active) | list + side panel | new |
| Administration | Users | list + side panel | new |
| Administration | Roles and permissions (permission matrix, limits) | list + side panel | new |
| Administration | Devices (registration codes, last sync, revoke) | list + side panel | new; replaces the device screen's owner part |
| Administration | Audit log | compact list + side panel | new |
| Administration | License and plan (limits used of allowed, expiry) | read-only summary | new |
| This device | This device (registration), Printer | form | unchanged |
| — (user menu) | My account: PIN, password, 2FA, recovery codes | settings form | new |

Everywhere: the license warning bar (owners), the supervisor override dialog, the sync status indicator.

### Screen conventions

Agreed with the user on 2026-09-25; `docs/design/screen-patterns.md` holds them and slice 3 completes it from the approved preview.

- Records open in a **side panel beside the list**, never a modal; large documents (invoice, journal entry) open as a full page.
- **Keyboard first:** every journey is doable without a mouse, and Playwright journeys are keyboard-only.
- Components are **built when a screen needs them**: a component starts in the module that needs it and moves to `packages/ui` when a second module needs it; generic controls (select, dialog, side panel, checkbox) go to `packages/ui` from the first use. Every `packages/ui` component appears in the **component gallery** (the former preview page), in both themes and all three densities.
- A **preview approved by the user** comes before the code of each new screen pattern.
- An **axe accessibility check** runs in every Playwright journey and fails the build.

## Permissions

Declared by this unit (unscoped unless noted). Template grants: **A** accountant, **S** section cashier, **R** repair technician, **T** top-up operator; the owner holds all.

| Permission | Meaning | Default grants |
|---|---|---|
| `access.users.view` | See users and roles | A |
| `access.users.manage` | Create, edit, deactivate users; set first PINs; reset PINs and passwords of non-owners | — |
| `access.users.unlock` | Unlock a user locked out on a device (on that device) | A |
| `access.roles.manage` | Create, edit, archive roles | — |
| `access.devices.manage` | Issue registration codes, revoke devices | — |
| `organization.profile.edit` | Edit the store profile | — |
| `organization.departments.manage` | Create, rename, archive departments | — |
| `audit.view` | Read the audit log | A |

The walking skeleton's routes and operations get their permissions in slice 5, declared by their own modules:

| Permission | Module | Guards | Default grants |
|---|---|---|---|
| `inventory.products.view` | `inventory` | `GET /inventory/products` | A, S, R, T |
| `inventory.products.manage` | `inventory` | `POST /inventory/products` | A |
| `sales.invoices.view` | `sales` | `GET /sales/invoices` | A |
| `sales.invoice.create` (scoped) | `sales` | sync operation `sales.invoice.post` | S |

Limits declared by this unit: none (sales, customers, and treasury declare theirs). Every template also receives the permissions later modules declare for it (for example `sales.invoice.create` for S, `repairs.*` for R) through those modules' manifests.

## Offline and sync behavior

- **Works offline:** PIN sign-in and user switching, lockout and supervisor unlock, auto-lock, permission checks and supervisor override, license and clock enforcement, the store profile on receipts — all from the verified bundle and local tables.
- **Append-only, pushed:** device audit events (`audit.entry.record`), documents (flags attached on ingest).
- **Server-authoritative, delivered down:** the bundle (license, access, organization parts), fetched after each sync round when its version changes; departments and store profile also through pull for screens that list them.
- **Flagged after sync:** `deviceRevoked`, `licenseReadOnly` (document dated on a business day after the tenant became read-only), `permissionMissing`, `overrideNotAuthorized`, `numberGap`.
- **Online only:** administration screens, password and 2FA changes, registration codes, revoke, the audit log screen, the unregistered browser.
- Changes to push handling get sync-simulation cases: a device revoked mid-run keeps every sale (flagged) and then wipes; a lockout offline survives a restart.

## Settings and customization points

- No typed settings yet (`core-config`). Fixed defaults to become settings there: idle time 5 minutes; PIN length 4–6; lockout after 5 attempts; rate-limit windows; session lifetime 7 days.
- Roles and permissions are customization layer 5 (overview §8): tenant admins copy templates and edit them.
- Entitlements used: the license's limits `users`, `departments`, `mainPosDevices`, `companionDevices`.
- Templates: the receipt gains the store name from the profile — a new template version in `sales`; the skeleton version stays for reprints of the invoices recorded with it (non-negotiable 7).
- No custom fields in this unit.

## Edge cases

| Case | Behavior |
|---|---|
| The only owner tries to deactivate themselves or take away their owner role | Refused: at least one active owner (rule 14). |
| A plan downgrade leaves more users or departments than the new limit | Nothing is deactivated; new ones are refused; owners see the overage. |
| A license expires during the business day | Devices keep the day's state until the day ends; the server's read-only starts at its own time; documents from that day are not flagged. |
| The tenant renews while devices are read-only | The next bundle carries the new license and the devices return to active at once. |
| A device's clock is moved back by an hour | Read-only at once, audited on the device path; the next sync restores it. |
| A device is offline longer than its maximum offline days | Read-only from the next business day's first sign-in until it syncs. |
| A cashier fails the PIN five times, and the store is offline | Locked on that device; a supervisor unlocks on the spot; the lockout is audited when the device syncs. |
| A user is deactivated while a device is offline | The user can still sign in there until the device's next bundle; their documents are accepted; the audit log shows the times. |
| A device is revoked while offline and sells for two days | At first contact every sale is accepted and flagged `deviceRevoked`; the device wipes after all answers. |
| A revoked device holds a rejected (needs review) operation | The rejection and its payload are already stored on the server; the wipe goes ahead. |
| The bundle arrives corrupted or with a bad signature | The previous bundle stays in use; the device is read-only until a valid bundle arrives. |
| An owner forgets the password and has no 2FA recovery code | Support reset code (rule 27). |
| Someone guesses store codes | Rate limiting per source address; the same answer and timing for unknown store and unknown login (ADR-0029). |
| A document arrives with `INV` sequence 7 after 5 | Accepted, flagged `numberGap`, audited with the missing number 6. |
| An archived department is in a user's scope | It leaves the scope; if the scope becomes empty the user keeps signing in but has no scoped permission until an owner edits the scope. |
| A user signs in on an unregistered browser | Online back office only; no POS route, no local database. |

## Acceptance criteria

1. A tenant cannot be created or renewed without a license signed by a configured license key; the tenant server holds no license private key (test with a wrong key, a wrong tenant, an older license).
2. User, department, and device limits from the license are enforced at creation, and a downgrade deactivates nothing (integration tests).
3. Every route and sync operation type declares a permission; `is_owner` checks are gone; a user without a permission gets 403 on every protected route (a test walks the route table), and sync operations are accepted and flagged instead.
4. A cashier starts the Windows app with no network, signs in by PIN, and sells; five wrong PINs lock a user out; a supervisor unlocks them and approves an override — all offline (end-to-end journey plus a recorded manual check on the Windows app).
5. A device revoked while offline pushes its sales at first contact; they are accepted and flagged `deviceRevoked`; the device wipes its data; pull, bundle, and API refuse it (integration test and a sync-simulation case).
6. The lifecycle state machine and the per-day freeze hold under property tests; a device with its clock moved back, or past its maximum offline days, cannot create documents (tests).
7. A bundle with a bad signature or hash is not used (tests over each part).
8. Every audited action code has an Arabic label and a writer, and the log is readable only by owners and `audit.view` holders (catalogue test, 403 test).
9. Documents carry a real department; the default department is hidden while it is the only one; number gaps are flagged and audited (tests).
10. The RLS catalog and isolation tests cover every new table; `pnpm verify` passes.
11. Every screen of the list under *Flows* exists, passes the axe check and a keyboard-only journey, and follows `docs/design/screen-patterns.md`; the user approved the pattern preview before its code.

## Verification plan

- **Unit and property (Vitest, fast-check):** lifecycle states over random claims and times, the per-day freeze, the clock guard, PIN rules, permission resolution (role × scope × limits), number format and gap detection, bundle manifest hashing.
- **Integration (Testcontainers PostgreSQL 18):** license installation and refusals, limits, route authorization table walk, rate limiting, device-bound sessions, revoke, bundle assembly per device, operation flags, audit writes and the viewer's filters, the RLS catalog and isolation tests with seeds for every new table.
- **Sync simulation harness:** revoke during a run (no lost sale, all flagged, wipe after answers); device audit events delivered once.
- **End-to-end (Playwright):** administration journeys (keyboard-only: user with role and scope, department added and column appearing, store profile on the receipt preview); offline PIN sign-in, lockout, unlock, auto-lock with the cart kept; 2FA enrolment and sign-in; read-only banner and blocked sale.
- **Manual (recorded in the slice notes):** the Windows app opened offline to the PIN screen; credential and token in Windows Credential Manager surviving a restart.
- **Accessibility:** axe in every Playwright journey; the component gallery reviewed by the user.
- **Security review** (`/security-review`) on the sign-in, PIN, 2FA, revoke, and bundle slices.

## Slices

Screens ship with the feature they serve, so every milestone ends with something the user can open and try (user decision, 2026-09-25). The milestones group the slices; each slice is still one session.

| Milestone | What the user sees at its end | Slices |
|---|---|---|
| M1 Store and license | The new application frame (side navigation), store profile and departments screens, the store name on the receipt | 1–4 |
| M2 Users and permissions | Users and roles screens with the permission matrix; the server refuses what a role does not allow | 5–7 |
| M3 Sign-in and devices | Devices screen with revoke, «My account» with 2FA, throttled sign-in, support recovery | 8–10 |
| M4 Working offline | The Windows app opens offline to the PIN screen, sells, locks out and unlocks, supervisor override; license warnings and read-only | 11–16 |
| M5 Oversight | Audit log screen; the Windows app remembers its session in Credential Manager | 17–18 |

| # | Slice | Done when (3–5 checks) | Effort | Depends on | Status |
|---|---|---|---|---|---|
| 1 | License: issue, install, lifecycle function | `tools/license` generates Ed25519 key pairs and issues license JWS with ADR-0030's claims; `license:install` and `tenant:create` refuse a bad signature, an unknown `kid`, another tenant, an older license, a future `notBefore`, and a tenant without a license (integration tests); the pure lifecycle function passes property tests (state order, boundaries at each day count); `core_tenancy.licenses` is append-only and in the RLS tests; e2e and test setups create tenants with test-key licenses | high | — | Done 2026-09-25 — see notes below |
| 2 | Departments and store profile (server) | `core_tenancy.departments` and `core.organization` (store profile) exist with their migrations and RLS seeds; creating a tenant seeds the default department «المتجر» and a store profile named after the tenant (integration test); create, rename, archive departments with the default and last-active rules and the license's department limit (tests); store profile edit with logo size and type checks, before/after audited; departments and profile flow down through pull into local tables | medium | 1 | Done 2026-09-25 — see notes below |
| 3 | Application frame, screen patterns, first screens | The user approved a preview of the frame and the list-with-side-panel pattern before code (recorded), and `docs/design/screen-patterns.md` is completed from it; the collapsible grouped side navigation replaces the top bar and carries the existing screens; the departments screen (list with side panel; always reachable under Administration, while department columns and pickers elsewhere stay hidden until a second active department exists) and the store profile screen (settings form with logo) work against the API; a component gallery replaces the token preview page and shows every `packages/ui` component in light and dark and the three densities; an axe check runs in every Playwright journey, the existing ones included, and a keyboard-only journey edits the profile and adds a department | medium | 2 | Done 2026-09-25 — see notes below |
| 4 | Document codes, numbering, and real departments on documents | Modules declare document codes and the registry refuses duplicates (test); `formatDocumentNumber`/`parseDocumentNumber` in `core.organization/shared` replace `sales`' own format; `core_sync.operation_flags` exists (append-only, RLS), and ingest tracks the last sequence per device and code, flags `numberGap`, and audits the missing range (test); `SKELETON_DOCUMENT_DEFAULTS.departmentId` is gone, invoices carry the tenant's default department (rule 32 minus the scope part), and invoices and journal lines reference `core_tenancy.departments` by foreign key; the receipt template gets a new version that prints the store name, and invoices recorded with the skeleton version still reprint with it (non-negotiable 7) | high | 2 | Done 2026-09-26 — see notes below |
| 5 | Roles, permissions, and route authorization | Manifests declare permissions and limits with template grants, and the registry refuses duplicates and unknown templates (tests); tenant creation seeds the owner role and the four templates, and existing routes get the permissions listed under *Permissions*; `authorize`/`limitFor` replace every `is_owner` check, and the session answer carries the user's role, scope, and effective permissions; a test walks every route and fails on one without a declared permission, and a user lacking it gets 403; sync operation types declare permissions and ingest flags `permissionMissing` instead of refusing | high | 2 | Done 2026-09-26 — see notes below |
| 6 | User and role management (server) | Routes to create, edit, deactivate, and reactivate users (role, scope, optional password, first PIN) and to copy, edit, and archive roles, each audited with before/after; the at-least-one-active-owner and only-owners-grant-owner rules hold (tests); the user limit is enforced and a downgrade deactivates nothing; PIN rules (length, no repeats or runs) and Argon2id verifiers; own PIN and password change; the open question on permissions declared after a tenant exists is decided and its behavior tested | high | 5 | Not started |
| 7 | Users and roles screens | The users screen (list, filters by role, department, and status in the URL, side panel to create and edit, deactivate with a reason) and the roles screen (templates and copies, a permission matrix grouped by module with limits, archive) work against the API; the navigation shows only what the signed-in user may open; a limit reached is explained on the action, not hidden; a keyboard-only journey creates a section cashier scoped to a new department; axe passes | medium | 3, 6 | Not started |
| 8 | Sign-in hardening and device limits | Rate limits per store and login and per source address answer 429 and are audited once per window (tests with an injected clock); password and online PIN sign-in on a registered device bind the session to it and a request without the matching device credential is refused; registration enforces main POS and companion limits; an unregistered-browser session cannot push, pull, or create documents; the support reset code CLI works once, expires in 30 minutes, and is audited as support | high | 6 | Not started |
| 9 | Device revoke and the devices screen | Revoking a device (permission `access.devices.manage`, with a reason) revokes its sessions and refuses its credential except for push; pushed operations are accepted and flagged `deviceRevoked`, and the push answer says `revoked`; the client wipes its local data once every operation has an answer and shows «this device was removed»; the devices screen lists type, prefix, last sync, and status, issues registration codes, and revokes (Playwright); a sync-simulation case revokes a device mid-run with no lost sale | high | 3, 8 | Not started |
| 10 | Two-factor authentication, «My account», recovery | Users with a password can enable TOTP (QR, confirmation), get 10 recovery codes shown once, and then need a code or a recovery code at password sign-in (tests with an injected clock; a replayed code refused); PIN sign-in never asks for it; owners clear another user's 2FA and the support reset clears the owner's; the TOTP secret is encrypted at rest and every change audited; «My account» (PIN, password, 2FA) and the sign-in steps for a 2FA code and a support reset code pass an e2e journey | high | 3, 8 | Not started |
| 11 | Signed configuration bundle | `core.config` signs a manifest with part hashes (bundle key, `kid`, current and next public keys) and verifies it on the client; the host composes parts from modules; `core.sync` serves `GET /api/v1/sync/bundle` to devices and the sync engine fetches it when the version changes; the `license`, `access` (users, roles, permissions, limits, scopes, PIN verifiers), and `organization` parts; a bad signature, a bad hash, or another device's bundle is refused and the previous one kept (tests per part) | high | 6, 9 | Not started |
| 12 | License enforcement on the server, license screen | Write routes answer 403 `tenancy.license.readOnly` in read-only and suspended states, except the exempt routes (a test walks the route table); suspended accepts only owners' sessions; push stays open and a document dated after the read-only business day is flagged `licenseReadOnly` (test); state transitions are computed with the server clock (tests at each boundary); the owners' «License and plan» screen shows plan, state, expiry, and each limit as used of allowed | high | 1, 3, 5 | Not started |
| 13 | License enforcement on the device | The client evaluates the state and offline days at the day's first sign-in and holds it for the business day, and a renewal lifts it at once (tests with a manual clock); the clock guard keeps the high-water mark from server and local times and goes read-only on a 5-minute step back; read-only blocks every new document (the POS says why) and the «store suspended» screen lets only owners in; owners see expiring and grace warnings, others do not (component and e2e tests) | high | 11, 12 | Not started |
| 14 | Device audit path | An `AuditSink` port in `core.config/client` (wired by `apps/web` to the outbox, so `core.access/client` can audit without depending on `core.sync`) writes a device event in the caller's local transaction as an `audit.entry.record` operation, handled in `core.sync` through `recordAudit`; the server records it once with device time and receipt time (`source = device`), idempotent under duplicate pushes (test and sync-simulation check); clock-guard and license-state events use it; the audit catalogue test lists every action code with a label and a writer | high | 13 | Not started |
| 15 | PIN sign-in, lockout, and auto-lock | The PIN screen (name tiles, pad, keyboard digits) verifies against the bundle's verifiers offline and opens a device-bound server session online; five wrong PINs lock the user on the device across restarts until a supervisor with `access.users.unlock` unlocks (tests); 5 idle minutes return to the PIN screen with the cart kept; PIN-only users sign in; a Playwright journey loads the app, goes offline, returns to the PIN screen, signs in by PIN, sells, locks a user out, and a supervisor unlocks (the browser cannot start offline: no service worker), and the Windows app started with no network reaches the PIN screen and sells (manual check recorded) | high | 11, 14 | Not started |
| 16 | Client permissions, scope, and supervisor override | `can(permission, department)` and `limitFor` on the client read the bundle's access part and match the server's resolution (shared tests); screens hide what the user may not do; the override dialog (supervisor name, PIN) grants only when the supervisor's role covers the action, value, and department, attaches approver and override id, and audits it through the device path; the server flags `overrideNotAuthorized` (test with a fixture limit); a user whose scope lists one department sells under it | high | 15 | Not started |
| 17 | Audit log screen | `GET /api/v1/audit/entries` with filters (user, action, device, date range) and keyset pages, readable by owners and `audit.view` only (403 test); the screen shows entries in a compact table with Arabic labels, device and server times, and a side panel with before/after values; filters live in the URL; a Playwright journey filters by user and opens an entry; axe passes | medium | 3, 14 | Not started |
| 18 | Windows keystore | The Windows app stores the device credential and session token in Windows Credential Manager through a Tauri command, moves an existing credential out of the local database and deletes it there (test on the native core); the session survives an app restart; the ADR-0022 amendment on the Windows deviation is closed; manual check on the release build recorded | high | 15 | Not started |

### Slice notes and deviations

- **Slice 1 (2026-09-25).**
  - The license is a compact JWS with header `alg: EdDSA`, `typ: mustawfi-license`, `kid`; its payload holds the claims in camelCase (`tenant`, `plan`, `issuedAt`, `notBefore`, `expiresAt`, `graceDays`, `readOnlyDays`, `maxOfflineDays`, `limits`, `entitlements`), instants as UTC ISO 8601 with milliseconds. Entitlements are the non-core module ids of the plan (`tools/license/src/plans.ts`).
  - `verifyLicense` and `licenseState` sit in `core.tenancy/shared` so devices can use them in slices 11 and 13. `jose` 6.2.12 (current release, checked 2026-09-25); `jwtVerify` decodes the payload because shared code may not use `TextDecoder`.
  - Public keys are configured as `LICENSE_PUBLIC_KEYS=kid:x,…` (`x` the raw Ed25519 key in base64url, as `license:keygen` prints it). Only the two CLIs read it in this slice; the HTTP server does not need it until the bundle (slice 11).
  - `license:install` is a server CLI (`pnpm --filter @mustawfi/server license:install --store <code> --license <jws>`); `installTenantLicense` is the interface `apps/admin-api` will call. `license:keygen --kid <kid> --out <file>` writes the private JWK without overwriting; `license:issue` prints the JWS on stdout and a summary on stderr, and takes instants only with an explicit offset.
  - Default validity when `--expires` is omitted: one year from `notBefore` (not in the spec; the other defaults are the open question's).
  - Installs by Vertex staff record `installed_by = null` and audit `tenancy.license.installed` with no user, the replaced license as `before`. The current license is the one issued last (installs must be newer), not the one with the latest `installed_at`, so a server clock stepping back cannot bring an older license back.
  - `core_tenancy.licenses` is append-only by grants and by triggers (like the audit log), under forced RLS, seeded in the isolation test.
  - The test key pair is generated once per test process by `@mustawfi/tools-license/testing` and never written to disk; `createLicensedTenant` (apps/server test helper) and the e2e global setup use it.
  - `core.tenancy` gains a `client` entry with the `tenancy` i18n namespace, holding the Arabic label of `tenancy.license.installed` (rule 34), registered in `apps/web`. Audit labels map an action `<module>.<subject>.<event>` to the key `audit.<subject>.<event>` in the module's namespace (`tenancy:audit.license.installed`); slice 14's catalogue test uses the same mapping.
- **Slice 2 (2026-09-25).**
  - `createTenant` (`core.tenancy`) writes the default department «المتجر» itself, so no tenant exists without one; a trigger keeps `is_default` fixed and a check keeps the default unarchived. `core.organization`'s `seedOrganization`, called by the host's tenant creation, audits it, publishes it for pull, and creates the store profile named after the store. `tenancy.tenant.created` now records `defaultDepartmentId`.
  - `core.tenancy` exports `createDepartment`, `renameDepartment`, and `archiveDepartment` (the rules only); `core.organization` wraps them with the audit entry and the change-log write. Other modules go through `core.organization`.
  - Refusals: 409 `tenancy.limit.departments` (the code names the limit; the user and device limits follow as `tenancy.limit.users`…), `tenancy.department.nameTaken`, `.archived`, `.default`, `.lastActive`; 404 `tenancy.department.notFound`. The last-active rule is checked before the default rule, so archiving the only department answers `lastActive`.
  - Routes under `/api/v1/organization`: `GET`/`POST /departments`, `PATCH /departments/:id`, `POST /departments/:id/archive`, `GET`/`PUT /profile`, `GET`/`PUT`/`DELETE /profile/logo`. Writes are owner-only until slice 5 declares `organization.*`; reads are open to every session.
  - The logo is uploaded as base64 JSON; its type comes from its signature (PNG or JPEG), whatever the client claims; 422 `organization.logo.unsupportedType` or `organization.logo.tooLarge` (over 256 KB). Stored as `bytea` with its type, SHA-256, and size.
  - Pull: departments flow down as full rows, **archived ones included with `archivedAt`** rather than as tombstones, because documents keep naming them. The profile flows down **without the logo bytes** (type, hash, size); fetching the image onto devices comes with the receipt that prints it.
  - Audit actions (labels in the `organization` namespace): `organization.department.created`, `.renamed`, `.archived`, `organization.profile.created`, `organization.profile.changed` (logo changes included, recorded by type, hash, and size).
  - Local migrations: devices match applied migrations by position, so the list moved to `apps/web/src/local-migrations.ts` and a new module appends at its end; a test pins the released prefix and upgrades a database migrated by the previous release.
  - Tenants created before this slice get no default department or profile (no backfill): there is no production tenant yet.
- **Slice 3 (2026-09-25).**
  - **Preview approved by the user on 2026-09-25** (a static page served locally, light and dark): the frame and the list-with-side-panel pattern as `screen-patterns.md` now records them — navigation 232 px, collapsed to 56 px with `Ctrl+B` and remembered on the device, a 56 px top bar, a 400 px side panel on the end side, `N` for a new record. lucide-react (1.48.0, ISC, checked 2026-09-25) supplies the icons, also approved in that session; `@axe-core/playwright` 4.13.0 (checked the same day) runs the axe check.
  - `packages/ui` gains `SideNavigation` (with `useNavigationCollapsed`), `SidePanel`, `SearchField`, `SegmentedControl`, `Badge`, `ConfirmDialog`, `TextArea`, `FormSection`/`FormFooter`, `Kbd`, `useShortcut`, and `enterMovesToNextField`; `DataTable` gains a single selection that follows the arrow keys, and `Button` a `danger` variant.
  - The component gallery is the web app's `/gallery` (no session); `tokens:generate` now writes only the stylesheets, and the generated preview page and its test are gone. A test fails when `@mustawfi/ui` exports a component the gallery does not show.
  - Screens: `core.organization/client` exports `DepartmentsScreen` (filters `status`, `q`, and the open `selected` record in the URL, validated by `departmentFiltersSchema`) and `StoreProfileScreen` (the logo is saved on its own as soon as it is chosen, checked for type and size before upload; Save covers the text fields; leaving with unsaved changes asks once through the router's blocker). Routes `/admin/departments` and `/admin/profile`, under Administration.
  - `core.config/client`: `apiRequest` takes `PUT`, `PATCH`, and `DELETE`, and `apiBlob` fetches the logo with the session, since an `<img>` cannot carry the Windows app's bearer token.
  - Navigation labels: the invoices entry is «الفواتير» (was «المبيعات», now the group) and the device entry «تسجيل الجهاز».
  - Every Playwright journey imports `test` from `apps/web/e2e/test.ts`, which runs axe (WCAG 2.1 A and AA) on the screen the journey ends on; journeys also check each screen they pass. React Aria's off-screen live region is excluded (a pending button's announcement outlives the button by 7 s when the page changes). `MUSTAWFI_E2E_SCREENSHOTS=<dir>` keeps the light and dark screenshots of the administration journey.
  - **Deviations from `screen-patterns.md`:** archiving a department confirms once but asks no reason, because `core.audit` has no reason field yet (it comes with the first slice that needs one: deactivating a user, slice 6, or revoking a device, slice 9); details panels do not end with «last changed by … on …», because the department and profile views carry no author (the audit log screen, slice 17, supplies it). The license limit is explained when a new department is refused (409), not shown as «used of allowed» (the license screen, slice 12).
  - Administration entries are shown to owners only until roles and permissions (slice 5). The user menu is the name, the role, and sign out until «My account» (slice 10) and switching user (slice 15); the license warning joins the top bar in slice 13. No screen outside Administration shows a department column or picker yet, so the «hidden while one department is active» rule first applies in slice 4.
- **Slice 4 (2026-09-26).**
  - Document codes: `ModuleManifest.documentCodes` (`sales` declares `INV`); `documentCodeSchema` sits in `core.config/shared`, since `core.config` cannot depend on `core.organization`. The registry refuses a code two registered modules declare, a disabled one included (its documents keep their numbers), and exposes `registry.documentCodes`; `defineModule` refuses a malformed or repeated code.
  - `formatDocumentNumber(prefix, docCode, seq)` and `parseDocumentNumber` in `core.organization/shared` replace `sales`' `formatInvoiceNumber`/`parseInvoiceNumber` (their property tests moved with them); sequences have at most 15 digits both ways. `sales` now depends on `core.organization`.
  - `core_sync.operation_flags` carries a `detail` snapshot (jsonb) besides `op_id` and `code` — the spec listed only the key. One flag per code per operation; the check lists all five codes. Its tenant-scoped foreign key to `received_ops` is deferred to commit, because a handler flags before push stores the operation's row. Append-only by grants and triggers. `core.sync/server` exports `flagOperation` and `operationFlagsOf`.
  - `core_organization.document_sequences` rows only move forward (trigger). `core.sync` cannot depend on `core.organization`, so the document's module calls `trackDocumentNumber` in its handler, after its own insert (a repeat is refused as a duplicate first). A jump flags `numberGap` and audits `organization.numbering.gap` on the document, `after` = `{ docCode, first, last, count, number }` (label `organization:audit.numbering.gap`). A lower sequence (a late number inside a reported gap) is accepted without a flag and leaves the sequence where it is. A rejected operation does not count, so a document rejected for review shows as a gap when the next one arrives — the accountant should see it.
  - Departments on documents: `knownDepartments` (`core.tenancy`); `sales.invoice.post` rejects `sales.invoice.unknownDepartment` (a reference to nothing, like an unknown product) and accepts an archived department (the device may have sold before it heard); `postJournalEntry` refuses an unknown department as `ledger.entry.invalid`. Tenant-scoped foreign keys from `sales.invoices` and `core_ledger.journal_lines` to `core_tenancy.departments`. No backfill: a server database (PostgreSQL) holding skeleton invoices or journal lines with the fixed department id fails these foreign-key migrations and is recreated; devices with invoices from before this slice have no sequence row, so their next invoice would report a gap from 1. There is no production tenant.
  - Devices: `localDefaultDepartment` (`core.organization/client`); `completeCashSale` sells under it and refuses `noDepartment` (nothing recorded, the POS explains) while the departments have not been pulled — they come before any product in the change log, so a device with products has them. `SKELETON_DOCUMENT_DEFAULTS` keeps only the shift.
  - Receipt `receipt.cash.2` (`sales/client` `receipt-templates.ts`): the skeleton's text headed by the store name, left out while the profile has not reached the device. `receipt.skeleton.1` is kept byte for byte (a test pins its SHA-256) and reprints the invoices recorded with it; `cashReceiptTemplate(version)` picks the invoice's own. **Decision:** the name is read from the local profile when the receipt is built, not stored on the invoice, so a reprint after a rename shows the new name. The rasterized receipt cannot be read back in Playwright; `apps/web/src/receipt-template.test.ts` renders both versions through LiquidJS instead.
  - The sync simulation pulls departments and the profile, and checks that the server's last `INV` sequence per device equals the invoices the device made and that no operation was flagged.
  - No department column is added to the invoices screen: flow 6's column comes with the first screen that lists documents by department.
- **Slice 5 (2026-09-26).**
  - Declarations: `ModuleManifest.permissions` (`{ id, scoped?, grants? }`) and `limits` (`{ id, kind, grants? }`, `grants` a starting value per template). Ids start with the module id without `core.` (`audit.view`), so two modules cannot collide unless they share that prefix. The vocabulary (`ROLE_TEMPLATES`, id, kind, and value schemas, `PermissionCatalogue`) sits in `core.config/shared`, since the registry validates it and `core.config` cannot depend on `core.access`. `defineModule` and the registry both check a manifest; `registry.permissions` lists every registered module's declarations, disabled ones included, so a role keeps them while a module is off. No limit is declared yet; `limitFor` is tested with fixture limits.
  - The Done criteria's `authorize` is the route guard below plus `session.grant.can`; there is no separate `authorize` function.
  - Resolution: `accessGrant(catalogue, roleAccess)` in `core.access/shared` (for the client in slice 16) — `can(permission, department?)`, `limitFor(limit)`, and the effective `permissions`. It throws for an undeclared permission or limit, and for a scoped permission asked without a department.
  - Routes: each declares `config: { access }` — `public`, `session`, `device`, or `{ permission }`. `installRouteAccess` (`core.access/server`) refuses to register a route without one, with an undeclared permission, or with a scoped permission (such a route declares `session` and checks `session.grant.can(permission, department)` itself). It authenticates in `onRequest`, before the body is parsed, so an unauthorized request gets 401/403 rather than 400. Handlers read `sessionOf(request)` / `deviceOf(request)`; `requireSession` and `requireDevice` are no longer exported. The host starts through `buildHostServer` (`apps/server/src/host-server.ts`); health and OpenAPI are `public`. A request to a route registered before the guard (only the CORS preflight, which answers allowed origins itself) is refused with 403.
  - **Decision:** reading departments, the store profile, and its logo needs only a session — the POS shows the store name and pickers list departments. Refusal code `access.permission.denied` (403) replaces `access.permission.ownerRequired`.
  - Tables: `roles`, `role_permissions`, `role_limits` (column `limit_id`, since `limit` is reserved in SQL), `user_departments`; `users` gains `role_id` and `department_scope` and loses `is_owner`. `is_owner` and `template` are fixed by column grants (the app may update only the name and archive columns); a check keeps the owner role unarchived and one partial unique index keeps one owner role per tenant. Tenant-scoped foreign keys to roles, users, and `core_tenancy.departments`. No `DELETE` yet: removing a permission or a listed department comes with editing in slice 6. No backfill: a database with users from before this slice fails the migration and is recreated.
  - Server functions without routes yet: `seedRoles` (tenant creation: the owner role «المالك» and «المحاسب», «كاشير القسم», «فني الصيانة», «موظف تعبئة الرصيد» with the template grants), `createRole`, `createUser` (replaces `createOwner`), `userAccess`. Each role created is audited `access.role.created` (label `access:audit.role.created`); `access.user.created` now records `roleId` and `departmentScope`.
  - The session and login answers carry `user.role` (`id`, `name`, `isOwner`), `departmentScope`, `departments` (active ones only: archived departments leave the scope), and `permissions` (effective); the grant is resolved on every request, so a role change applies to the next request.
  - Sync: `SyncOperationDefinition.access` is `device` or `{ permission, department? }`; `createSyncOperationTable(definitions, catalogue)` refuses a missing access, an undeclared permission, or a scoped one without its department. `sales.invoice.post` needs `sales.invoice.create` in the invoice's department. Push resolves the operation's user at ingest and, when the permission is missing, flags `permissionMissing` with `{ permission, departmentId, roleId }` and records the operation; the flag commits with it. A scoped operation whose payload names no department is flagged too (fail closed); its handler normally rejects it, which rolls the flag back. The check uses the scope at ingest, from which archived departments have left (rule 28): a listed-scope cashier's offline sale in a department archived before the push is flagged — intended, since the accountant should see a sale in a department the seller no longer covers; the sale itself is accepted as slice 4 requires.
  - Client: the side navigation shows products, invoices, store profile, and departments only to holders of the permission their screen needs; the user menu shows the role's name from the session. Users and roles entries come with slice 7.

## Open questions

- **Commercial defaults of the license CLI** — until the admin console holds plans: grace 7 days, read-only 30 days, maximum offline 10 days (v1-scope), companion devices 2 in every plan (v1-scope says "a small free allowance" without a number). The CLI takes overrides per tenant.
- **Which department a sale belongs to** when a user's scope has several departments, or a cart mixes departments — `sales` decides; until then rule 32.
- **Argon2id parameters for PIN verifiers** checked on low-end devices (verification should stay under about 300 ms on the reference hardware) and the WASM or native implementation on the client — chosen and measured in slice 15, recorded in its notes. Slice 6 creates verifiers with `@node-rs/argon2`'s defaults; the PHC string carries its parameters, so a change in slice 15 does not break stored verifiers (they are rehashed at the next PIN change).
- **Library choices** (`jose` for Ed25519 JWS on server and clients, `otpauth` for TOTP, an Argon2id implementation for the client, `@axe-core/playwright`) are checked against their current releases in the slice that adds them, as for every dependency; Ed25519 in WebCrypto is verified in WebView2 and the browser in slice 11.
- **Permissions declared after a tenant exists** — a module enabled later, or a permission a later slice adds, reaches no existing role: template roles got their grants when the tenant was created. Settled in slice 6 (user, 2026-09-26): whether template roles pick up new template grants, and how that respects an owner's removals.
- **The TOTP secret's encryption key** custody — a server secret file like the bundle key until `ops` defines the key procedure.

## Changelog

- 2026-09-25 — Spec agreed; ADR-0030 accepted by the user.
- 2026-09-25 — Slices regrouped into five milestones with each screen shipped beside its feature (18 slices); screen conventions agreed: side navigation, side panels, preview before code, component gallery, license screen, axe (user decisions).
- 2026-09-25 — Readiness review before slice 1. Fixes:
  - the departments screen stays reachable;
  - the receipt's store name moves to slice 4 with a new template version, keeping the skeleton version for reprints;
  - `core_sync.operation_flags` is created in slice 4, now `high` because it changes sync ingest;
  - department foreign keys on invoices and journal lines;
  - `devices.last_sync_at` and `revoke_reason`;
  - the per-address sign-in limit is counted in memory, because a table would not be tenant-owned;
  - explicit `public` and authenticated routes, and permissions for the skeleton's routes;
  - the plan table;
  - clarified business-day evaluation, PIN lockout, PIN runs, and lifecycle boundaries;
  - the test license key kept out of production;
  - the offline journey split between the browser and the Windows app;
  - `v1-scope.md` module dependencies aligned.
- 2026-09-25 — Unit base commit: 6b55b933f17e06c506e4458982b299ff628300ab.
- 2026-09-25 — Slice 1 done (license issue, install, lifecycle function).
- 2026-09-25 — Slice 2 done (departments and store profile, server).
- 2026-09-25 — Slice 3 done (frame with side navigation, screen patterns from the approved preview, departments and store profile screens, component gallery, axe in every journey).
- 2026-09-26 — Slice 5 done (declared permissions and limits, seeded roles, route guard, `permissionMissing` at ingest).
