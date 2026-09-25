# 0029. Name the tenant at sign-in with a store code resolved through a sealed directory, and route bearer secrets by tenant id

- Status: Accepted (by the user on 2026-09-25)
- Date: 2026-09-25

## Context

Every tenant-owned table is behind row-level security (ADR-0017): nothing is visible without a tenant context. A password sign-in and a new device's registration start with no context at all, so the server must learn the tenant before it can find the user or the registration code. After sign-in, each request carries only an opaque bearer token (ADR-0022), which must also lead to its tenant. ADR-0017 allows no "all tenants" query outside the control plane, and the control plane (ADR-0028) does not exist yet. The user chose a store code on 2026-09-25 (walking-skeleton slice 6) over a globally unique login and over sending the tenant's UUID.

## Decision

**Store code (رمز المتجر, `storeCode`).** Each tenant gets, at creation, six symbols from the unambiguous alphabet of ADR-0020 (no `I`, `O`, `0`, `1`; 32⁶ ≈ 1.07 × 10⁹ codes), drawn at random, unique across tenants, never changed, never reused. Sign-in asks for store code, login, and password; the client remembers the store code after the first sign-in. A new device types the store code and the registration code (a QR code carries both). Input forgives case, spaces, and dashes.

**Sealed directory.** `core_tenancy.store_codes (code, tenant_id)` is the one table outside row-level security. It is *sealed*: `mustawfi_app` holds no privilege on it. A `SECURITY DEFINER` trigger on `core_tenancy.tenants` publishes a new tenant's code, and `core_tenancy.tenant_for_store_code(code)` — the only function the app role can execute that runs with other rights — returns the tenant id for one exact code. The app role cannot list tenants. `TenantDatabase.resolveStoreCode` is the single call outside `withTenant`, and it lives in `core.tenancy`.

**Tenant-routed bearer secrets.** Session tokens and device credentials are `{tag}.{tenant id}.{256 random bits, base64url}` (`s1` for sessions, `d1` for devices). The server reads the tenant id, opens `withTenant` for it, and looks up the SHA-256 of the whole token. Clients treat the token as opaque. The random part is the secret; the tenant id is not.

**Checks.** The RLS catalog test treats a table `mustawfi_app` cannot reach as sealed instead of checking it, and pins both the list of sealed tables and the list of `SECURITY DEFINER` functions the app role may execute. Adding to either list is a decision.

**Answers.** An unknown store, unknown login, and wrong password get the same 401 `access.login.failed` and take about as long (a dummy Argon2id verification). The same holds for registration (`access.registration.failed`). A store code is not a secret: it identifies, the password authenticates.

## Consequences

- Sign-in works under row-level security without a privileged role or an all-tenants query.
- One extra field on the sign-in screen, remembered after the first use.
- Store codes can be probed one at a time, by the answer's timing if not its content. That reveals only that a store exists. Sign-in rate limiting (ADR-0022) must bound it; it is not built yet (`core-foundation`).
- When the control plane arrives, the directory may move there; the lookup function keeps its contract.
- A vanity code chosen by the owner, or a subdomain per store, can come later on the same directory.

## Alternatives considered

- **Globally unique login (phone or email)** — one field fewer, but an accountant who works for several stores needs a login per store, and device registration still needs another way to find the tenant.
- **The tenant UUID in the request** — no exception to row-level security, but no person can type it.
- **A `BYPASSRLS` role owning the lookup function** — works on the `tenants` table directly, but adds a privileged role to provision and audit.
- **Looking up sessions by token hash across tenants** — needs the same kind of exception for every request instead of once at sign-in.
