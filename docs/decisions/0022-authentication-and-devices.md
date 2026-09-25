# 0022. Opaque server-side sessions, device credentials from one-time registration codes, offline PIN verification, TOTP 2FA — built in core.access

- Status: Accepted
- Date: 2026-09-25

## Context

`core.access` needs password login for owners and accountants, fast PIN login for cashiers on shared devices (which must work offline), supervisor override by PIN, device registration and remote revoke, auto-lock, mandatory 2FA in the admin console, and optional 2FA for owners (`v1-scope.md` §4.1, §7). Revoking a stolen device or a dismissed employee must take effect as soon as the server is reached.

## Decision

**Users and passwords:** Argon2id hashes (`@node-rs/argon2`) on the server. Login endpoints are rate-limited, and every login attempt is audited (non-negotiable 10).

**Sessions:** opaque 256-bit random tokens; the server stores only a SHA-256 hash, with user, device, expiry, and revocation. Revocation takes effect on the next request. In the browser the token is an `HttpOnly`, `Secure`, `SameSite=Lax` cookie with an Origin check against CSRF; in Tauri and Capacitor it is a `Bearer` header, with the token kept in the OS secure store.

**Device registration:** the owner generates a short-lived, single-use registration code (shown as text and a QR code). The new device submits it with its type (main POS or companion) and details. The server checks the device limits (entitlements), creates the device, assigns its document prefix (ADR-0020), and issues a **device credential**: a random secret, stored hashed on the server and kept on the device in the OS keystore (Windows Credential Manager/DPAPI through Tauri; Android Keystore through Capacitor). Sync authenticates as the device; each operation names the user who performed it.

**PIN:** 4–6 digits per user, used only on registered devices, for quick user switching and supervisor override. The server stores an Argon2id verifier, and the configuration bundle carries verifiers only for users allowed on that device. Five wrong attempts lock that user on that device until a supervisor unlocks it or the device reaches the server. A PIN is a convenience on a trusted device, not a strong secret: a stolen database could be brute-forced offline, which the device credential, remote revoke, and field-level encryption of sensitive data mitigate.

**Revocation**

- *Device:* the server refuses its credential. On its next contact the device may still push operations created before the revocation time (accepted and flagged), then wipes its local data.
- *User:* sessions are deleted and PIN verifiers removed from the next bundles. Offline devices learn at their next sync, a delay bounded by the offline window.

**Two-factor authentication:** TOTP (RFC 6238, the `otpauth` library) with single-use recovery codes. Mandatory in the admin console, optional for tenant owners and accountants. WebAuthn later.

**Auto-lock:** after a configurable idle time (setting), the device returns to the PIN screen; an open sale stays in the local database.

**Implementation:** the `core.access` module on these primitives. No authentication framework.

## Consequences

- Revoking a device or a user is immediate online and bounded offline.
- The device-offline and PIN flows, which no library supports, are designed in one place.
- Security-sensitive code is ours to maintain; it gets `high` effort slices and a security review.

## Alternatives considered

- **JWT access tokens + refresh tokens** — no per-request lookup, but revocation waits for expiry; the performance gain does not matter at this scale.
- **Better Auth with custom plugins** — covers passwords, sessions, and 2FA, but imposes its own tables, and the hard parts (devices, PIN, offline) would still be written outside it.
- **PIN checked only online** — cashiers could not switch users during an outage.
