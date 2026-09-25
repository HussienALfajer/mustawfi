# 0021. Sign licenses and configuration bundles with Ed25519 (JWS), with key IDs, rotation, and a monotonic device clock

- Status: Accepted
- Date: 2026-09-25

## Context

Devices work offline with a signed license and a signed configuration bundle (ADR-0005, ADR-0008, ADR-0009) up to the license's maximum offline days. They must detect tampering with either, and with the device clock, without a server.

## Decision

- **Algorithm and format:** Ed25519 signatures in JWS compact form (`alg: EdDSA`), produced and verified with the `jose` library on server and clients.
- **Keys:** two key pairs with separate purposes — a *license* key held by `apps/admin-api` (the control plane issues licenses) and a *bundle* key held by `apps/server`. Each JWS header carries a `kid`. Private keys live in root-only secret files on the server (V1 has no KMS), with an encrypted offline copy.
- **Rotation:** apps ship with the current and the next public key for each purpose. A rotation is announced through a bundle signed by the old key that adds the new one; old keys are retired once no active device depends on them. Planned yearly, immediate on suspected compromise.
- **License claims:** tenant, device, plan, entitlements, limits, `notBefore`, `expiresAt`, grace days, maximum offline days, and the server time at issuance.
- **Bundle:** a signed manifest with version, issue time, license reference, and a content hash for each part (settings, custom-field definitions, templates, permissions, PIN verifiers). Large parts are fetched separately and checked against their hash.
- **Verification:** at start-up, after every sync, and before creating a document. A signature or hash failure puts the device in read-only mode until a valid bundle arrives.
- **Device clock:** the device keeps a high-water mark — the maximum of every trusted server time seen and every local time observed — in the local database. A local time more than a small tolerance behind the mark means the clock was moved backwards: the device goes read-only until it reaches the server. Offline days are counted from the last server contact against this monotonic mark, not against the wall clock.

## Consequences

- A tampered license or bundle is detected offline; a device cannot extend its offline window by moving its clock back.
- Key custody is manual in V1; the procedure is documented in the operations runbook (ADR-0027).
- Per ADR-0008, enforcement stays light: the real leverage is that sync, remote reports, and support stop.

## Alternatives considered

- **HMAC-signed licenses** — the verification key would be on every device, and could be used to forge licenses.
- **RSA** — larger keys and signatures for no benefit here.
- **One key for everything** — a leak of the server's bundle key would also let someone forge licenses.
