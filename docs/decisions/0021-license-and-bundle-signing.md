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

## Amendments

- 2026-09-25 (`core-foundation` spec, ADR-0030, accepted by the user on 2026-09-25): the license has no device claim — one license per tenant, device limits enforced by the tenant server at registration; license claims add read-only days. Until the control plane exists, a staff CLI (`tools/license`) issues licenses and the tenant server installs them after verification. The configuration bundle is built in `core-foundation` from parts that modules contribute (license, access, organization), assembled by the host; `core-config` adds its parts later.
- 2026-09-26 (`core-foundation` slice 13, accepted by the user on 2026-09-26): **the device clock.**
  - *Trusted server time:* a JWS the tenant server signs with the bundle key for one device (`typ: mustawfi-time`, `{ deviceId, serverTime }`) in every bundle answer. The device takes one only when it verifies and is later than the last one taken, so neither a stranger answering its requests nor a replay can move its clock guard.
  - *The device's time* for the license — its lifecycle state and the offline days — is the last server time plus the local time elapsed since, counted on the high-water mark. Before any server time it is the mark itself, and offline days count from the bundle's signed `issuedAt`.
  - *The high-water mark* is the latest **local** time observed since the last server time, and restarts from the local clock at each one. A local time more than 5 minutes behind it is a clock moved back: read-only at once, until the server is reached.
  - *A wrong clock:* when the local clock is more than 30 minutes from the server's at a server time, the device creates no document until a later server time finds it right, since documents would carry a wrong date or time.
  - *Why:* with the mark as the maximum of every time ever seen, server times included, a device whose clock was once set ahead and then corrected stayed read-only for good, and one whose clock merely drifted more than 5 minutes behind the server's could not sell. A clock moved back gains nothing now, because the license reads the server's time.
