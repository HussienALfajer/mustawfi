# 0020. Custom push/pull sync over an idempotent outbox and a per-tenant change log; the server posts the ledger; device-prefixed numbering

- Status: Accepted
- Date: 2026-09-25

## Context

ADR-0005 sets the conflict model: documents are append-only, master data is server-authoritative, negative stock is flagged but never blocks a sale. This ADR settles the protocol, where journal entries are created, document numbering, and what happens to a document that arrives after its period was locked. Every piece of sync must stay under row-level security (ADR-0017).

## Decision

**Engine:** a custom protocol owned by `core.sync`. No third-party sync service.

**Push (device → server)**

- Each outbox entry is an operation `{opId (UUIDv7), deviceId, deviceSeq, type, payloadVersion, payload, userId, shiftId, createdAt}`. `deviceSeq` increases by one per device with no gaps.
- `POST /sync/v1/push` carries a batch (bounded by count and size). The server processes each device's operations in `deviceSeq` order, **each in its own transaction**, and records it in `core_sync.received_ops` (primary key `opId`). A repeated `opId` returns the stored result, so retries never duplicate. A gap in `deviceSeq` stops processing at the gap and asks the device to resend.
- Per-operation result: `accepted`, `duplicate`, or `rejected` with a code. A rejected operation stays on the device in a visible *needs review* queue; nothing is dropped silently.
- **The server never refuses a completed sale for a business rule.** Negative stock, a credit limit exceeded offline, a price below cost, an arithmetic mismatch: the document is accepted exactly as the device recorded it (it is what the customer paid) and flagged for the accountant. Rejection is reserved for what cannot be recorded: an unknown or revoked device, a malformed payload, an unsupported payload version.

**Posting**

- The device sends complete documents: lines, amounts, currency, rate, department, shift, template version (non-negotiable 7). On ingest, the owning module's handler writes the document, the stock movements, and — through `core.ledger`'s interface — the balanced journal entry, all in one transaction.
- Posting rules live on the server only. The device keeps local balances (stock, cash per box and shift, customer balances) for offline display and decisions; after sync, server-confirmed values replace them.

**Pull (server → device)**

- Changes to data that flows down (master data, configuration, balances, and documents other devices need, such as orders sent to the cashier) append a row to `core_sync.changes` with a per-tenant sequence number. The number comes from a per-tenant counter row updated inside the writing transaction, which serializes those writes per tenant, so commit order equals sequence order and no change is skipped.
- `GET /sync/v1/pull?cursor=…` returns pages of full current rows (not diffs) filtered to the device's scope (departments, device type); archived records come as tombstones. The device applies a page and saves the new cursor in one local transaction.
- Each module declares in its manifest which of its entities sync down, and to which scope.
- A new device bootstraps from a paged snapshot plus a cursor. The change log is compacted once every active device has passed a point, plus a retention margin; a device behind the retention window re-bootstraps.

**Versioning:** the protocol is versioned in the path (`/sync/v1`), each operation type carries a `payloadVersion`, and the server keeps handlers for older payload versions until no active device reports an app version that emits them. The configuration bundle can set a minimum app version, which forces an update.

**Time:** operations carry the device's time. The server records its own receipt time. The document's `business_date` is the device's day at the moment of the sale. Clock-tampering detection is in ADR-0021.

**Document numbering**

- On registration, the server assigns the device a **prefix**: two characters from an unambiguous alphabet (no `I`, `O`, `0`, `1`), unique within the tenant, **never reused**. A reinstalled device is a new device with a new prefix.
- Number format: `{prefix}-{docCode}-{seq:6}`, for example `K7-INV-000123`. `seq` counts per device and per document type, is allocated in the same local transaction as the document, and continues without yearly reset (revisited if the tax authority requires otherwise). The server audits gaps per device and type. In the UI the number is always an LTR island (ADR-0024).

**Period lock and late documents**

- A period cannot be locked while an active device has not confirmed pushing everything up to the period's end (the device reports its pushed-through time). The lock screen lists those devices; the accountant waits for them to sync or revokes them.
- If a document dated inside a locked period still arrives (for example, from a device that was revoked and later returned), it is accepted. It keeps its original `business_date`, its journal entry is posted with an `accounting_date` on the first open day, and it is flagged for the accountant. The locked period does not change.
- This relies on non-negotiable 9 applying to the **accounting date**. The user approved that clarification of `AGENTS.md` on 2026-09-25, together with this ADR.

## Consequences

- No second isolation layer: every sync read and write goes through the same RLS-protected paths.
- Offline sales are never lost to validation; the accountant gets a review queue instead.
- Master-data writes are serialized per tenant — fine for single stores, and worth revisiting for very large tenants.
- `core-sync` (roadmap unit 4) builds the simulation harness that proves no loss and no duplication under drops, duplicates, reordering, and long outages.

## Alternatives considered

- **PowerSync or a similar engine** — reads through logical replication, bypassing RLS, so its sync rules become a second isolation layer (non-negotiable 3). It is also one more service to run, and a vendor license under the product's most critical part.
- **Posting on the device** — posting rules duplicated on every device, and old app versions posting with old rules.
- **Rejecting late documents** — a real, paid sale missing from the books is worse than a flagged one posted in the next open period.
- **Yearly numbering reset** — not needed without a regulatory reason, and it adds a year to every uniqueness check.

## Amendments

- 2026-09-25 (walking-skeleton slice 8; accepted by the user on 2026-09-25 at the unit close): the routes are `POST /api/v1/sync/push` and `GET /api/v1/sync/pull`, not `/sync/v1/…`. The module registry mounts every module under `/api/v1/<module>`, so the API version stands for the protocol version until the two need to diverge. ADR-0014's mention of `/sync/v1` follows this amendment.
- 2026-09-25 (walking-skeleton close, a deferral, not a change of decision): pull has no per-device scope filter yet, and which entities sync down is not declared in module manifests (modules call `recordChange`); both, with bootstrap and compaction, belong to the `core-sync` unit.
