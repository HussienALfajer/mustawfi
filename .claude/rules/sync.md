---
paths:
  - "core/sync/**"
  - "packages/local-db/**"
  - "**/*outbox*"
  - "**/*sync*"
---

# Sync and offline rules

Sources: ADR-0005 (offline first), ADR-0019 (local database), ADR-0020 (sync protocol and posting), ADR-0026 (sync simulation harness), non-negotiables 4, 7, 8.

- A sale never waits for the network. The document, its number increment, and its outbox entry commit in **one local transaction**.
- Local durability: WAL with `synchronous = FULL`. Local amounts are scaled `INTEGER`s converted only in the local-db repository layer through kernel helpers.
- Operations are `{opId (UUIDv7), deviceId, deviceSeq, type, payloadVersion, payload, userId, shiftId, createdAt}`; `deviceSeq` has no gaps.
- Push is idempotent: `core_sync.received_ops` keyed by `opId`; a repeat returns the stored result (`duplicate`). Each operation is processed in its own transaction, in `deviceSeq` order; a gap stops processing and asks the device to resend.
- The server never refuses a completed sale for a business rule (negative stock, credit limit, price below cost, arithmetic mismatch): accept it as recorded and flag it. Reject only what cannot be recorded (unknown or revoked device, malformed payload, unsupported version), and a rejected operation stays visible on the device — nothing is dropped silently.
- Pull: `core_sync.changes` numbered by a per-tenant counter updated inside the writing transaction, so commit order equals sequence order. Pages carry full rows, tombstones for archived records; the device applies a page and saves the cursor in one local transaction.
- Document numbers are `{prefix}-{docCode}-{seq:6}`; the prefix is unique per tenant and never reused.
- Operations carry device time; the server records its receipt time. Keep payload handlers for older `payloadVersion`s while devices still emit them.
- Changes here need cases in the sync simulation harness: drops, duplicates, reordering, convergence with no lost or duplicate documents and a balanced ledger.
